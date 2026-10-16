import { FakeClock, SequentialIdGenerator } from '../../../../test/support';
import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import { LeaveCommands } from '../application/leave-commands';
import type {
  HrAuditAction,
  IHrAudit,
  ILeaveMembership,
  ILeaveNotifier,
  IWorkCalendarPort,
  LeaveActor,
  LeaveNotificationType,
  LeaveRequestRecord,
  LeaveRole,
  WorkCalendarDay,
} from '../application/ports/leave.ports';
import type { CalendarDate } from '../domain/leave-days';
import { InMemoryLeaveRepository } from '../infrastructure/persistence/in-memory/in-memory-leave.repository';

/** Fixture chuẩn test-spec-hr §0.2. */
export const W1 = 'w1';
export const W2 = 'w2';
export const U = {
  Olivia: 'u-olivia', // OWNER (hr:manage + hr:grant theo role)
  Hana: 'u-hana', // MEMBER + grant HR_MANAGE
  Pam: 'u-pam', // PM
  Mia: 'u-mia',
  Max: 'u-max',
  Vic: 'u-vic', // VIEWER
  Rex: 'u-rex', // đã rời W1
  Otto: 'u-otto', // OWNER của W2
} as const;
/** Thứ Ba 17/11/2026 10:00 giờ VN. */
export const NOW = '2026-11-17T03:00:00.000Z';

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

export function createLeaveHarness() {
  const requests = new InMemoryLeaveRepository();
  const calendar = new FakeWorkCalendar();
  const membership = new FakeLeaveMembership();
  const notifier = new SpyLeaveNotifier();
  const audit = new SpyHrAudit();
  const uow = new FakeUnitOfWork(requests);
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();

  membership.set(W1, U.Olivia, 'OWNER');
  membership.set(W1, U.Hana, 'MEMBER', ['HR_MANAGE']);
  membership.set(W1, U.Pam, 'PM');
  membership.set(W1, U.Mia, 'MEMBER');
  membership.set(W1, U.Max, 'MEMBER');
  membership.set(W1, U.Vic, 'VIEWER');
  membership.set(W2, U.Otto, 'OWNER');

  const leave = new LeaveCommands({
    requests,
    calendar,
    membership,
    notifier,
    audit,
    uow,
    clock,
    ids,
  });
  const as = (actorId: string, workspaceId: string = W1) => ({ workspaceId, actorId });

  /** Đơn có sẵn (không qua use case) — mặc định ANNUAL FULL PENDING của Mia. */
  const seed = (over: Partial<LeaveRequestRecord> & { id: string }): LeaveRequestRecord => {
    const at = new Date(NOW);
    const record: LeaveRequestRecord = {
      workspaceId: W1,
      userId: U.Mia,
      type: 'ANNUAL',
      startDate: '2026-11-23',
      endDate: '2026-11-23',
      dayPart: 'FULL',
      reason: 'việc riêng',
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
      ...over,
    };
    requests.seed(record);
    return record;
  };

  return { leave, requests, calendar, membership, notifier, audit, uow, clock, ids, as, seed };
}
