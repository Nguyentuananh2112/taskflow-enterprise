import type {
  AdjustAttendanceBody,
  AttendanceEventChangeDto,
  AttendanceEventDto,
  AttendanceEventsDto,
} from '@taskflow/contracts';

import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import type { LocalDate } from '../../domain/local-time';
import { employedOn } from '../../domain/tenure';
import { effectiveSchedule } from '../../domain/work-schedule';
import { appendAdjustment } from '../adjustment-writer';
import { toEventDtos } from '../attendance-event-dto';
import type { AttendanceDeps } from '../attendance-days';
import { monthTotalsOf } from '../attendance-totals';
import { assertInsideRetention } from '../retention-guard';
import type { AttendanceEventRecord } from '../ports/attendance-event-store.port';
import type {
  AttendanceNotifier,
  ICompanyAccess,
  IHrAuditRecorder,
  IUserRefReader,
} from '../ports/collaborators.port';

export interface AttendanceEventDeps extends AttendanceDeps {
  users: IUserRefReader;
  company: ICompanyAccess;
  notifier: AttendanceNotifier;
  audit: IHrAuditRecorder;
}

/**
 * Lượt chấm thô (§5): HR xem / thêm (ADJUSTMENT) / hủy; nhân viên xem lượt của chính mình kèm IP/UA
 * (NĐ 13 Đ.14). Log bất biến (ADR-121): hủy chỉ đánh dấu, không xóa dòng. Quyền + luật "không tự điều
 * chỉnh công của mình" (B-H1 — tuyệt đối, cấp công ty) do `company.authorizeWrite` chốt TRONG transaction (đọc lại grant
 * sau FOR SHARE). Mọi ADJUSTMENT/void bắt buộc lý do (lưu ở `note` / `voidReason` của lượt chấm — audit
 * không chép văn bản tự do, B-H2), ghi `HrAuditLog` + thông báo cho nhân viên trong CÙNG transaction (ADR-123).
 */
/** Mọi nhiệm kỳ của một người (biên ngày của contract — DateOnly). */
const EVER = { from: '1900-01-01', to: '9999-12-31' } as const;

export class AttendanceEventsUseCases {
  constructor(private readonly d: AttendanceEventDeps) {}

  /** `GET attendance/events?userId&date` (HR). Người chưa từng có lượt chấm ⇒ 404. */
  async listForHr(q: { userId: string; date: LocalDate }) {
    if (!(await this.d.events.hasAnyForUser(q.userId))) {
      throw new ResourceNotFoundError('user');
    }
    return this.#list(q);
  }

  /** `GET attendance/me/events?date` — chỉ của chính người gọi. */
  listMine(q: { userId: string; date: LocalDate }): Promise<AttendanceEventsDto> {
    return this.#list(q);
  }

  /** `POST attendance/events` (ADJUSTMENT) ⇒ 201 `{ event, day }`. */
  async adjust(actorId: string, body: AdjustAttendanceBody): Promise<AttendanceEventChangeDto> {
    const { d } = this;
    const id = d.ids.next();
    await d.uow.run(async () => {
      // Bảng khóa ADR-136: `punch:<user>` (bậc 4) TRƯỚC dòng company_members (bậc 5) — HR thêm IN ‖ duyệt đơn bổ sung IN
      // ‖ nhân viên bấm Vào tuần tự hóa (hr-extended ADR-129).
      await d.events.lockUserPunch(body.userId);
      await d.company.authorizeWrite({ actorId, targetUserId: body.userId });
      // A S2 (company-level ADR-136): người đang làm HOẶC đã nghỉ, miễn `date` thuộc một nhiệm kỳ EMPLOYEE của họ
      // (HR sửa được công tháng cuối sau khi nghỉ việc). Chưa từng là nhân viên ⇒ 404 user.
      const tenures = await d.tenures.tenuresOf({
        userIds: [body.userId],
        from: EVER.from,
        to: EVER.to,
      });
      if (tenures.length === 0) throw new ResourceNotFoundError('user');
      // Thứ tự lỗi đã chốt: 404 tài nguyên con TRƯỚC 422 (review B, LOW-1); retention TRƯỚC nhiệm kỳ.
      assertInsideRetention(d.retention, body.date);
      if (!employedOn(tenures, body.date)) {
        throw new BusinessRuleViolationError(
          'NOT_EMPLOYED',
          'Ngày này nằm ngoài thời gian người đó làm việc ở công ty.',
        );
      }
      const [h, m] = body.time.split(':').map(Number) as [number, number];
      await appendAdjustment(d, {
        id,
        actorId,
        userId: body.userId,
        kind: body.kind,
        date: body.date,
        minuteOfDay: h * 60 + m,
        nextDay: body.nextDay,
        note: body.reason,
      });
      if (body.userId !== actorId) {
        await d.notifier.attendanceAdjusted({
          recipientId: body.userId,
          eventId: id,
          actorId,
        });
      }
    });
    return this.#change(id);
  }

