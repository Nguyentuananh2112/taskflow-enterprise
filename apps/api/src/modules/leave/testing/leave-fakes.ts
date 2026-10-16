import {
  BusinessRuleViolationError,
  ForbiddenError,
  ResourceNotFoundError,
} from '../../../core/errors';
import type {
  HrAuditAction,
  IHrAudit,
  ILeaveMembership,
  ILeaveNotifier,
  IWorkCalendarPort,
  LeaveActor,
  LeaveNotificationType,
  LeaveRole,
  WorkCalendarDay,
} from '../application/ports/leave.ports';
import type { CalendarDate } from '../domain/leave-days';

// Fake của các port leave dùng chung cho test A (InMemory) và tầng I/C (Prisma) — adapter thật thuộc T-037/T-038/T-040.

const ROLE_PERMS: Record<LeaveRole, string[]> = {
  OWNER: ['leave:self', 'hr:manage', 'hr:grant'],
  PM: ['leave:self'],
  MEMBER: ['leave:self'],
  VIEWER: [],
};

/** Membership giả: đổi role / grant / rời ws giữa test (D-M4, B-H3). */
export class FakeLeaveMembership implements ILeaveMembership {
  readonly members = new Map<string, { role: LeaveRole; grants: Set<string> }>();

  set(workspaceId: string, userId: string, role: LeaveRole, grants: string[] = []): void {
    this.members.set(`${workspaceId}:${userId}`, { role, grants: new Set(grants) });
  }

  remove(workspaceId: string, userId: string): void {
    this.members.delete(`${workspaceId}:${userId}`);
  }

  revokeGrant(workspaceId: string, userId: string, grant: string): void {
    this.members.get(`${workspaceId}:${userId}`)?.grants.delete(grant);
  }

  reloadActor(workspaceId: string, userId: string): Promise<LeaveActor | null> {
    const m = this.members.get(`${workspaceId}:${userId}`);
    if (!m) return Promise.resolve(null);
    const permissions = new Set(ROLE_PERMS[m.role]);
    if (m.grants.has('HR_MANAGE')) permissions.add('hr:manage');
    return Promise.resolve({ userId, role: m.role, permissions });
  }

  /** Cùng luật với `HrAccess.authorizeWrite` của T-037 (bản thật chạy ở test HTTP / LSP của B). */
  async authorizeHrWrite(input: {
    workspaceId: string;
    actorId: string;
    targetUserId: string | null;
    reason: string | null;
  }): Promise<LeaveActor> {
    const actor = await this.reloadActor(input.workspaceId, input.actorId);
    if (!actor) throw new ResourceNotFoundError('workspace');
    if (!actor.permissions.has('hr:manage')) throw new ForbiddenError('hr:manage');
    if (input.targetUserId === input.actorId) {
      if (actor.role !== 'OWNER') throw new ForbiddenError('hr:manage');
      if (!input.reason?.trim()) {
        throw new BusinessRuleViolationError(
          'REASON_REQUIRED',
          'Tự xử lý dữ liệu nhân sự của chính mình cần ghi lý do.',
        );
      }
    }
    return actor;
  }

  isEligibleRequester(workspaceId: string, userId: string): Promise<boolean> {
    const m = this.members.get(`${workspaceId}:${userId}`);
    return Promise.resolve(!!m && m.role !== 'VIEWER');
  }
}

/** Lịch S0: T2–T7 làm, CN nghỉ, múi giờ VN; ngày lễ thêm/bớt được giữa test (LD-09). */
export class FakeWorkCalendar implements IWorkCalendarPort {
  readonly holidays = new Set<CalendarDate>();
  readonly calls: { from: CalendarDate; to: CalendarDate }[] = [];
  timezone = 'Asia/Ho_Chi_Minh';

  workingDays(input: {
    workspaceId: string;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<WorkCalendarDay[]> {
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
  workspaceId: string;
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
  workspaceId: string;
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
