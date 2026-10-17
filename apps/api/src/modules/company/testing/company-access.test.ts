// T-061: chốt quyền cấp công ty + nhiệm kỳ theo ngày (ADR-133/135/136). Bản Prisma chạy lại qua runner LSP
// (test/integration/lsp/company.company-access.lsp.int.ts) khi có lượt integration.
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeClock } from '../../../../test/support';
import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import { InMemoryCompanyStore } from '../infrastructure/in-memory/in-memory-company';
import { CompanyAccess } from '../application/company-access';

const NOW = new Date('2026-11-20T03:00:00.000Z');
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [ADMIN, HR, MIA, MAX, GONE] = [1, 2, 3, 4, 5].map(id) as [
  string,
  string,
  string,
  string,
  string,
];

let store: InMemoryCompanyStore;
let clock: FakeClock;
let access: CompanyAccess;

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

beforeEach(() => {
  store = new InMemoryCompanyStore();
  clock = new FakeClock(NOW);
  access = new CompanyAccess({ members: store, clock });
  store.upsertMember(member({ userId: ADMIN, role: 'ADMIN', startDate: null }));
  store.upsertMember(member({ userId: HR, grants: ['HR_MANAGE'] }));
  store.upsertMember(member({ userId: MIA }));
  store.upsertMember(
    member({
      userId: MAX,
      offboardLastDay: '2026-11-19',
      offboardAccessUntil: new Date('2026-11-19T23:00:00.000Z'), // đã qua lúc NOW
      offboardScheduledById: HR,
    }),
  );
  store.addDeparture({
    id: id(90),
    userId: GONE,
    role: 'EMPLOYEE',
    firstDay: '2025-03-01',
    lastDay: '2026-06-30',
    leftAt: new Date('2026-06-30T23:00:00.000Z'),
    reason: 'OFFBOARDED',
  });
});

const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

describe('authorizeWrite', () => {
  it('Admin và HR (grant) ⇒ OK, trả actor đọc lại; Admin có company:grant, HR thì không', async () => {
    await expect(access.authorizeWrite({ actorId: ADMIN })).resolves.toMatchObject({
      role: 'ADMIN',
    });
    await expect(access.authorizeWrite({ actorId: HR, targetUserId: MIA })).resolves.toEqual({
      userId: HR,
      role: 'EMPLOYEE',
      grants: ['HR_MANAGE'],
    });
    await expect(
      access.authorizeWrite({ actorId: ADMIN, permission: 'company:grant' }),
    ).resolves.toBeDefined();
    const err = await caught(access.authorizeWrite({ actorId: HR, permission: 'company:grant' }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('nhân viên thường ⇒ 403 hr:manage; tự xử lý dữ liệu của mình ⇒ 403 (luật self tuyệt đối)', async () => {
    const plain = await caught(access.authorizeWrite({ actorId: MIA }));
    expect((plain as ForbiddenError).details).toEqual({ required: 'hr:manage' });
    expect(await caught(access.authorizeWrite({ actorId: HR, targetUserId: HR }))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('không thuộc công ty / quá access_until ⇒ 401 SESSION_REVOKED (kể cả từng có grant)', async () => {
    expect(await caught(access.authorizeWrite({ actorId: GONE }))).toBeInstanceOf(
      SessionRevokedError,
    );
    store.upsertMember(
      member({
        userId: MAX,
        grants: ['HR_MANAGE'],
        offboardLastDay: '2026-11-19',
        offboardAccessUntil: NOW,
        offboardScheduledById: ADMIN,
      }),
    );
    expect(await caught(access.authorizeWrite({ actorId: MAX }))).toBeInstanceOf(
      SessionRevokedError,
    );
  });

  it('thu grant ⇒ lệnh kế tiếp 403 ngay (đọc lại sau khóa, không tin quyền trong token)', async () => {
    store.upsertMember(member({ userId: HR, grants: [] }));
    expect(await caught(access.authorizeWrite({ actorId: HR }))).toBeInstanceOf(ForbiddenError);
  });
});

describe('isEmployee / assertActiveEmployee', () => {
  it('isEmployee: EMPLOYEE (kể cả đang có lịch nghỉ) ⇒ true; Admin / người đã nghỉ ⇒ false', async () => {
    expect(await Promise.all([MIA, MAX, ADMIN, GONE].map((u) => access.isEmployee(u)))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('assertActiveEmployee: đang làm ⇒ OK; Admin / quá access_until / đã nghỉ ⇒ 401', async () => {
    await expect(access.assertActiveEmployee(MIA)).resolves.toBeUndefined();
    for (const u of [ADMIN, MAX, GONE]) {
      expect(await caught(access.assertActiveEmployee(u)), u).toBeInstanceOf(SessionRevokedError);
    }
    clock.set('2026-11-19T22:59:59.999Z'); // 1 ms trước mốc ⇒ Max còn quyền
    await expect(access.assertActiveEmployee(MAX)).resolves.toBeUndefined();
  });
});

describe('tenuresOf (theo ngày, bao gồm hai đầu)', () => {
  it('nhiệm kỳ hiện tại + đã đóng; Admin không có; sắp theo user rồi from', async () => {
    const all = await store.tenuresOf({ from: '2026-01-01', to: '2026-12-31' });
    expect(all.map((t) => t.userId)).toEqual([HR, MIA, MAX, GONE].sort());
    expect(all.find((t) => t.userId === GONE)).toEqual({
      userId: GONE,
      from: '2025-03-01',
      until: '2026-06-30',
    });
  });

  it('biên: until = from vẫn giao; from = to + 1 không giao; userIds [] ⇒ []', async () => {
    expect(
      await store.tenuresOf({ userIds: [GONE], from: '2026-06-30', to: '2026-07-31' }),
    ).toHaveLength(1);
    expect(
      await store.tenuresOf({ userIds: [GONE], from: '2026-07-01', to: '2026-07-31' }),
    ).toEqual([]);
    expect(await store.tenuresOf({ userIds: [MIA], from: '2025-12-01', to: '2026-01-04' })).toEqual(
      [],
    );
    expect(await store.tenuresOf({ userIds: [], from: '2026-01-01', to: '2026-12-31' })).toEqual(
      [],
    );
  });
});