  /** `POST attendance/events/:id/void` ⇒ 200 `{ event, day }`; đã hủy ⇒ 409 `already_voided`. */
  async void(
    actorId: string,
    q: { id: string; reason: string },
  ): Promise<AttendanceEventChangeDto> {
    const { d } = this;
    await d.uow.run(async () => {
      const event = await d.events.findById(q.id);
      if (!event) throw new ResourceNotFoundError('attendance_event');
      // Chủ lượt không đổi ⇒ đọc trước khóa để biết khóa ai; `punch:<user>` (bậc 4) rồi mới quyền (bậc 5, ADR-136). Hủy
      // ‖ duyệt đơn bổ sung cùng loại tuần tự ⇒ luật "không thay thế" thấy đúng lượt còn hiệu lực.
      await d.events.lockUserPunch(event.userId);
      // Cần chủ của lượt chấm cho luật "không tự hủy" ⇒ chốt sau khi đọc lượt, vẫn TRƯỚC lệnh ghi.
      await d.company.authorizeWrite({ actorId, targetUserId: event.userId });
      assertInsideRetention(d.retention, event.workDate);
      const ok = await d.events.void({
        id: q.id,
        voidedAt: d.clock.now(),
        voidedBy: actorId,
        voidReason: q.reason,
      });
      if (!ok) {
        throw new ResourceConflictError({ reason: 'already_voided' }, 'Lượt chấm này đã bị hủy.');
      }
      await d.audit.record({
        actorId,
        action: 'EVENT_VOID',
        targetUserId: event.userId,
        refId: q.id,
        before: { voidedAt: null },
        after: { voidedAt: d.clock.now().toISOString() },
      });
      if (event.userId !== actorId) {
        await d.notifier.attendanceAdjusted({
          recipientId: event.userId,
          eventId: q.id,
          actorId,
        });
      }
    });
    return this.#change(q.id);
  }

  async #list(q: { userId: string; date: LocalDate }): Promise<AttendanceEventsDto> {
    const [events, versions] = await Promise.all([
      this.d.events.listForUser({ ...q, from: q.date, to: q.date }),
      this.d.calendar.scheduleVersions(),
    ]);
    events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return {
      timezone: effectiveSchedule(versions, q.date).timezone,
      events: await this.#toDtos(events),
    };
  }

  async #change(id: string): Promise<AttendanceEventChangeDto> {
    const event = (await this.d.events.findById(id))!;
    const [dto] = await this.#toDtos([event]);
    const { day, totals } = await monthTotalsOf(this.d, {
      userId: event.userId,
      date: event.workDate,
    });
    return { event: dto!, day, totals };
  }

  #toDtos(events: AttendanceEventRecord[]): Promise<AttendanceEventDto[]> {
    return toEventDtos(this.d.users, events);
  }
}
