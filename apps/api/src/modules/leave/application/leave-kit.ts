import type { IClock, IIdGenerator } from '../../../core/domain';
import {
  ForbiddenError,
  ResourceNotFoundError,
  SessionRevokedError,
  ValidationError,
  VersionConflictError,
} from '../../../core/errors';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import { BusinessRuleViolationError } from '../../../core/errors';
import { consumesAnnualBalance, halfDaysToDecimal, type LeaveType } from '../domain/leave-balance';
import type { CalendarDate, HalfDays, LeaveSpan } from '../domain/leave-days';
import { AnnualBalanceCalculator } from './annual-balance';
import { localDate } from '../domain/leave-status';
import type { LeaveTenure } from '../domain/leave-tenure';
import { toLeaveDto, type LeaveRequestDto } from './leave-dto';
import type { ILeaveReadModel, ILeaveUserRefs } from './ports/leave-read-model.port';
import type {
  IHrAudit,
  ILeaveCompany,
  ILeaveHireDates,
  ILeaveNotifier,
  ILeavePolicyStore,
  ILeaveRepository,
  IWorkCalendarPort,
  LeaveActor,
  LeaveBalanceRecord,
  LeaveEmployment,
  LeaveRequestRecord,
  WorkCalendarDay,
} from './ports/leave.ports';

export const PERMISSION_LEAVE_SELF = 'leave:self';
export const PERMISSION_HR_MANAGE = 'hr:manage';

export interface LeaveCommandDeps {
  requests: ILeaveRepository;
  /** T-057 (ADR-131): chính sách phép theo năm + khóa `taskflow:leave-policy` (bậc 1). */
  policies: ILeavePolicyStore;
  /** Ngày vào công ty (hồ sơ T-054); chưa nối ⇒ null cho mọi người. */
  hireDates: ILeaveHireDates;
  calendar: IWorkCalendarPort;
  company: ILeaveCompany;
  notifier: ILeaveNotifier;
  audit: IHrAudit;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
  users: ILeaveUserRefs;
}

/** Người gọi (từ access token). Một công ty ⇒ không còn `workspaceId` (company-level.md ADR-133). */
export interface LeaveScope {
  actorId: string;
}

/**
 * Nhiệm kỳ dùng để ĐẾM phép của một người (D H1/H2): từ ngày đầu nhiệm kỳ hiện tại tới `lastDay` nếu đã có lịch
 * nghỉ việc. Không có nhiệm kỳ hiện tại (Admin / đã nghỉ) ⇒ `null` = không lọc (HR xem số dư người cũ).
 */
