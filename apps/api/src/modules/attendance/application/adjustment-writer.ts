import { addDays, instantOf, type LocalDate } from '../domain/local-time';
import { effectiveSchedule } from '../domain/work-schedule';
import type { AttendanceDeps } from './attendance-days';
import { assertInsideRetention } from './retention-guard';
import type { IHrAuditRecorder } from './ports/collaborators.port';

export interface AdjustmentInput {
  id: string;
  actorId: string;
  userId: string;
  kind: 'IN' | 'OUT';
  date: LocalDate;
  /** Phút trong ngày theo lịch hiệu lực của `date`. */
  minuteOfDay: number;
  nextDay: boolean;
  /** Ghi ở `note` của lượt (HR: lý do; đơn bổ sung: "Đơn bổ sung giờ" + id — KHÔNG chép lý do của nhân viên). */
  note: string;
}

/**
 * Ghi MỘT lượt ADJUSTMENT — đường duy nhất cho HR thêm tay (`AttendanceEventsUseCases.adjust`) và duyệt đơn bổ sung giờ
 * (hr-extended ADR-129: "duyệt = đúng đường ADJUSTMENT"). Bên gọi đã ở TRONG transaction, đã giữ
 * `taskflow:attendance:punch:<user>` (bậc 4, ADR-136) rồi mới `authorizeWrite` (bậc 5) và kiểm nhiệm kỳ / luật riêng.
 * Ở đây: retention (422 `OUTSIDE_RETENTION`), giờ theo lịch của `date`, thêm lượt, audit `EVENT_ADJUST`. Thông báo do bên
 * gọi chọn (`ATTENDANCE_ADJUSTED` hay `CORRECTION_APPROVED`).
 */
export async function appendAdjustment(
  d: Pick<AttendanceDeps, 'events' | 'calendar' | 'retention'> & { audit: IHrAuditRecorder },
  input: AdjustmentInput,
): Promise<{ occurredAt: Date }> {
  assertInsideRetention(d.retention, input.date);
  const { timezone } = effectiveSchedule(await d.calendar.scheduleVersions(), input.date);
  const occurredAt = instantOf(
    input.nextDay ? addDays(input.date, 1) : input.date,
    input.minuteOfDay,
    timezone,
  );
  await d.events.add({
    id: input.id,
    userId: input.userId,
    kind: input.kind,
    source: 'ADJUSTMENT',
    occurredAt,
    workDate: input.date,
    ip: null,
    userAgent: null,
    idempotencyKey: null,
    note: input.note,
    createdBy: input.actorId,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  });
  await d.audit.record({
    actorId: input.actorId,
    action: 'EVENT_ADJUST',
    targetUserId: input.userId,
    refId: input.id,
    after: { kind: input.kind, workDate: input.date, occurredAt: occurredAt.toISOString() },
  });
  return { occurredAt };
}
