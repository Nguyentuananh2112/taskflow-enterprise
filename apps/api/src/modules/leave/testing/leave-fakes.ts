import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type {
  HrAuditAction,
  IHrAudit,
  ILeaveCompany,
  ILeaveNotifier,
  IWorkCalendarPort,
  LeaveActor,
  LeaveEmployment,
  LeaveNotificationType,
  LeaveRole,
  WorkCalendarDay,
} from '../application/ports/leave.ports';
import type { CalendarDate } from '../domain/leave-days';
import type { LeaveTenure } from '../domain/leave-tenure';

// Fake của các port leave dùng chung cho test A (InMemory) và tầng I/C (Prisma) — adapter thật thuộc company (T-061),
// attendance, notifications. Cùng luật với `CompanyAccess` của B (ADR-135): self tuyệt đối, không còn thuộc công ty
// ⇒ 401 `SESSION_REVOKED`.

const ROLE_PERMS: Record<LeaveRole, string[]> = {
  ADMIN: ['hr:manage', 'payroll:manage', 'company:admin', 'company:grant'],
  EMPLOYEE: ['leave:self', 'attendance:self', 'profile:self'],
};

/** Ngày đầu nhiệm kỳ mặc định của fixture (trước mọi ngày test dùng). */
export const DEFAULT_START = '2020-01-06';

interface Member {
  role: LeaveRole;
  grants: Set<string>;
  startDate: CalendarDate | null;
  lastDay: CalendarDate | null;
}

/** Công ty giả: đổi vai trò / grant / lịch nghỉ / nghỉ việc / nhận lại giữa test (D-M4, B-H3, D H1/H2). */
export class FakeLeaveCompany implements ILeaveCompany {
  readonly members = new Map<string, Member>();
  /** Nhiệm kỳ EMPLOYEE đã đóng (`company_member_departures`). */
  readonly departures: { userId: string; tenure: LeaveTenure }[] = [];

  set(
    userId: string,
    role: LeaveRole,
    grants: string[] = [],
    startDate: CalendarDate = DEFAULT_START,
  ): void {
    this.members.set(userId, {
      role,
      grants: new Set(grants),
      startDate: role === 'EMPLOYEE' ? startDate : null,
      lastDay: null,
    });
  }

  revokeGrant(userId: string, grant: string): void {
    this.members.get(userId)?.grants.delete(grant);
  }

  scheduleOffboard(userId: string, lastDay: CalendarDate): void {
    const m = this.members.get(userId);
    if (m) m.lastDay = lastDay;
  }

  /** Hoàn tất nghỉ việc: đóng nhiệm kỳ tại `lastDay`, xóa dòng thành viên. */
  offboard(userId: string, lastDay: CalendarDate): void {
    const m = this.members.get(userId);
    if (m?.startDate)
      this.departures.push({ userId, tenure: { from: m.startDate, until: lastDay } });
    this.members.delete(userId);
  }

  rehire(userId: string, startDate: CalendarDate): void {
    this.set(userId, 'EMPLOYEE', [], startDate);
  }

  reloadActor(userId: string): Promise<LeaveActor | null> {
    const m = this.members.get(userId);
    if (!m) return Promise.resolve(null);
    const permissions = new Set(ROLE_PERMS[m.role]);
    if (m.grants.has('HR_MANAGE')) permissions.add('hr:manage');
    return Promise.resolve({ userId, role: m.role, permissions });
  }

  async authorizeHrWrite(input: {
    actorId: string;
    targetUserId: string | null;
    reason: string | null;
  }): Promise<LeaveActor> {
    const actor = await this.reloadActor(input.actorId);
    if (!actor) throw new SessionRevokedError();
    if (!actor.permissions.has('hr:manage')) throw new ForbiddenError('hr:manage');
    if (input.targetUserId === input.actorId) throw new ForbiddenError('hr:manage');
    return actor;
  }

  assertActiveEmployee(userId: string): Promise<void> {
    if (this.members.get(userId)?.role !== 'EMPLOYEE') {
      return Promise.reject(new SessionRevokedError());
    }
    return Promise.resolve();
  }

  isEmployee(userId: string): Promise<boolean> {
    return Promise.resolve(this.members.get(userId)?.role === 'EMPLOYEE');
  }

  employmentOf(userId: string): Promise<LeaveEmployment> {
    const m = this.members.get(userId);
    return Promise.resolve({
      current: m?.startDate ? { from: m.startDate, until: null } : null,
      lastDay: m?.lastDay ?? null,
    });
  }

  tenuresOf(input: {
    userIds: readonly string[];
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<ReadonlyMap<string, readonly LeaveTenure[]>> {
    const out = new Map<string, LeaveTenure[]>();
    const overlaps = (t: LeaveTenure) =>
      t.from <= input.to && (t.until === null || t.until >= input.from);
    for (const userId of input.userIds) {
      const list = this.departures.filter((d) => d.userId === userId).map((d) => d.tenure);
      const start = this.members.get(userId)?.startDate;
      if (start) list.push({ from: start, until: null });
      const hit = list.filter(overlaps);
      if (hit.length > 0) out.set(userId, hit);
    }
    return Promise.resolve(out);
  }
}

/** Lịch S0: T2–T7 làm, CN nghỉ, múi giờ VN; ngày lễ thêm/bớt được giữa test (LD-09). */
export class FakeWorkCalendar implements IWorkCalendarPort {
  readonly holidays = new Set<CalendarDate>();
  readonly calls: { from: CalendarDate; to: CalendarDate }[] = [];
  timezone = 'Asia/Ho_Chi_Minh';

  workingDays(input: { from: CalendarDate; to: CalendarDate }): Promise<WorkCalendarDay[]> {
    this.calls.push({ from: input.from, to: input.to });
    const days: WorkCalendarDay[] = [];
    for (
      let d = new Date(`${input.from}T00:00:00Z`);
      d <= new Date(`${input.to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const date = d.toISOString().slice(0, 10);
      days.push({
        date,
        isWorkday: d.getUTCDay() !== 0,
        isHoliday: this.holidays.has(date),
        schedule: { timezone: this.timezone },
      });
    }
    return Promise.resolve(days);
  }
}

export interface SentNotification {
  type: LeaveNotificationType;
  requestId: string;
  actorId: string;
  recipient: { kind: 'user'; userId: string } | { kind: 'hr' };
}

export class SpyLeaveNotifier implements ILeaveNotifier {
  readonly sent: SentNotification[] = [];
  notify(input: SentNotification): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }
}

export interface AuditEntry {
  actorId: string;
  action: HrAuditAction;
  targetUserId: string;
  refId: string | null;
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
  note?: string | null;
}

export class SpyHrAudit implements IHrAudit {
  readonly entries: AuditEntry[] = [];
  record(input: AuditEntry): Promise<void> {
    this.entries.push(input);
    return Promise.resolve();
  }
}
