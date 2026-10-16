import type { IClock, IIdGenerator } from '../../../core/domain';
import {
  ForbiddenError,
  ResourceNotFoundError,
  ValidationError,
  VersionConflictError,
} from '../../../core/errors';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import {
  assertBalanceCovers,
  consumesAnnualBalance,
  summarizeBalance,
  type LeaveType,
} from '../domain/leave-balance';
import { countLeaveHalfDays, type CalendarDate, type HalfDays } from '../domain/leave-days';
import { localDate } from '../domain/leave-status';
import { toLeaveDto, type LeaveRequestDto } from './leave-dto';
import type { ILeaveUserRefs } from './ports/leave-read-model.port';
import type {
  IHrAudit,
  ILeaveMembership,
  ILeaveNotifier,
  ILeaveRepository,
  IWorkCalendarPort,
  LeaveActor,
  LeaveRequestRecord,
  WorkCalendarDay,
} from './ports/leave.ports';

export const PERMISSION_LEAVE_SELF = 'leave:self';
export const PERMISSION_HR_MANAGE = 'hr:manage';

export interface LeaveCommandDeps {
  requests: ILeaveRepository;
  calendar: IWorkCalendarPort;
  membership: ILeaveMembership;
  notifier: ILeaveNotifier;
  audit: IHrAudit;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
  users: ILeaveUserRefs;
}

export interface LeaveScope {
  workspaceId: string;
  actorId: string;
}

/** Số dư từ bản ghi đã lưu + các đơn đang giữ chỗ, số ngày tính theo lịch hiện tại (D-H3a). */
export function summarizeStored(
  stored: { entitled: HalfDays; adjustment: HalfDays },
  holding: readonly LeaveRequestRecord[],
  calendar: readonly WorkCalendarDay[],
  excludeId?: string,
) {
  return summarizeBalance({
    entitled: stored.entitled,
    adjustment: stored.adjustment,
    requests: holding.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      halfDays: countLeaveHalfDays(r, calendar),
    })),
    ...(excludeId === undefined ? {} : { excludeId }),
  });
}

export const yearOf = (date: CalendarDate): number => Number(date.slice(0, 4));

/** Ảnh audit KHÔNG có `reason` (B-H2). */
export const auditView = (r: LeaveRequestRecord) => ({
  type: r.type,
  startDate: r.startDate,
  endDate: r.endDate,
  dayPart: r.dayPart,
  status: r.status,
  version: r.version,
});

/**
 * Phần dùng chung của các lệnh leave (thiết kế §2 ADR-122, §9): mọi lệnh đổi số dư / chồng ngày lấy khóa
 * (ws, user) của NGƯỜI SỞ HỮU ĐƠN, đọc lại membership + quyền (B-H3) và dữ liệu TRONG khóa (D-H2). Số ngày
 * không lưu — tính lại từ lịch mỗi lần (D-H3a).
 */
export class LeaveKit {
  constructor(readonly d: LeaveCommandDeps) {}

  /** Không còn là thành viên ⇒ 404 workspace (ADR-020); thiếu quyền ⇒ 403 kèm quyền thiếu. */
  async requireActor(workspaceId: string, userId: string, permission: string): Promise<LeaveActor> {
    const actor = await this.d.membership.reloadActor(workspaceId, userId);
    if (!actor) throw new ResourceNotFoundError('workspace');
    if (!actor.permissions.has(permission)) throw new ForbiddenError(permission);
    return actor;
  }

  requireNote(note: string | null, message: string): void {
    if (!note?.trim()) throw new ValidationError([{ path: ['note'], code: 'too_small', message }]);
  }

  /** Đọc lại TRONG khóa; lệch `expectedVersion` ⇒ 409 version_conflict (LV-11). */
  async reload(
    workspaceId: string,
    requestId: string,
    expectedVersion: number,
  ): Promise<LeaveRequestRecord> {
    const record = await this.d.requests.find(workspaceId, requestId);
    if (!record) throw new ResourceNotFoundError('leave_request');
    if (record.version !== expectedVersion) throw new VersionConflictError(record.version);
    return record;
  }

  async save(
    next: LeaveRequestRecord,
    previous: LeaveRequestRecord,
    halfDays: HalfDays,
  ): Promise<void> {
    if (await this.d.requests.save(next, previous.version)) return;
    const current = await this.d.requests.find(next.workspaceId, next.id);
    throw new VersionConflictError(
      current?.version ?? previous.version,
      current ? await this.dto(current, halfDays) : null,
    );
  }

  /** DTO cho người gửi / HR (có `reason`), kèm tên hiển thị `user` + `decidedBy`. */
  async dto(record: LeaveRequestRecord, halfDays: HalfDays): Promise<LeaveRequestDto> {
    const ids = record.decidedBy === null ? [record.userId] : [record.userId, record.decidedBy];
    const refs = await this.d.users.findRefs(ids);
    return toLeaveDto(record, halfDays, refs, { includeReason: true });
  }

  /** 422 INSUFFICIENT_BALANCE nếu đơn ANNUAL vượt số dư (LB-02: `excludeId` = chính đơn đang duyệt). */
  async assertBalance(input: {
    workspaceId: string;
    userId: string;
    year: number;
    type: LeaveType;
    requested: HalfDays;
    holding: readonly LeaveRequestRecord[];
    calendar: readonly WorkCalendarDay[];
    excludeId?: string;
  }): Promise<void> {
    if (!consumesAnnualBalance(input.type)) return;
    const stored = await this.d.requests.getOrCreateBalance(
      input.workspaceId,
      input.userId,
      input.year,
    );
    const balance = summarizeStored(stored, input.holding, input.calendar, input.excludeId);
    assertBalanceCovers(input.type, input.requested, balance);
  }

  /** Cả năm của lịch (đơn không vắt năm) — một lần gọi port phủ đơn mới + mọi đơn đang giữ chỗ cùng năm. */
  yearCalendar(workspaceId: string, year: number): Promise<WorkCalendarDay[]> {
    return this.d.calendar.workingDays({
      workspaceId,
      from: `${String(year)}-01-01`,
      to: `${String(year)}-12-31`,
    });
  }

  /**
   * "Hôm nay" theo múi giờ của lịch hiệu lực ĐÚNG ngày địa phương đó (D-M5, ADR-120 — A review LOW-1). Một lần gọi
   * port cho [UTC − 1, UTC + 1] rồi chọn ngày `d` có `localDate(now, d.timezone) === d.date` — đúng cả quanh nửa
   * đêm và vào ngày đổi phiên bản lịch có đổi múi giờ (cùng cách `localToday` của attendance).
   */
  async today(workspaceId: string): Promise<CalendarDate> {
    const now = this.d.clock.now();
    const shift = (days: number) =>
      new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const days = await this.d.calendar.workingDays({ workspaceId, from: shift(-1), to: shift(1) });
    const match = days.find((d) => localDate(now, d.schedule.timezone) === d.date);
    if (!match) throw new Error('WorkCalendarPort không trả lịch cho hôm nay');
    return match.date;
  }
}
