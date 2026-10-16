import type {
  AdjustAttendanceBody,
  AttendanceEventChangeDto,
  AttendanceEventDto,
  AttendanceEventsDto,
} from '@taskflow/contracts';

import {
  ForbiddenError,
  ResourceConflictError,
  ResourceNotFoundError,
  type ResourceKind,
} from '../../../../core/errors';
import { addDays, instantOf, type LocalDate } from '../../domain/local-time';
import { scheduleFor } from '../../domain/work-schedule';
import { toEventDtos } from '../attendance-event-dto';
import { DEFAULT_TIMEZONE, summarizeRange, type AttendanceDeps } from '../attendance-days';
import type { AttendanceEventRecord } from '../ports/attendance-event-store.port';
import type {
  AttendanceNotifier,
  IHrAuditLog,
  IMemberDirectory,
  IUserRefReader,
} from '../ports/collaborators.port';

export interface AttendanceEventDeps extends AttendanceDeps {
  users: IUserRefReader;
  members: IMemberDirectory;
  notifier: AttendanceNotifier;
  audit: IHrAuditLog;
}

/** Người có `hr:manage` đang thao tác (route đã kiểm quyền); `isOwner` cho ngoại lệ tự điều chỉnh. */
export interface HrActor {
  userId: string;
  isOwner: boolean;
}

/**
 * TẠM: B thêm `'attendance_event'` vào `ResourceKind` (core) + `NotFoundDetails` (contracts) trong T-037
 * (TL giao, tránh 2 người cùng sửa) ⇒ bỏ ép kiểu khi có hash của B.
 */
const ATTENDANCE_EVENT = 'attendance_event' as ResourceKind;

/** Nhân viên được chấm công: OWNER, PM, MEMBER — VIEWER là khách, không phải nhân viên (§1). */
const EMPLOYEE_ROLES = new Set(['OWNER', 'PM', 'MEMBER']);

/**
 * Lượt chấm thô (§5): HR xem / thêm (ADJUSTMENT) / hủy; nhân viên xem lượt của chính mình kèm IP/UA
 * (NĐ 13 Đ.14). Log bất biến (ADR-121): hủy chỉ đánh dấu, không xóa dòng. HR không tự điều chỉnh công của
 * mình (B-H1) — trừ OWNER (chủ công ty); mọi ADJUSTMENT/void bắt buộc lý do, ghi `HrAuditLog` + thông báo
 * cho nhân viên trong CÙNG transaction (ADR-123).
 */
export class AttendanceEventsUseCases {
  constructor(private readonly d: AttendanceEventDeps) {}

  /** `GET attendance/events?userId&date` (HR). Người chưa từng có lượt chấm trong ws ⇒ 404. */
  async listForHr(q: { workspaceId: string; userId: string; date: LocalDate }) {
    if (!(await this.d.events.hasAnyForUser(q.workspaceId, q.userId))) {
      throw new ResourceNotFoundError('user');
    }
    return this.#list(q);
  }

  /** `GET attendance/me/events?date` — chỉ của chính người gọi. */
  listMine(q: {
    workspaceId: string;
    userId: string;
    date: LocalDate;
  }): Promise<AttendanceEventsDto> {
    return this.#list(q);
  }

