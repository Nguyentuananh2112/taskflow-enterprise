// Tầng I cho phía đọc leave trên Postgres: keyset (createdAt, id) giảm dần, lọc tenant/status/user, listApproved theo
// khoảng ngày, số dư không tạo dòng, reason '' ⇄ null, danh bạ nhân viên (tên, id) không gồm VIEWER.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { LeaveRequestRecord } from '../../../src/modules/leave/application/ports/leave.ports';
import { PrismaLeaveEmployeeDirectory } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave-employee-directory';
import { PrismaLeaveReadModel } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave-read-model';
import { PrismaLeaveRepository } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import {
  disconnectTestPrisma,
  RecordingUnitOfWork,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const W1 = '00000000-0000-7000-8000-00000000a001';
const W2 = '00000000-0000-7000-8000-00000000a002';
const MIA = '00000000-0000-7000-8000-00000000b001';
const HANA = '00000000-0000-7000-8000-00000000b002';
const VIC = '00000000-0000-7000-8000-00000000b003';
const ANNA = '00000000-0000-7000-8000-00000000b004';
const AT = new Date('2026-11-17T03:00:00.000Z');
const at = (min: number) => new Date(AT.getTime() + min * 60_000);
const id = (n: number) => `00000000-0000-7000-8000-0000000c${n.toString().padStart(4, '0')}`;

const record = (over: Partial<LeaveRequestRecord> & { id: string }): LeaveRequestRecord => ({
  workspaceId: W1,
  userId: MIA,
  type: 'ANNUAL',
  startDate: '2026-11-23',
  endDate: '2026-11-23',
  dayPart: 'FULL',
  reason: 'về quê',
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  version: 1,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

function setup() {
  const uow = new RecordingUnitOfWork();
  return {
    uow,
    repo: new PrismaLeaveRepository(() => uow.db()),
    read: new PrismaLeaveReadModel(() => uow.db()),
    directory: new PrismaLeaveEmployeeDirectory(() => uow.db()),
  };
}

beforeEach(async () => {
  await resetDatabase();
  const prisma = testPrisma();
  const users: readonly (readonly [string, string])[] = [
    [MIA, 'Mia'],
    [HANA, 'Hana'],
    [VIC, 'Vic'],
    [ANNA, 'Mia'], // trùng tên với MIA ⇒ keyset phải phân định bằng id
  ];
  for (const [uid, name] of users) {
    await prisma.user.create({
      data: { id: uid, email: `${uid.slice(-4)}@example.test`, fullName: name, passwordHash: 'x' },
    });
  }
  for (const ws of [W1, W2]) {
    await prisma.workspace.create({
      data: { id: ws, name: `W ${ws.slice(-4)}`, slug: `ws-${ws.slice(-12)}` },
    });
  }
  const members: readonly (readonly [string, string, 'OWNER' | 'MEMBER' | 'VIEWER'])[] = [
    [W1, HANA, 'OWNER'],
    [W1, MIA, 'MEMBER'],
    [W1, ANNA, 'MEMBER'],
    [W1, VIC, 'VIEWER'],
    [W2, MIA, 'OWNER'],
  ];
  for (const [workspaceId, userId, role] of members) {
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
  }
});
afterAll(disconnectTestPrisma);

describe('PrismaLeaveReadModel', () => {
  it('listRequests: mới nhất trước, trùng createdAt phân định bằng id, sau `after`; lọc user/status; tenant', async () => {
    const { uow, repo, read } = setup();
    await uow.run(async () => {
      await repo.add(record({ id: id(1), createdAt: at(1) }));
      await repo.add(record({ id: id(2), createdAt: at(2), status: 'REJECTED' }));
      await repo.add(record({ id: id(3), createdAt: at(2), userId: HANA }));
      await repo.add(record({ id: id(4), createdAt: at(3), workspaceId: W2 }));
    });
    const all = await read.listRequests(W1, {}, null, 10);
    expect(all.map((r) => r.id)).toEqual([id(3), id(2), id(1)]);
    const next = await read.listRequests(W1, {}, { createdAt: at(2).toISOString(), id: id(3) }, 10);
    expect(next.map((r) => r.id)).toEqual([id(2), id(1)]);
    expect((await read.listRequests(W1, { userId: MIA }, null, 10)).map((r) => r.id)).toEqual([
      id(2),
      id(1),
    ]);
    expect(
      (await read.listRequests(W1, { status: 'REJECTED' }, null, 10)).map((r) => r.id),
    ).toEqual([id(2)]);
    expect(await read.listRequests(W1, {}, null, 1)).toHaveLength(1);
  });

  it('listApproved: chỉ APPROVED giao [from, to], lọc userIds, tenant', async () => {
    const { uow, repo, read } = setup();
    await uow.run(async () => {
      await repo.add(
        record({ id: id(1), status: 'APPROVED', startDate: '2026-11-14', endDate: '2026-11-16' }),
      );
      await repo.add(
        record({
          id: id(2),
          status: 'APPROVED',
          userId: HANA,
          startDate: '2026-12-01',
          endDate: '2026-12-01',
        }),
      );
      await repo.add(record({ id: id(3), startDate: '2026-11-18', endDate: '2026-11-18' }));
      await repo.add(record({ id: id(4), status: 'APPROVED', workspaceId: W2 }));
    });
    const q = { workspaceId: W1, from: '2026-11-15', to: '2026-11-30' };
    expect((await read.listApproved(q)).map((r) => r.id)).toEqual([id(1)]);
    expect(await read.listApproved({ ...q, userIds: [HANA] })).toEqual([]);
    expect((await read.listApproved({ ...q, to: '2026-12-31' })).map((r) => r.id)).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('findBalance / findBalances không tạo dòng; listHoldingFor nhiều người trong năm', async () => {
    const { uow, repo, read } = setup();
    expect(await read.findBalance(W1, MIA, 2026)).toBeNull();
    expect(await testPrisma().leaveBalance.count()).toBe(0);
    await uow.run(() => repo.setBalanceAdjustment(W1, MIA, 2026, -3));
    expect(await read.findBalance(W1, MIA, 2026)).toEqual({ entitled: 24, adjustment: -3 });
    const many = await read.findBalances(W1, [MIA, HANA], 2026);
    expect([...many.keys()]).toEqual([MIA]);
    await uow.run(async () => {
      await repo.add(record({ id: id(1) }));
      await repo.add(record({ id: id(2), userId: HANA, status: 'APPROVED' }));
      await repo.add(record({ id: id(3), userId: HANA, status: 'CANCELLED' }));
      await repo.add(record({ id: id(4), startDate: '2027-01-04', endDate: '2027-01-04' }));
    });
    expect((await read.listHoldingFor(W1, [MIA, HANA], 2026)).map((r) => r.id).sort()).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('reason tùy chọn: null lưu NULL (migration 4); chuỗi rỗng / chỉ khoảng trắng ⇒ CHECK DB từ chối', async () => {
    const { uow, repo, read } = setup();
    await uow.run(() => repo.add(record({ id: id(1), reason: null })));
    expect((await testPrisma().leaveRequest.findFirstOrThrow()).reason).toBeNull();
    expect((await read.listRequests(W1, {}, null, 1))[0]?.reason).toBeNull();
    await expect(repo.find(W1, id(1))).resolves.toMatchObject({ reason: null });
    for (const [n, blank] of [
      [2, ''],
      [3, '   '],
    ] as const) {
      await expect(uow.run(() => repo.add(record({ id: id(n), reason: blank })))).rejects.toThrow();
    }
  });
});

describe('PrismaLeaveReadModel.leaveSummaries (reader cho notifications — T-040b)', () => {
  it('một truy vấn theo cặp (ws, id); ws khác không khớp; không có reason', async () => {
    const { uow, repo, read } = setup();
    await uow.run(async () => {
      await repo.add(record({ id: id(1), reason: 'sốt cao' }));
      await repo.add(record({ id: id(2), workspaceId: W2 }));
    });
    const map = await read.leaveSummaries([
      { workspaceId: W1, refId: id(1) },
      { workspaceId: W1, refId: id(2) },
    ]);
    expect([...map.entries()]).toEqual([
      [id(1), { type: 'ANNUAL', startDate: '2026-11-23', endDate: '2026-11-23' }],
    ]);
    expect(await read.leaveSummaries([])).toEqual(new Map());
  });
});

describe('PrismaLeaveEmployeeDirectory', () => {
  it('nhân viên hiện tại (không VIEWER), sắp (tên, id), keyset qua tên trùng; ws khác tách biệt', async () => {
    const { directory } = setup();
    const all = await directory.listEmployees(W1, null, 10);
    expect(all).toEqual([
      { id: HANA, fullName: 'Hana' },
      { id: MIA, fullName: 'Mia' },
      { id: ANNA, fullName: 'Mia' },
    ]);
    expect(await directory.listEmployees(W1, { fullName: 'Mia', id: MIA }, 10)).toEqual([
      { id: ANNA, fullName: 'Mia' },
    ]);
    expect(await directory.listEmployees(W2, null, 10)).toEqual([{ id: MIA, fullName: 'Mia' }]);
  });
});
