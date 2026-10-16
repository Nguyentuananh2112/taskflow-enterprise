import { FakeClock, SequentialIdGenerator } from '../../../../test/support';
import type { UserRefDto } from '@taskflow/contracts';

import { LeaveCommands } from '../application/leave-commands';
import { LeaveQueries } from '../application/leave-queries';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
  ILeaveUserRefs,
} from '../application/ports/leave-read-model.port';
import type { LeaveRequestRecord } from '../application/ports/leave.ports';
import { FakeLeaveMembership, FakeWorkCalendar, SpyHrAudit, SpyLeaveNotifier } from './leave-fakes';
import { inMemoryLeaveBackend, RecordingLeaveRepository, type LeaveBackend } from './leave-backend';

export * from './leave-fakes';

/** Fixture chuẩn test-spec-hr §0.2. */
// UUID thật (cột uuid ở bản Prisma — tầng I/C dùng chung harness).
export const W1 = '00000000-0000-7000-8000-0000000a0001';
export const W2 = '00000000-0000-7000-8000-0000000a0002';
export const U = {
  Olivia: '00000000-0000-7000-8000-0000000b0001', // OWNER (hr:manage + hr:grant theo role)
  Hana: '00000000-0000-7000-8000-0000000b0002', // MEMBER + grant HR_MANAGE
  Pam: '00000000-0000-7000-8000-0000000b0003', // PM
  Mia: '00000000-0000-7000-8000-0000000b0004',
  Max: '00000000-0000-7000-8000-0000000b0005',
  Vic: '00000000-0000-7000-8000-0000000b0006', // VIEWER
  Rex: '00000000-0000-7000-8000-0000000b0007', // đã rời W1
  Otto: '00000000-0000-7000-8000-0000000b0008', // OWNER của W2
} as const;
/** Thứ Ba 17/11/2026 10:00 giờ VN. */
export const NOW = '2026-11-17T03:00:00.000Z';

/** Tên hiển thị = tên fixture (Mia, Hana…); xóa khỏi `names` để giả user đã ẩn danh. Đếm lần gọi (N+1). */
export class FakeUserRefs implements ILeaveUserRefs {
  readonly names = new Map<string, string>(Object.entries(U).map(([name, id]) => [id, name]));
  calls = 0;

  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRefDto>> {
    this.calls += 1;
    const refs = new Map<string, UserRefDto>();
    for (const id of ids) {
      const fullName = this.names.get(id);
      if (fullName !== undefined) refs.set(id, { id, fullName });
    }
    return Promise.resolve(refs);
  }
}

/** Nhân viên = thành viên không phải VIEWER của fake membership, tên từ FakeUserRefs, keyset (tên, id). */
export class FakeEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(
    private readonly membership: FakeLeaveMembership,
    private readonly users: FakeUserRefs,
  ) {}

  listEmployees(
    workspaceId: string,
    after: EmployeeKey | null,
    limit: number,
  ): Promise<UserRefDto[]> {
    const cmp = (x: UserRefDto, y: EmployeeKey) =>
      x.fullName < y.fullName
        ? -1
        : x.fullName > y.fullName
          ? 1
          : x.id < y.id
            ? -1
            : x.id > y.id
              ? 1
              : 0;
    const people = [...this.membership.members.entries()]
      .filter(([k, m]) => k.startsWith(`${workspaceId}:`) && m.role !== 'VIEWER')
      .map(([k]) => {
        const id = k.slice(workspaceId.length + 1);
        return { id, fullName: this.users.names.get(id) ?? id };
      })
      .filter((u) => after === null || cmp(u, after) > 0)
      .sort(cmp);
    return Promise.resolve(people.slice(0, limit));
  }
}

export async function createLeaveHarness(backend: LeaveBackend = inMemoryLeaveBackend()) {
  await backend.prepare({ workspaces: [W1, W2], users: Object.values(U) });
  const requests = new RecordingLeaveRepository(backend.requests);
  const { uow } = backend;
  const calendar = new FakeWorkCalendar();
  const membership = new FakeLeaveMembership();
  const notifier = new SpyLeaveNotifier();
  const audit = new SpyHrAudit();
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const users = new FakeUserRefs();

  membership.set(W1, U.Olivia, 'OWNER');
  membership.set(W1, U.Hana, 'MEMBER', ['HR_MANAGE']);
  membership.set(W1, U.Pam, 'PM');
  membership.set(W1, U.Mia, 'MEMBER');
  membership.set(W1, U.Max, 'MEMBER');
  membership.set(W1, U.Vic, 'VIEWER');
  membership.set(W2, U.Otto, 'OWNER');

  const deps = { requests, calendar, membership, notifier, audit, uow, clock, ids, users };
  const leave = new LeaveCommands(deps);
  const employees = new FakeEmployeeDirectory(membership, users);
  const queries = new LeaveQueries({ ...deps, readModel: backend.readModel, employees });
  const as = (actorId: string, workspaceId: string = W1) => ({ workspaceId, actorId });

  /** Đơn có sẵn (không qua use case) — mặc định ANNUAL FULL PENDING của Mia. */
  const seed = async (
    over: Partial<LeaveRequestRecord> & { id: string },
  ): Promise<LeaveRequestRecord> => {
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
    await backend.seed(record);
    return record;
  };

  return {
    leave,
    queries,
    users,
    employees,
    requests,
    locks: requests.locks,
    rows: () => backend.rows(),
    calendar,
    membership,
    notifier,
    audit,
    uow,
    clock,
    ids,
    as,
    seed,
  };
}
