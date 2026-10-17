// T-061a: chốt quyền / khóa / audit của `/admin/workspaces` phía company (port workspace giả).
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeClock, FakeUnitOfWork } from '../../../../test/support';
import { CompanyAccess } from '../application/company-access';
import type {
  AdminWorkspaceView,
  IAdminWorkspaces,
} from '../application/ports/admin-workspaces.port';
import { AdminWorkspacesUseCases } from '../application/use-cases/admin-workspaces.use-cases';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import { InMemoryCompanyStore } from '../infrastructure/in-memory/in-memory-company';

const NOW = new Date('2026-11-15T03:00:00.000Z');
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [ADMIN, PAM, LEAVING, HR] = [1, 2, 3, 4].map(id) as [string, string, string, string];
const WS = id(50);

const member = (
  over: Partial<CompanyMemberSnapshot> & { userId: string },
): CompanyMemberSnapshot => ({
  role: 'EMPLOYEE',
  grants: [],
  startDate: '2026-01-05',
  offboardLastDay: null,
  offboardAccessUntil: null,
  offboardScheduledById: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const view: AdminWorkspaceView = {
  id: WS,
  name: 'Acme',
  deletedAt: null,
  archivedAt: null,
  orphan: false,
  members: [{ userId: PAM, fullName: 'Pam', role: 'OWNER' }],
};

let store: InMemoryCompanyStore;
let calls: string[];
let audit: { action: string; targetUserId?: string | null; refId?: string | null }[];
let cases: AdminWorkspacesUseCases;

beforeEach(() => {
  store = new InMemoryCompanyStore();
  store.upsertMember(member({ userId: ADMIN, role: 'ADMIN', startDate: null }));
  store.upsertMember(member({ userId: PAM }));
  store.upsertMember(member({ userId: HR, grants: ['HR_MANAGE'] }));
  store.upsertMember(
    member({ userId: LEAVING, offboardLastDay: '2026-11-20', offboardScheduledById: HR }),
  );
  calls = [];
  audit = [];
  const port: IAdminWorkspaces = {
    list: () =>
      Promise.resolve([
        { ...view, orphan: true, members: [{ userId: PAM, fullName: 'Pam', role: 'PM' }] },
      ]),
    assignOwner: (q) => {
      calls.push(`assign:${q.userId}`);
      return Promise.resolve(view);
    },
    archive: () => {
      calls.push('archive');
      return Promise.resolve({ ...view, members: [], archivedAt: NOW });
    },
  };
  cases = new AdminWorkspacesUseCases({
    access: new CompanyAccess({ members: store, clock: new FakeClock(NOW) }),
    members: store,
    workspaces: () => port,
    audit: {
      record: (e) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    uow: new FakeUnitOfWork(store),
  });
});

describe('AdminWorkspacesUseCases', () => {
  it('list: thành viên chỉ hiện khi mồ côi; owners lấy từ role OWNER', async () => {
    expect(await cases.list()).toEqual([
      expect.objectContaining({
        orphan: true,
        owners: [],
        memberCount: 1,
        members: [{ userId: PAM, fullName: 'Pam' }],
      }),
    ]);
  });

  it('giao OWNER: khóa admins TRƯỚC, audit WORKSPACE_OWNER_ASSIGNED; members [] khi hết mồ côi', async () => {
    const dto = await cases.assignOwner({ actorId: ADMIN, workspaceId: WS, userId: PAM });
    expect(store.locks).toEqual(['taskflow:company:admins']);
    expect(calls).toEqual([`assign:${PAM}`]);
    expect(dto).toMatchObject({ owners: [{ id: PAM, fullName: 'Pam' }], members: [] });
    expect(audit).toEqual([
      expect.objectContaining({ action: 'WORKSPACE_OWNER_ASSIGNED', targetUserId: PAM, refId: WS }),
    ]);
  });

  it('người được giao đang có lịch nghỉ / không thuộc công ty ⇒ 422 NOT_WORKSPACE_MEMBER, không gọi workspace', async () => {
    for (const userId of [LEAVING, id(99)]) {
      await expect(
        cases.assignOwner({ actorId: ADMIN, workspaceId: WS, userId }),
      ).rejects.toMatchObject({
        statusCode: 422,
        details: { rule: 'NOT_WORKSPACE_MEMBER' },
      });
    }
    expect(calls).toEqual([]);
  });

  it('HR (không company:admin) ⇒ 403 cho giao OWNER và lưu trữ; Admin lưu trữ ⇒ audit WORKSPACE_ARCHIVED', async () => {
    await expect(
      cases.assignOwner({ actorId: HR, workspaceId: WS, userId: PAM }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(cases.archive({ actorId: HR, workspaceId: WS })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(calls).toEqual([]);
    const dto = await cases.archive({ actorId: ADMIN, workspaceId: WS });
    expect(dto.archivedAt).toBe(NOW.toISOString());
    expect(audit.map((a) => [a.action, a.refId])).toEqual([['WORKSPACE_ARCHIVED', WS]]);
  });
});
