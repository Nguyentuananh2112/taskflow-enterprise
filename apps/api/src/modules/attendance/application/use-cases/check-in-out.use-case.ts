import type { AttendanceTodayDto } from '@taskflow/contracts';

import { BusinessRuleViolationError, ResourceConflictError } from '../../../../core/errors';
import { addDays } from '../../domain/local-time';
import { decidePunch, type PunchSkipReason } from '../../domain/punch-rules';
import { localToday, todayCard, type AttendanceDeps } from '../attendance-days';
import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceKind,
} from '../ports/attendance-event-store.port';
import type { ICompanyAccess } from '../ports/collaborators.port';

export interface CheckInOutInput {
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

/** Lỗi cho từng lý do từ chối của `decidePunch` (mã giữ như route cũ; `NOT_EMPLOYED` mới — A S1). */
const punchRefused: Record<PunchSkipReason, () => Error> = {
  ALREADY_CHECKED_IN: () => alreadyCheckedIn(),
  NOT_CHECKED_IN: () =>
    new BusinessRuleViolationError('NOT_CHECKED_IN', 'Bạn chưa chấm vào hôm nay.'),
  NOT_EMPLOYED: () =>
    new BusinessRuleViolationError(
      'NOT_EMPLOYED',
      'Ngày này nằm ngoài thời gian bạn làm việc ở công ty.',
    ),
};

const alreadyCheckedIn = () =>
  new ResourceConflictError({ reason: 'already_checked_in' }, 'Bạn đã chấm vào hôm nay.');
const keyReused = () =>
  new BusinessRuleViolationError(
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency-Key đã dùng cho thao tác khác.',
  );

/**
 * `POST attendance/check-in|check-out` (thiết kế §4–§5; cấp công ty — company-level ADR-136). Giờ là giờ SERVER (client không gửi giờ). Trả thẻ
 * hôm nay để web cập nhật không cần GET lại. Lặp lại cùng Idempotency-Key của chính mình + cùng loại ⇒ trả
 * thẻ hiện tại, không tạo lượt mới; khác loại ⇒ 422. IN lần 2 ⇒ 409 `already_checked_in`; OUT khi không có
 * IN để đóng ⇒ 422 `NOT_CHECKED_IN`.
 */
export class CheckInOutUseCase {
  constructor(
    private readonly d: AttendanceDeps & { company: Pick<ICompanyAccess, 'assertActiveEmployee'> },
  ) {}

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
    const { userId, kind } = input;
    // Khóa theo USER (T-053a → T-063): mọi đường chấm của một người chạy tuần tự; đọc sau khóa.
    await d.events.lockUserPunch(userId);
    // A C2: middleware kiểm TRƯỚC transaction — job hoàn tất nghỉ việc có thể commit trong lúc ta chờ khóa (nó cũng
    // lấy `punch:<user>`) ⇒ đọc lại tư cách nhân viên SAU khóa; hết quyền ⇒ 401 SESSION_REVOKED, không ghi.
    await d.company.assertActiveEmployee(userId);
    const prior = await d.events.findByIdempotencyKey({
      userId,
      source: 'WEB',
      key: input.idempotencyKey,
    });
    if (prior) {
      if (prior.kind !== kind) throw keyReused();
      return true;
    }
    const now = d.clock.now();
    const versions = await d.calendar.scheduleVersions();
    const { date: today } = localToday(versions, now);
    // Đủ để tìm IN còn mở của hôm qua (giờ chốt 06:00 hôm nay) và IN của hôm nay.
    const recent = await d.events.listForUser({ userId, from: addDays(today, -2), to: today });
    // CC-HR-02 #17: READ COMMITTED ⇒ mỗi câu đọc một snapshot mới. Request song song cùng key có thể commit GIỮA
    // `findByIdempotencyKey` (chưa thấy) và câu này (đã thấy) ⇒ kiểm key lại TRÊN dữ liệu mới nhất trước khi kết
    // luận "đã chấm vào" (409) — cùng key là lặp lại, không phải chấm lần hai.
    const sameKey = recent.find(
      (e) => e.source === 'WEB' && e.idempotencyKey === input.idempotencyKey,
    );
    if (sameKey) {
      if (sameKey.kind !== kind) throw keyReused();
      return true;
    }
    const tenures = await d.tenures.tenuresOf({
      userIds: [userId],
      from: addDays(today, -2),
      to: addDays(today, 1),
    });
    const decision = decidePunch({ kind, now, schedules: versions, recent, tenures });
    if (!decision.ok) throw punchRefused[decision.reason]();
    const { workDate } = decision;
    await d.events.add({
      id: d.ids.next(),
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
