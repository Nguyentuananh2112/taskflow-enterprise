import type { IClock, IIdGenerator } from '../../../core/domain';
import {
  BusinessRuleViolationError,
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
import { toLeaveDto } from './leave-dto';
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
}

export interface LeaveScope {
  workspaceId: string;
  actorId: string;
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

  /**
   * B-H1 (quy ước chung attendance + leave, B): lệnh `hr:manage` nhắm vào CHÍNH MÌNH ⇒ 403 (kiểm TRƯỚC lý do),
   * trừ OWNER (R26) — OWNER tự làm mà thiếu lý do ⇒ 422 `REASON_REQUIRED` (lý do CÓ ĐIỀU KIỆN theo người gọi,
   * schema không biết actor). Sẽ thay bằng helper `assertHrWrite` của T-037 phần 2.
   */
  assertNotSelf(actor: LeaveActor, targetUserId: string, note: string | null): void {
    if (actor.userId !== targetUserId) return;
    if (actor.role !== 'OWNER') {
      throw new ForbiddenError(
        PERMISSION_HR_MANAGE,
        'Không thể tự xử lý dữ liệu nghỉ phép của mình.',
      );
    }
    if (!note?.trim()) {
      throw new BusinessRuleViolationError(
        'REASON_REQUIRED',
        'Chủ workspace tự xử lý dữ liệu của mình phải ghi lý do.',
      );
    }
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
      current ? toLeaveDto(current, halfDays, { includeReason: true }) : null,
    );
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
    const balance = summarizeBalance({
      entitled: stored.entitled,
      adjustment: stored.adjustment,
      requests: input.holding.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        halfDays: countLeaveHalfDays(r, input.calendar),
      })),
      ...(input.excludeId === undefined ? {} : { excludeId: input.excludeId }),
    });
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
   * "Hôm nay" theo múi giờ của lịch hiệu lực (D-M5). Múi giờ lấy từ lịch của ngày UTC hiện tại — phiên bản lịch
   * chỉ đổi theo ngày nên sai lệch ±1 ngày quanh nửa đêm không đổi múi giờ (trừ chính ngày đổi múi giờ — chấp nhận).
   */
  async today(workspaceId: string): Promise<CalendarDate> {
    const now = this.d.clock.now();
    const utc = now.toISOString().slice(0, 10);
    const [day] = await this.d.calendar.workingDays({ workspaceId, from: utc, to: utc });
    if (!day) throw new Error('WorkCalendarPort không trả lịch cho hôm nay');
    return localDate(now, day.schedule.timezone);
  }
}