export function countingTenure(employment: LeaveEmployment): LeaveTenure | null {
  if (employment.current === null) return null;
  return { from: employment.current.from, until: employment.lastDay ?? employment.current.until };
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
 * Phần dùng chung của các lệnh leave (attendance-leave §9, company-level ADR-136): mọi lệnh đổi số dư / chồng ngày
 * lấy khóa `taskflow:leave:<user>` của NGƯỜI SỞ HỮU ĐƠN, đọc lại quyền (B-H3) và dữ liệu TRONG khóa (D-H2). Số ngày
 * không lưu — tính lại từ lịch mỗi lần (D-H3a), cắt theo nhiệm kỳ.
 */
export class LeaveKit {
  constructor(readonly d: LeaveCommandDeps) {}

  /** Không còn thuộc công ty ⇒ 401 `SESSION_REVOKED` (ADR-135); thiếu quyền ⇒ 403 kèm quyền thiếu. */
  async requireActor(userId: string, permission: string): Promise<LeaveActor> {
    const actor = await this.d.company.reloadActor(userId);
    if (!actor) throw new SessionRevokedError();
    if (!actor.permissions.has(permission)) throw new ForbiddenError(permission);
    return actor;
  }

  requireNote(note: string | null, message: string): void {
    if (!note?.trim()) throw new ValidationError([{ path: ['note'], code: 'too_small', message }]);
  }

  /** Đọc lại TRONG khóa; lệch `expectedVersion` ⇒ 409 version_conflict (LV-11). */
  async reload(requestId: string, expectedVersion: number): Promise<LeaveRequestRecord> {
    const record = await this.d.requests.find(requestId);
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
    const current = await this.d.requests.find(next.id);
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

  /**
   * Thứ tự khóa của MỌI lệnh ghi phép (ADR-131 + ADR-136): `taskflow:leave-policy` SHARED (bậc 1) rồi
   * `taskflow:leave:<user>` (bậc 3) — `PUT leave/policy` lấy bản EXCLUSIVE ⇒ đơn được kiểm theo chính sách trước hoặc
   * sau, không bao giờ lẫn.
   */
  async lockFor(userId: string): Promise<void> {
    await this.d.policies.lock('shared');
    await this.d.requests.lockUser(userId);
  }

  /** Bộ tính số dư cho ĐƯỜNG GHI (trong khóa): đọc repo, tạo lười dòng số dư. */
  calculator(): AnnualBalanceCalculator {
    return this.#calc((userId, year) => this.d.requests.getOrCreateBalance(userId, year));
  }

  /**
   * Bộ tính cho ĐƯỜNG ĐỌC: số dư qua read model, KHÔNG tạo dòng (GET không ghi — ADR-131). `hireDates` thay thế ⇒
   * "nếu đổi ngày vào công ty thì sao" (T-054 `negativeBalancesIfHireDate`).
   */
  readCalculator(
    read: Pick<ILeaveReadModel, 'findBalance'>,
    hireDates: ILeaveHireDates = this.d.hireDates,
  ): AnnualBalanceCalculator {
    return this.#calc((userId, year) => read.findBalance(userId, year), hireDates);
  }

  #calc(
    storedOf: (userId: string, year: number) => Promise<LeaveBalanceRecord | null>,
    hireDates: ILeaveHireDates = this.d.hireDates,
  ): AnnualBalanceCalculator {
    return new AnnualBalanceCalculator({
      policies: this.d.policies,
      hireDates,
      company: this.d.company,
      holdingOf: (userId, year) => this.d.requests.listHolding(userId, year),
      storedOf,
      calendarOf: (year) => this.yearCalendar(year),
    });
  }

  /**
   * 422 INSUFFICIENT_BALANCE (ADR-131 thay ADR-122, cả gửi lẫn duyệt): `extra` = đơn mới chưa lưu (submit); duyệt thì
   * đơn đang xét đã nằm trong `holding` (PENDING) ⇒ không cộng lần nữa. Gọi TRONG khóa (`lockFor`).
   */
  async assertBalance(input: {
    userId: string;
    year: number;
    type: LeaveType;
    holding: readonly LeaveRequestRecord[];
    tenure: LeaveTenure | null;
    today: CalendarDate;
    extra?: LeaveSpan;
  }): Promise<void> {
    if (!consumesAnnualBalance(input.type)) return;
    const calc = this.calculator();
    const base = {
      userId: input.userId,
      year: input.year,
      today: input.today,
      tenure: input.tenure,
      holding: input.holding,
    };
    const view = await calc.compute(
      input.extra ? { ...base, extra: { ...input.extra, type: input.type } } : base,
    );
    if (view.balance.covers) return;
    const without = input.extra ? await calc.compute(base) : view;
    const requested = input.extra
      ? view.balance.usedEarly +
        view.balance.usedLate -
        without.balance.usedEarly -
        without.balance.usedLate
      : 0;
    throw new BusinessRuleViolationError(
      'INSUFFICIENT_BALANCE',
      'Không đủ số ngày phép năm còn lại.',
      {
        remainingDays: halfDaysToDecimal(without.balance.remaining),
        requestedDays: halfDaysToDecimal(requested),
      },
    );
  }

  /**
   * Chụp phép chuyển sang năm `year` (ADR-131) khi năm đó ĐÃ bắt đầu và dòng còn NULL — trong khóa, idempotent
   * (`ifNull`). Gọi ở submit / approve / PATCH số dư / PUT policy.
   */
  async snapshotCarried(userId: string, year: number, today: CalendarDate): Promise<boolean> {
    if (today < `${String(year)}-01-01`) return false;
    const stored = await this.d.requests.getOrCreateBalance(userId, year);
    if (stored.carried !== null) return false;
    const carried = await this.calculator().carriedInto(userId, year);
    await this.d.requests.setCarried(userId, year, carried, 'ifNull');
    return true;
  }

  /**
   * Năm `year` vừa đổi (PATCH điều chỉnh, duyệt muộn một đơn của `year`) ⇒ nếu `year + 1` đã bắt đầu và ĐÃ chụp
   * `carried`, tính lại trong cùng khóa (ADR-131). Chưa chụp ⇒ để NULL (đọc sẽ tính tạm theo số mới).
   */
  async refreshNextCarried(userId: string, year: number, today: CalendarDate): Promise<void> {
    const next = year + 1;
    if (today < `${String(next)}-01-01`) return;
    const stored = await this.d.requests.getOrCreateBalance(userId, next);
    if (stored.carried === null) return;
    const carried = await this.calculator().carriedInto(userId, next);
    await this.d.requests.setCarried(userId, next, carried, 'overwrite');
  }

  /** Cả năm của lịch (đơn không vắt năm) — một lần gọi port phủ đơn mới + mọi đơn đang giữ chỗ cùng năm. */
  yearCalendar(year: number): Promise<WorkCalendarDay[]> {
    return this.d.calendar.workingDays({
      from: `${String(year)}-01-01`,
      to: `${String(year)}-12-31`,
    });
  }

  /**
   * "Hôm nay" theo múi giờ của lịch hiệu lực ĐÚNG ngày địa phương đó (D-M5, ADR-120 — A review LOW-1). Một lần gọi
   * port cho [UTC − 1, UTC + 1] rồi chọn ngày `d` có `localDate(now, d.timezone) === d.date`.
   */
  async today(): Promise<CalendarDate> {
    const now = this.d.clock.now();
    const shift = (days: number) =>
      new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const days = await this.d.calendar.workingDays({ from: shift(-1), to: shift(1) });
    const match = days.find((d) => localDate(now, d.schedule.timezone) === d.date);
    if (!match) throw new Error('WorkCalendarPort không trả lịch cho hôm nay');
    return match.date;
  }
}
