// T-062: hoàn tất nghỉ việc (ADR-137 "Hoàn tất", ADR-136 thứ tự khóa) trên lưu trữ bộ nhớ — thứ tự khóa / dọn đơn
// TRƯỚC khi đụng dòng (D HIGH-1), đúng một departure, thu hồi phiên lỗi ⇒ rollback toàn bộ (SEC-HR-66).
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeClock,
  FakeUnitOfWork,
  SequentialIdGenerator,
  SpyLogger,
} from '../../../../test/support';
import { ServiceUnavailableError } from '../../../core/errors';
import { CompanyAccess } from '../application/company-access';
import { HrAuditWriter } from '../application/hr-audit-writer';
import type { ICompanyAccounts } from '../application/ports/accounts.port';
import type { EmploymentCollaborators } from '../application/ports/employment-collaborators.port';
import { CompleteOffboardingUseCase } from '../application/use-cases/complete-offboarding.use-case';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import { InMemoryCompanyOffboarding } from '../infrastructure/in-memory/in-memory-company-offboarding';
import { InMemoryCompanyStore } from '../infrastructure/in-memory/in-memory-company';
import { InMemoryHrAuditLog } from '../infrastructure/in-memory/in-memory-hr-audit-log';

const NOW = '2026-11-02T00:00:00.000Z'; // 07:00 02/11 giờ VN — đã qua 06:00 sau ngày làm cuối 01/11
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [HR, MIA] = [id(1), id(2)] as [string, string];

let store: InMemoryCompanyStore;
let events: string[];
let failSessions: boolean;
let completer: CompleteOffboardingUseCase;
let uow: FakeUnitOfWork;

const member = (over: Partial<CompanyMemberSnapshot> & { userId: string }) => ({
  role: 'EMPLOYEE' as const,
  grants: [],
  startDate: '2026-10-01',
  offboardLastDay: null,
  offboardAccessUntil: null,
  offboardScheduledById: null,
  version: 1,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...over,
});

beforeEach(() => {
  store = new InMemoryCompanyStore();
  events = [];
  failSessions = false;
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const hrAudit = new InMemoryHrAuditLog(() => undefined);
  uow = new FakeUnitOfWork(store, hrAudit);
  store.upsertMember(member({ userId: HR, grants: ['HR_MANAGE'] }));
  store.upsertMember(
    member({
      userId: MIA,
      offboardLastDay: '2026-11-01',
      offboardAccessUntil: new Date('2026-11-01T23:00:00.000Z'), // 06:00 02/11 giờ VN
      offboardScheduledById: HR,
    }),
  );
  const offboarding = new InMemoryCompanyOffboarding(store);
  const deleteIfDue = offboarding.deleteIfDue.bind(offboarding);
  offboarding.deleteIfDue = (userId, at) => {
    events.push('delete-row');
    return deleteIfDue(userId, at);
  };
  const accounts = {
    revokeActivations: () => (events.push('revoke-activations'), Promise.resolve(0)),
    revokeSessions: () => {
      events.push('revoke-sessions');
      return failSessions ? Promise.reject(new ServiceUnavailableError()) : Promise.resolve();
    },
  } as unknown as ICompanyAccounts;
  const collaborators: EmploymentCollaborators = {
    workspaceExit: {
      endMembership: () => (
        events.push('end-membership'),
        Promise.resolve({ workspaceIds: [], orphaned: [] })
      ),
      soleOwnerWorkspaces: () => Promise.resolve([]),
    },
    offboardLeave: {
      offboardCleanup: (input) => {
        events.push(`cleanup:${input.lastDay}:${input.actorId}`);
        return Promise.resolve({ cancelled: 1, revoked: 0 });
      },
    },
    rehireLeave: {
      resetOnRehire: () => Promise.resolve(false),
      pendingCount: () => Promise.resolve(0),
    },
    notifier: { notify: () => Promise.resolve() },
    realtime: { notifyCompanyAccessChanged: () => Promise.resolve() },
  };
  completer = new CompleteOffboardingUseCase({
    access: new CompanyAccess({ members: store, clock }),
    members: store,
    offboarding,
    accounts,
    collaborators: () => collaborators,
    audit: new HrAuditWriter({ hrAudit, ids, clock }),
    uow,
    ids,
    clock,
    timeZone: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    logger: new SpyLogger(),
  });
});

describe('CompleteOffboardingUseCase (ADR-137 Hoàn tất)', () => {
  it('khóa leave rồi punch → dọn đơn → xóa dòng → departure → rời ws → token → phiên (đúng thứ tự)', async () => {
    expect(await completer.completeOne(MIA)).toBe(true);
    expect(store.locks).toEqual([`taskflow:leave:${MIA}`, `taskflow:attendance:punch:${MIA}`]);
    expect(events).toEqual([
      `cleanup:2026-11-01:${HR}`,
      'delete-row',
      'end-membership',
      'revoke-activations',
      'revoke-sessions',
    ]);
    expect(await store.find(MIA)).toBeNull();
    expect(store.departures()).toEqual([
      expect.objectContaining({
        userId: MIA,
        firstDay: '2026-10-01',
        lastDay: '2026-11-01',
        reason: 'OFFBOARDED',
      }),
    ]);
  });

  it('chạy lại / job song song ⇒ không làm lần hai (đúng một departure)', async () => {
    expect(await completer.completeOne(MIA)).toBe(true);
    expect(await completer.completeOne(MIA)).toBe(false);
    expect(store.departures()).toHaveLength(1);
    expect(await completer.runDue()).toEqual({ completed: 0, failed: 0 });
  });

  it('chưa tới access_until ⇒ không làm gì', async () => {
    const m = await store.find(MIA);
    store.upsertMember({ ...m!, offboardAccessUntil: new Date('2026-11-03T00:00:00.000Z') });
    expect(await completer.completeOne(MIA)).toBe(false);
    expect(events).toEqual([]);
    expect(await store.find(MIA)).not.toBeNull();
  });

  it('SEC-HR-66: ghi Valkey lỗi ⇒ rollback TOÀN BỘ (dòng còn, không departure); job ghi lỗi và lượt sau thử lại', async () => {
    failSessions = true;
    expect(await completer.runDue()).toEqual({ completed: 0, failed: 1 });
    expect(uow.rollbacks).toBe(1);
    expect(await store.find(MIA)).not.toBeNull();
    expect(store.departures()).toEqual([]);
    failSessions = false;
    expect(await completer.runDue()).toEqual({ completed: 1, failed: 0 });
    expect(store.departures()).toHaveLength(1);
  });
});