  /** `POST attendance/events` (ADJUSTMENT) ⇒ 201 `{ event, day }`. */
  async adjust(
    workspaceId: string,
    actor: HrActor,
    body: AdjustAttendanceBody,
  ): Promise<AttendanceEventChangeDto> {
    const { d } = this;
    this.#assertNotSelf(actor, body.userId);
    const id = d.ids.next();
    await d.uow.run(async () => {
      const role = await d.members.roleOf({ workspaceId, userId: body.userId });
      if (role === null || !EMPLOYEE_ROLES.has(role)) throw new ResourceNotFoundError('user');
      const versions = await d.calendar.scheduleVersions(workspaceId);
      const timezone = scheduleFor(versions, body.date)?.timezone ?? DEFAULT_TIMEZONE;
      const [h, m] = body.time.split(':').map(Number) as [number, number];
      const occurredAt = instantOf(
        body.nextDay ? addDays(body.date, 1) : body.date,
        h * 60 + m,
        timezone,
      );
      await d.events.add({
        id,
        workspaceId,
        userId: body.userId,
        kind: body.kind,
        source: 'ADJUSTMENT',
        occurredAt,
        workDate: body.date,
        ip: null,
        userAgent: null,
        idempotencyKey: null,
        note: body.reason,
        createdBy: actor.userId,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      });
      await d.audit.append({
        workspaceId,
        actorId: actor.userId,
        action: 'EVENT_ADJUST',
        targetUserId: body.userId,
        refId: id,
        before: null,
        after: {
          kind: body.kind,
          workDate: body.date,
          occurredAt: occurredAt.toISOString(),
          reason: body.reason,
        },
      });
      if (body.userId !== actor.userId) {
        await d.notifier.attendanceAdjusted({
          workspaceId,
          recipientId: body.userId,
          eventId: id,
          actorId: actor.userId,
        });
      }
    });
    return this.#change(workspaceId, id);
  }

  /** `POST attendance/events/:id/void` ⇒ 200 `{ event, day }`; đã hủy ⇒ 409 `already_voided`. */
  async void(
    workspaceId: string,
    actor: HrActor,
    q: { id: string; reason: string },
  ): Promise<AttendanceEventChangeDto> {
    const { d } = this;
    await d.uow.run(async () => {
      const event = await d.events.findById(workspaceId, q.id);
      if (!event) throw new ResourceNotFoundError(ATTENDANCE_EVENT);
      this.#assertNotSelf(actor, event.userId);
      const ok = await d.events.void({
        workspaceId,
        id: q.id,
        voidedAt: d.clock.now(),
        voidedBy: actor.userId,
        voidReason: q.reason,
      });
      if (!ok) {
        throw new ResourceConflictError({ reason: 'already_voided' }, 'Lượt chấm này đã bị hủy.');
      }
      await d.audit.append({
        workspaceId,
        actorId: actor.userId,
        action: 'EVENT_VOID',
        targetUserId: event.userId,
        refId: q.id,
        before: { voidedAt: null },
        after: { voidedAt: d.clock.now().toISOString(), reason: q.reason },
      });
      if (event.userId !== actor.userId) {
        await d.notifier.attendanceAdjusted({
          workspaceId,
          recipientId: event.userId,
          eventId: q.id,
          actorId: actor.userId,
        });
      }
    });
    return this.#change(workspaceId, q.id);
  }

  #assertNotSelf(actor: HrActor, targetUserId: string): void {
    if (actor.userId === targetUserId && !actor.isOwner) {
      throw new ForbiddenError(undefined, 'Không được tự điều chỉnh công của chính mình.');
    }
  }

  async #list(q: {
    workspaceId: string;
    userId: string;
    date: LocalDate;
  }): Promise<AttendanceEventsDto> {
    const [events, versions] = await Promise.all([
      this.d.events.listForUser({ ...q, from: q.date, to: q.date }),
      this.d.calendar.scheduleVersions(q.workspaceId),
    ]);
    events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return {
      timezone: scheduleFor(versions, q.date)?.timezone ?? DEFAULT_TIMEZONE,
      events: await this.#toDtos(events),
    };
  }

  async #change(workspaceId: string, id: string): Promise<AttendanceEventChangeDto> {
    const event = (await this.d.events.findById(workspaceId, id))!;
    const [dto] = await this.#toDtos([event]);
    const [day] = await summarizeRange(this.d, {
      workspaceId,
      userId: event.userId,
      from: event.workDate,
      to: event.workDate,
    });
    return { event: dto!, day: day! };
  }

  #toDtos(events: AttendanceEventRecord[]): Promise<AttendanceEventDto[]> {
    return toEventDtos(this.d.users, events);
  }
}
