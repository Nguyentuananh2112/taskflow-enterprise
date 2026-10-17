// T-061a: GET / PUT /admin/access — đổi role ADMIN↔EMPLOYEE + grants (company-level ADR-133/134/136, CO-08/09).
import { AccessDto } from '@taskflow/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeClock, FakeUnitOfWork, SequentialIdGenerator } from '../../../../test/support';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import { InMemoryCompanyStore } from '../infrastructure/in-memory/in-memory-company';
import { CompanyAccess } from '../application/company-access';
import {
  AdminAccessUseCases,
  type SetAccessInput,
} from '../application/use-cases/admin-access.use-cases';

// 15/11/2026 10:00 giờ VN (thứ Hai).
const NOW = new Date('2026-11-15T03:00:00.000Z');
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [OLIVIA, ADA, HANA, MIA] = [1, 2, 3, 4].map(id) as [string, string, string, string];
const NAMES: Record<string, string> = {
  [OLIVIA]: 'Olivia',
  [ADA]: 'Ada',
  [HANA]: 'Hana',
  [MIA]: 'Mia',
};

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

let store: InMemoryCompanyStore;
let uow: FakeUnitOfWork;
let cases: AdminAccessUseCases;
let audit: {
  action: string;
  actorId: string | null;
  targetUserId?: string | null;
  before?: unknown;
  after?: unknown;
}[];
let revoked: [string, string][];
let cleanups: { userId: string; lastDay: string; actorId: string }[];
let notified: { userId: string; actorId: string }[];
let pushed: { userId: string; role: string; grants: readonly string[] }[];

type Deps = ConstructorParameters<typeof AdminAccessUseCases>[0];

/** Dựng use case với fake ghi lại mọi tác dụng phụ; `over` thay từng phụ thuộc. */
function build(over: Partial<Deps> = {}): AdminAccessUseCases {
  const clock = new FakeClock(NOW);
  const deps: Deps = {
    access: new CompanyAccess({ members: store, clock }),
    members: store,
    accounts: {
      profiles: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((u) => [
              u,
              {
                fullName: NAMES[u]!,
                email: `${NAMES[u]!.toLowerCase()}@example.com`,
                hasPassword: u !== ADA,
                deleted: false,
              },
            ]),
          ),
        ),
      revokeSessions: (userId, reason) => {
        revoked.push([userId, reason]);
        return Promise.resolve();
      },
    },
    audit: {
      record: (e) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    offboardLeave: {
      offboardCleanup: (q) => {
        cleanups.push(q);
        return Promise.resolve({ cancelled: 0, revoked: 0 });
      },
    },
    events: {
      accessChanged: (q) => {
        notified.push(q);
        return Promise.resolve();
      },
      pushAccessChanged: (q) => {
        pushed.push(q);
        return Promise.resolve();
      },
    },
    uow,
    ids: new SequentialIdGenerator(),
    clock,
    timeZone: () => Promise.resolve('Asia/Ho_Chi_Minh'),
  };
  return new AdminAccessUseCases({ ...deps, ...over });
}

beforeEach(() => {
  store = new InMemoryCompanyStore();
  uow = new FakeUnitOfWork(store);
  audit = [];
  revoked = [];
  cleanups = [];
  notified = [];
  pushed = [];
  store.upsertMember(member({ userId: OLIVIA, role: 'ADMIN', startDate: null }));
  store.upsertMember(member({ userId: ADA, role: 'ADMIN', startDate: null }));
  store.upsertMember(member({ userId: HANA, grants: ['HR_MANAGE'] }));
  store.upsertMember(member({ userId: MIA, startDate: '2026-11-15' }));
  cases = build();
});

const set = (over: Partial<SetAccessInput> & { userId: string }) =>
  cases.set({ actorId: OLIVIA, role: 'EMPLOYEE', grants: [], expectedVersion: 1, ...over });

describe('AdminAccessUseCases.list', () => {
  it('mọi người thuộc công ty, sắp theo tên, có email + trạng thái (chờ kích hoạt), khớp contract', async () => {
    const rows = await cases.list();
    expect(rows.map((r) => [r.fullName, r.role, r.status])).toEqual([
      ['Ada', 'ADMIN', 'PENDING_ACTIVATION'],
      ['Hana', 'EMPLOYEE', 'ACTIVE'],
      ['Mia', 'EMPLOYEE', 'ACTIVE'],
      ['Olivia', 'ADMIN', 'ACTIVE'],
    ]);
    expect(rows.every((r) => AccessDto.safeParse(r).success)).toBe(true);
  });
});

