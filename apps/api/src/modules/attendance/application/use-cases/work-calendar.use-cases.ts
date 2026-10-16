import type {
  CreateWorkScheduleBody,
  HolidayDto,
  PutHolidayBody,
  WorkScheduleDto,
} from '@taskflow/contracts';

import { BusinessRuleViolationError } from '../../../../core/errors';
import type { LocalDate } from '../../domain/local-time';
import type { WorkSchedule } from '../../domain/work-schedule';
import { localToday, type AttendanceDeps } from '../attendance-days';
import { UNKNOWN_USER } from '../attendance-event-dto';
import type { IHrAccess, IHrAuditRecorder, IUserRefReader } from '../ports/collaborators.port';
import type { ScheduleVersionRecord } from '../ports/work-calendar-store.port';

export interface WorkCalendarDeps extends AttendanceDeps {
  users: IUserRefReader;
  hrAccess: IHrAccess;
  audit: IHrAuditRecorder;
}

const shape = (s: WorkSchedule) => ({
  effectiveFrom: s.effectiveFrom,
  timezone: s.timezone,
  workdays: s.workdays,
  startMin: s.startMin,
  endMin: s.endMin,
  breakStartMin: s.breakStartMin,
  breakEndMin: s.breakEndMin,
  graceMin: s.graceMin,
});

/**
 * Lịch làm việc theo phiên bản + ngày lễ (§4–§5). Đọc: mọi thành viên (route kiểm). Ghi: `hr:manage` — chốt
 * lại bằng `hrAccess.authorizeWrite` TRONG transaction, ghi `HrAuditLog` cùng transaction.
 * - Lịch chỉ hiệu lực từ HÔM NAY trở đi (hôm nay theo lịch đang hiệu lực): quá khứ ⇒ 422 `SCHEDULE_IN_PAST`
 *   — sửa quá khứ sẽ đổi lại bảng công đã chốt lương.
 * - Ngày lễ đã qua: chỉ OWNER và phải có lý do (AT-18) — HR khác ⇒ 422 `HOLIDAY_IN_PAST`, OWNER thiếu lý do
 *   ⇒ 422 `REASON_REQUIRED`. Lý do ghi vào audit ở khóa `note` (`reason` dành cho luật B-H2 của đơn nghỉ).
 */
export class WorkCalendarUseCases {
  constructor(private readonly d: WorkCalendarDeps) {}

  /** `GET attendance/schedules` — rỗng ⇒ workspace đang dùng lịch mặc định. */
  async listSchedules(workspaceId: string): Promise<WorkScheduleDto[]> {
    const records = await this.d.calendar.scheduleRecords(workspaceId);
    return this.#toScheduleDtos(records);
  }

  /** `POST attendance/schedules` ⇒ 201 phiên bản đã lưu (trùng `effectiveFrom` ⇒ thay). */
  async createSchedule(
    workspaceId: string,
    actorId: string,
    body: CreateWorkScheduleBody,
  ): Promise<WorkScheduleDto> {
    const { d } = this;
    const record: ScheduleVersionRecord = { ...body, createdBy: actorId, createdAt: d.clock.now() };
    await d.uow.run(async () => {
      await d.hrAccess.authorizeWrite({ workspaceId, actorId });
      const versions = await d.calendar.scheduleRecords(workspaceId);
      if (body.effectiveFrom < this.#today(versions)) {
        throw new BusinessRuleViolationError(
          'SCHEDULE_IN_PAST',
          'Lịch mới chỉ được hiệu lực từ hôm nay trở đi.',
        );
      }
      const replaced = versions.find((v) => v.effectiveFrom === body.effectiveFrom);
      await d.calendar.saveScheduleVersion(workspaceId, record);
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'SCHEDULE_SET',
        before: replaced ? shape(replaced) : null,
        after: shape(record),
      });
    });
    const [dto] = await this.#toScheduleDtos([record]);
    return dto!;
  }

  /** `GET attendance/holidays?year=` — sắp theo ngày. */
  listHolidays(workspaceId: string, year: number): Promise<HolidayDto[]> {
    return this.d.calendar.holidays({ workspaceId, from: `${year}-01-01`, to: `${year}-12-31` });
  }

  /** `PUT attendance/holidays/:date` ⇒ 200 (tạo hoặc đổi tên). */
  async putHoliday(
    workspaceId: string,
    actorId: string,
    date: LocalDate,
    body: PutHolidayBody,
  ): Promise<HolidayDto> {
    const { d } = this;
    await d.uow.run(async () => {
      const note = await this.#authorizeHoliday(workspaceId, actorId, date, body.reason);
      const [existing] = await d.calendar.holidays({ workspaceId, from: date, to: date });
      await d.calendar.putHoliday(workspaceId, { date, name: body.name });
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'HOLIDAY_SET',
        before: existing ? { date, name: existing.name } : null,
        after: { date, name: body.name, ...note },
      });
    });
    return { date, name: body.name };
  }

  /** `DELETE attendance/holidays/:date` ⇒ 204, idempotent (không có lễ ⇒ không ghi gì, không audit). */
  async deleteHoliday(
    workspaceId: string,
    actorId: string,
    date: LocalDate,
    reason: string | undefined,
  ): Promise<void> {
    const { d } = this;
    await d.uow.run(async () => {
      const note = await this.#authorizeHoliday(workspaceId, actorId, date, reason);
      const [existing] = await d.calendar.holidays({ workspaceId, from: date, to: date });
      if (!existing || !(await d.calendar.deleteHoliday(workspaceId, date))) return;
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'HOLIDAY_DELETE',
        before: { date, name: existing.name },
        after: note.note === undefined ? null : note,
      });
    });
  }

  /** Quyền ghi + luật ngày đã qua (AT-18). Trả `{ note }` khi OWNER sửa quá khứ (ghi vào audit). */
  async #authorizeHoliday(
    workspaceId: string,
    actorId: string,
    date: LocalDate,
    reason: string | undefined,
  ): Promise<{ note?: string }> {
    const { role } = await this.d.hrAccess.authorizeWrite({ workspaceId, actorId });
    const versions = await this.d.calendar.scheduleVersions(workspaceId);
    if (date >= this.#today(versions)) return {};
    if (role !== 'OWNER') {
      throw new BusinessRuleViolationError(
        'HOLIDAY_IN_PAST',
        'Ngày lễ đã qua chỉ chủ workspace được sửa.',
      );
    }
    if (!reason) {
      throw new BusinessRuleViolationError('REASON_REQUIRED', 'Sửa ngày lễ đã qua cần ghi lý do.');
    }
    return { note: reason };
  }

  /** Hôm nay theo múi giờ của lịch đang hiệu lực. */
  #today(versions: readonly WorkSchedule[]): LocalDate {
    return localToday(versions, this.d.clock.now()).date;
  }

  async #toScheduleDtos(records: readonly ScheduleVersionRecord[]): Promise<WorkScheduleDto[]> {
    const refs = await this.d.users.findRefs([...new Set(records.map((r) => r.createdBy))]);
    return records.map((r) => ({
      ...shape(r),
      createdBy: refs.get(r.createdBy) ?? { id: r.createdBy, fullName: UNKNOWN_USER },
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
