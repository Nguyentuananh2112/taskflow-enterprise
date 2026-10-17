import { FakeClock, SequentialIdGenerator } from '../../../../test/support';
import type { UserRefDto } from '@taskflow/contracts';

import { LeaveCommands } from '../application/leave-commands';
import { LeaveKit } from '../application/leave-kit';
import { LeaveQueries } from '../application/leave-queries';
import { EmploymentLeaveHooks } from '../application/use-cases/employment-hooks.use-cases';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
  ILeaveUserRefs,
} from '../application/ports/leave-read-model.port';
import type { LeaveRequestRecord } from '../application/ports/leave.ports';
import {
  FakeHireDates,
  FakeLeaveCompany,
  FakeWorkCalendar,
  SpyHrAudit,
  SpyLeaveNotifier,
} from './leave-fakes';
import {
  inMemoryLeaveBackend,
  RecordingLeavePolicyStore,
  RecordingLeaveRepository,
  type LeaveBackend,
} from './leave-backend';

export * from './leave-fakes';

/**
 * Fixture cấp công ty (company-level ADR-140, thay test-spec-hr §0.2 theo workspace). UUID thật (cột uuid ở bản
 * Prisma — tầng I/C dùng chung harness).
 */
export const U = {
  Olivia: '00000000-0000-7000-8000-0000000b0001', // ADMIN — không phải nhân viên (không leave:self)
  Hana: '00000000-0000-7000-8000-0000000b0002', // EMPLOYEE + grant HR_MANAGE
  Pam: '00000000-0000-7000-8000-0000000b0003', // EMPLOYEE
  Mia: '00000000-0000-7000-8000-0000000b0004', // EMPLOYEE
  Max: '00000000-0000-7000-8000-0000000b0005', // EMPLOYEE
  Vic: '00000000-0000-7000-8000-0000000b0006', // ADMIN thứ hai
  Rex: '00000000-0000-7000-8000-0000000b0007', // đã nghỉ việc (nhiệm kỳ 2020-01-06 … 2026-10-31)
  Otto: '00000000-0000-7000-8000-0000000b0008', // không thuộc công ty (chưa từng)
} as const;
export const REX_LAST_DAY = '2026-10-31';
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

/** Nhân viên = role EMPLOYEE của công ty giả (kể cả sắp nghỉ), tên từ FakeUserRefs, keyset (tên, id). */
export class FakeEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(
    private readonly company: FakeLeaveCompany,
    private readonly users: FakeUserRefs,
  ) {}

  listEmployees(after: EmployeeKey | null, limit: number): Promise<UserRefDto[]> {
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
    const people = [...this.company.members.entries()]
      .filter(([, m]) => m.role === 'EMPLOYEE')
      .map(([id]) => ({ id, fullName: this.users.names.get(id) ?? id }))
      .filter((u) => after === null || cmp(u, after) > 0)
      .sort(cmp);
    return Promise.resolve(people.slice(0, limit));
  }
}

export async function createLeaveHarness(backend: LeaveBackend = inMemoryLeaveBackend()) {
  await backend.prepare({ users: Object.values(U) });
  const requests = new RecordingLeaveRepository(backend.requests);
  const { uow } = backend;
  const calendar = new FakeWorkCalendar();
  const company = new FakeLeaveCompany();
  const notifier = new SpyLeaveNotifier();
  const audit = new SpyHrAudit();
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const users = new FakeUserRefs();

  company.set(U.Olivia, 'ADMIN');
  company.set(U.Hana, 'EMPLOYEE', ['HR_MANAGE']);
  company.set(U.Pam, 'EMPLOYEE');
  company.set(U.Mia, 'EMPLOYEE');
  company.set(U.Max, 'EMPLOYEE');
  company.set(U.Vic, 'ADMIN');
  company.set(U.Rex, 'EMPLOYEE');
  company.offboard(U.Rex, REX_LAST_DAY);

  // T-057: khóa policy ghi vào CÙNG `requests.locks` (thứ tự policy SHARED → leave:<user>); ngày vào công ty giả.
  const policies = new RecordingLeavePolicyStore(backend.policies, requests.locks);
  const hireDates = new FakeHireDates();
  const deps = {
    requests,
    policies,
    hireDates,
    calendar,
    company,
    notifier,
    audit,
    uow,
    clock,
    ids,
    users,
  };
  const leave = new LeaveCommands(deps);
  const employees = new FakeEmployeeDirectory(company, users);
  const queries = new LeaveQueries({ ...deps, readModel: backend.readModel, employees });
  const as = (actorId: string) => ({ actorId });
  const hooks = new EmploymentLeaveHooks(new LeaveKit(deps), backend.readModel);

  /** Đơn có sẵn (không qua use case) — mặc định ANNUAL FULL PENDING của Mia. */
  const seed = async (
    over: Partial<LeaveRequestRecord> & { id: string },
  ): Promise<LeaveRequestRecord> => {
    const at = new Date(NOW);
    const record: LeaveRequestRecord = {
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
    readModel: backend.readModel,
    users,
    employees,
    requests,
    locks: requests.locks,
    rows: () => backend.rows(),
    calendar,
    company,
    hooks,
    policies: backend.policies,
    hireDates,
    notifier,
    audit,
    uow,
    clock,
    ids,
    as,
    seed,
  };
}