describe('AdminAccessUseCases.set — grants', () => {
  it('cấp PAYROLL_MANAGE cho Hana ⇒ version + 1, audit GRANT_SET, thông báo + realtime SAU commit, KHÔNG thu hồi phiên', async () => {
    const dto = await set({ userId: HANA, grants: ['HR_MANAGE', 'PAYROLL_MANAGE'] });
    expect(dto).toMatchObject({
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      version: 2,
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'GRANT_SET',
        actorId: OLIVIA,
        targetUserId: HANA,
        before: { grants: ['HR_MANAGE'] },
        after: { grants: ['HR_MANAGE', 'PAYROLL_MANAGE'] },
      }),
    ]);
    expect(notified).toEqual([{ userId: HANA, actorId: OLIVIA }]);
    expect(pushed).toEqual([
      expect.objectContaining({
        userId: HANA,
        role: 'EMPLOYEE',
        grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
      }),
    ]);
    expect(revoked).toEqual([]);
  });

  it('không đổi gì ⇒ không audit / thông báo / tăng version', async () => {
    const dto = await set({ userId: HANA, grants: ['HR_MANAGE'] });
    expect(dto.version).toBe(1);
    expect([audit, notified, pushed]).toEqual([[], [], []]);
  });

  it('Admin + grants ⇒ 422 GRANT_NOT_ALLOWED; lệch version ⇒ 409; người không thuộc công ty ⇒ 404 user', async () => {
    await expect(set({ userId: ADA, role: 'ADMIN', grants: ['HR_MANAGE'] })).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'GRANT_NOT_ALLOWED' },
    });
    await expect(set({ userId: HANA, grants: [], expectedVersion: 7 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_CONFLICT',
    });
    await expect(set({ userId: id(99) })).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'user' },
    });
  });

  it('luật self tuyệt đối: Admin tự đổi mình ⇒ 403; nhân viên có HR_MANAGE gọi ⇒ 403 (cần company:grant)', async () => {
    await expect(set({ userId: OLIVIA, role: 'EMPLOYEE' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(set({ actorId: HANA, userId: MIA, grants: ['HR_MANAGE'] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await store.find(MIA))!.grants).toEqual([]);
  });
});

describe('AdminAccessUseCases.set — role', () => {
  it('CO-08 nâng EMPLOYEE→ADMIN: khóa admins → leave/punch TRƯỚC; nhiệm kỳ ROLE_CHANGED tới hôm nay; dọn đơn; bỏ grants; thu hồi phiên', async () => {
    const dto = await set({ userId: HANA, role: 'ADMIN' });
    expect(dto).toMatchObject({ role: 'ADMIN', grants: [], version: 2 });
    expect(store.locks).toEqual([
      'taskflow:company:admins',
      `taskflow:leave:${HANA}`,
      `taskflow:attendance:punch:${HANA}`,
    ]);
    expect(store.departures()).toEqual([
      expect.objectContaining({
        userId: HANA,
        role: 'EMPLOYEE',
        firstDay: '2026-01-05',
        lastDay: '2026-11-15',
        reason: 'ROLE_CHANGED',
      }),
    ]);
    expect(cleanups).toEqual([{ userId: HANA, lastDay: '2026-11-15', actorId: OLIVIA }]);
    expect((await store.find(HANA))!.startDate).toBeNull();
    expect(revoked).toEqual([[HANA, 'LOGOUT_ALL']]);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'COMPANY_ROLE_SET',
        before: { role: 'EMPLOYEE', grants: ['HR_MANAGE'] },
        after: { role: 'ADMIN', grants: [] },
      }),
    ]);
    expect(
      await store.tenuresOf({ userIds: [HANA], from: '2026-11-15', to: '2026-11-16' }),
    ).toEqual([{ userId: HANA, from: '2026-01-05', until: '2026-11-15' }]);
  });

  it('nâng người vào làm HÔM NAY ⇒ nhiệm kỳ một ngày (first = last = hôm nay)', async () => {
    await set({ userId: MIA, role: 'ADMIN' });
    expect(store.departures()[0]).toMatchObject({ firstDay: '2026-11-15', lastDay: '2026-11-15' });
  });

  it('CO-09 hạ ADMIN→EMPLOYEE: nhiệm kỳ mới từ NGÀY MAI, grants mới, thu hồi phiên; hôm nay không thuộc nhiệm kỳ', async () => {
    const dto = await set({ userId: ADA, role: 'EMPLOYEE', grants: ['PAYROLL_MANAGE'] });
    expect(dto).toMatchObject({ role: 'EMPLOYEE', grants: ['PAYROLL_MANAGE'], version: 2 });
    expect((await store.find(ADA))!.startDate).toBe('2026-11-16');
    expect(store.locks).toEqual(['taskflow:company:admins']); // hạ: không cần khóa leave/punch
    expect(revoked).toEqual([[ADA, 'LOGOUT_ALL']]);
    expect(await store.tenuresOf({ userIds: [ADA], from: '2026-11-15', to: '2026-11-15' })).toEqual(
      [],
    );
  });

  it('guard Admin cuối (phòng thủ — qua route luôn còn ≥ 2 Admin vì người gọi là Admin khác): chỉ còn 1 Admin ⇒ 409 last_admin, không đổi gì', async () => {
    store.removeMember(OLIVIA);
    const guarded = build({
      access: {
        authorizeWrite: () => Promise.resolve({ userId: OLIVIA, role: 'ADMIN', grants: [] }),
      },
    });
    await expect(
      guarded.set({
        actorId: OLIVIA,
        userId: ADA,
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409, details: { reason: 'last_admin' } });
    expect((await store.find(ADA))!.role).toBe('ADMIN');
    expect(revoked).toEqual([]);
  });

  it('rollback khi bước sau lỗi (thu hồi phiên ⇒ 503): không departure, role giữ nguyên, không realtime', async () => {
    revoked = [];
    const failing = build({
      accounts: {
        profiles: () => Promise.resolve(new Map()),
        revokeSessions: () => Promise.reject(new Error('valkey down')),
      },
    });
    await expect(
      failing.set({ actorId: OLIVIA, userId: HANA, role: 'ADMIN', grants: [], expectedVersion: 1 }),
    ).rejects.toThrow('valkey down');
    expect(store.departures()).toEqual([]);
    expect((await store.find(HANA))!.role).toBe('EMPLOYEE');
    expect(pushed).toEqual([]);
  });
});
