import type { AttendanceTodayDto } from '@taskflow/contracts';

import { BusinessRuleViolationError, ResourceConflictError } from '../../../../core/errors';
import { addDays, toLocal } from '../../domain/local-time';
import { workDateFor } from '../../domain/work-date';
import { localToday, todayCard, type AttendanceDeps } from '../attendance-days';
import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceKind,
} from '../ports/attendance-event-store.port';

export interface CheckInOutInput {
  workspaceId: string;
  userId: string;
  kind: AttendanceKind;
  /** UUID từ header `Idempotency-Key` (đã validate ở presentation). */
  idempotencyKey: string;
  ip: string | null;
  userAgent: string | null;
}

/** `replayed`: lặp lại cùng Idempotency-Key ⇒ route trả 200 thay vì 201 (AT-03). */
export interface CheckInOutResult {
  card: AttendanceTodayDto;
  replayed: boolean;
}

/** Thiết kế §3: `userAgent ≤ 256` — cắt chứ không từ chối (UA dài không phải lỗi của người dùng). */
const USER_AGENT_MAX = 256;

const alreadyCheckedIn = () =>
  new ResourceConflictError({ reason: 'already_checked_in' }, 'Bạn đã chấm vào hôm nay.');
const keyReused = () =>
  new BusinessRuleViolationError(
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency-Key đã dùng cho thao tác khác.',
  );

/**
 * `POST attendance/check-in|check-out` (thiết kế §4–§5). Giờ là giờ SERVER (client không gửi giờ). Trả thẻ
 * hôm nay để web cập nhật không cần GET lại. Lặp lại cùng Idempotency-Key của chính mình + cùng loại ⇒ trả
 * thẻ hiện tại, không tạo lượt mới; khác loại ⇒ 422. IN lần 2 ⇒ 409 `already_checked_in`; OUT khi không có
 * IN để đóng ⇒ 422 `NOT_CHECKED_IN`.
 */
export class CheckInOutUseCase {
  constructor(private readonly d: AttendanceDeps) {}

  async execute(input: CheckInOutInput, retried = false): Promise<CheckInOutResult> {
    let replayed: boolean;
    try {
      replayed = await this.d.uow.run(() => this.#record(input));
    } catch (err) {
      // Bên thua của hai request song song bị MỘT trong hai unique chặn — Postgres không cam kết kiểm cái nào
      // trước (CC-HR-02) — và tx đã hủy ⇒ chạy lại bằng transaction mới, lúc này lượt của bên thắng đã commit:
      // cùng key + cùng loại ⇒ replay 200; cùng key khác loại ⇒ 422; key khác ⇒ 409 `already_checked_in`.
      if (err instanceof AlreadyCheckedInError || err instanceof IdempotencyKeyTakenError) {
        if (!retried) return this.execute(input, true);
        if (err instanceof AlreadyCheckedInError) throw alreadyCheckedIn();
      }
      throw err;
    }
    return { card: await todayCard(this.d, input), replayed };
  }

  /** `true` khi key đã có (lặp lại) — không ghi gì. */
  async #record(input: CheckInOutInput): Promise<boolean> {
    const { d } = this;
    const { workspaceId, userId, kind } = input;
    const prior = await d.events.findByIdempotencyKey({
      workspaceId,
      userId,
      source: 'WEB',
      key: input.idempotencyKey,
    });
    if (prior) {
      if (prior.kind !== kind) throw keyReused();
      return true;
    }
    const now = d.clock.now();
    const { date: today, timezone } = localToday(
      await d.calendar.scheduleVersions(workspaceId),
      now,
    );
    // Đủ để tìm IN còn mở của hôm qua (giờ chốt 06:00 hôm nay) và IN của hôm nay.
    const recent = await d.events.listForUser({
      workspaceId,
      userId,
      from: addDays(today, -2),
      to: today,
    });
    const live = recent.filter((e) => e.voidedAt === null);
    let workDate = toLocal(now, timezone).date;
    if (kind === 'IN') {
      if (live.some((e) => e.kind === 'IN' && e.source === 'WEB' && e.workDate === workDate)) {
        throw alreadyCheckedIn();
      }
    } else {
      workDate = workDateFor('OUT', now, timezone, recent);
      if (!live.some((e) => e.kind === 'IN' && e.workDate === workDate)) {
        throw new BusinessRuleViolationError('NOT_CHECKED_IN', 'Bạn chưa chấm vào hôm nay.');
      }
    }
    await d.events.add({
      id: d.ids.next(),
      workspaceId,
      userId,
      kind,
      source: 'WEB',
      occurredAt: now,
      workDate,
      ip: input.ip,
      userAgent: input.userAgent === null ? null : input.userAgent.slice(0, USER_AGENT_MAX),
      idempotencyKey: input.idempotencyKey,
      note: null,
      createdBy: userId,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
    return false;
  }
}
