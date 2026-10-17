// Tầng I (test-spec-hr §0.1) cho repo leave trên Postgres thật — phạm vi công ty (migration 5 `company_level`): khóa
// advisory theo user, ON CONFLICT số dư (PK user, year), UPDATE có điều kiện version, Decimal(4,1) ↔ nửa ngày, CHECK + FK.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { LeaveRequestRecord } from '../../../src/modules/leave/application/ports/leave.ports';
import { PrismaLeaveRepository } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import {
  disconnectTestPrisma,
  RecordingUnitOfWork,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const MIA = '00000000-0000-7000-8000-00000000b001';
const HANA = '00000000-0000-7000-8000-00000000b002';
const AT = new Date('2026-11-17T03:00:00.000Z');

function setup() {
  const uow = new RecordingUnitOfWork();
  const repo = new PrismaLeaveRepository(() => uow.db());
  return { uow, repo };
}

const record = (over: Partial<LeaveRequestRecord> & { id: string }): LeaveRequestRecord => ({
  userId: MIA,
  type: 'ANNUAL',
  startDate: '2026-11-23',
  endDate: '2026-11-24',
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
const id = (n: number) => `00000000-0000-7000-8000-0000000c${n.toString().padStart(4, '0')}`;

beforeEach(async () => {
  await resetDatabase();
  const prisma = testPrisma();
  const users: readonly (readonly [string, string])[] = [
    [MIA, 'Mia'],
    [HANA, 'Hana'],
  ];
  for (const [uid, name] of users) {
    await prisma.user.create({
      data: {
        id: uid,
        email: `${name.toLowerCase()}@example.test`,
        fullName: name,
        passwordHash: 'x',
      },
    });
  }
});
afterAll(disconnectTestPrisma);

describe('PrismaLeaveRepository — đơn nghỉ', () => {
  it('add → find giữ nguyên ngày thuần + mọi trường; id lạ ⇒ null', async () => {
    const { uow, repo } = setup();
    const r = record({ id: id(1), dayPart: 'FULL' });
    await uow.run(() => repo.add(r));
    await expect(repo.find(id(1))).resolves.toEqual(r);
    await expect(repo.find(id(99))).resolves.toBeNull();
  });

  it('listHolding: chỉ PENDING/APPROVED của đúng người, đúng năm (theo startDate), sắp theo ngày; listOpen mọi năm', async () => {
    const { uow, repo } = setup();
    await uow.run(async () => {
      await repo.add(record({ id: id(1), startDate: '2026-11-30', endDate: '2026-11-30' }));
      await repo.add(
        record({ id: id(2), status: 'APPROVED', startDate: '2026-03-02', endDate: '2026-03-02' }),
      );
      await repo.add(
        record({ id: id(3), status: 'REJECTED', startDate: '2026-04-01', endDate: '2026-04-01' }),
      );
      await repo.add(record({ id: id(4), startDate: '2027-01-04', endDate: '2027-01-04' }));
      await repo.add(record({ id: id(5), userId: HANA }));
      await repo.add(record({ id: id(7), startDate: '2026-12-31', endDate: '2026-12-31' }));
    });
    const holding = await repo.listHolding(MIA, 2026);
    expect(holding.map((r) => r.id)).toEqual([id(2), id(1), id(7)]);
    expect((await repo.listOpen(MIA)).map((r) => r.id)).toEqual([id(2), id(1), id(7), id(4)]);
  });

  it('save có điều kiện version: đúng ⇒ true + ghi; lệch ⇒ false, không ghi', async () => {
    const { uow, repo } = setup();
    const r = record({ id: id(1) });
    await uow.run(() => repo.add(r));
    const approved = {
      ...r,
      status: 'APPROVED' as const,
      decidedBy: HANA,
      decidedAt: AT,
      decisionNote: 'ok',
      version: 2,
    };
    await expect(uow.run(() => repo.save(approved, 2))).resolves.toBe(false);
    await expect(uow.run(() => repo.save(approved, 1))).resolves.toBe(true);
    await expect(repo.find(id(1))).resolves.toMatchObject({
      status: 'APPROVED',
      decidedBy: HANA,
      version: 2,
    });
  });

  it('CHECK của migration: end < start, nửa ngày nhiều ngày ⇒ DB từ chối (chốt chặn cuối nếu app quên)', async () => {
    const { uow, repo } = setup();
    await expect(
      uow.run(() =>
        repo.add(record({ id: id(1), startDate: '2026-11-24', endDate: '2026-11-23' })),
      ),
    ).rejects.toThrow();
    await expect(
      uow.run(() =>
        repo.add(
          record({ id: id(2), dayPart: 'AM', startDate: '2026-11-23', endDate: '2026-11-24' }),
        ),
      ),
    ).rejects.toThrow();
    expect(await repo.find(id(1))).toBeNull();
  });

  it('FK users Restrict: xóa user còn đơn nghỉ ⇒ DB từ chối (giữ lịch sử)', async () => {
    const { uow, repo } = setup();
    await uow.run(() => repo.add(record({ id: id(1) })));
    await expect(testPrisma().user.delete({ where: { id: MIA } })).rejects.toThrow();
  });
});

describe('PrismaLeaveRepository — số dư', () => {
  it('LB-01: getOrCreateBalance tạo lười — entitled / carried NULL (theo chính sách / chưa chụp, migration 9); gọi lại không nhân bản', async () => {
    const { uow, repo } = setup();
    await expect(uow.run(() => repo.getOrCreateBalance(MIA, 2026))).resolves.toEqual({
      entitled: null,
      adjustment: 0,
      carried: null,
    });
    await uow.run(() => repo.getOrCreateBalance(MIA, 2026));
    expect(await testPrisma().leaveBalance.count()).toBe(1);
  });

  it('LB-01 đồng thời: 2 transaction tạo lần đầu cùng lúc ⇒ 1 dòng, không lỗi trùng khóa', async () => {
    const a = setup();
    const b = setup();
    await Promise.all([
      a.uow.run(() => a.repo.getOrCreateBalance(MIA, 2026)),
      b.uow.run(() => b.repo.getOrCreateBalance(MIA, 2026)),
    ]);
    expect(await testPrisma().leaveBalance.count()).toBe(1);
  });

  it('LB-09: adjustment 10,5 ngày ⇄ 21 nửa ngày, đọc lại đúng; số âm được (Q4); version tăng', async () => {
    const { uow, repo } = setup();
    await uow.run(() => repo.setBalanceAdjustment(MIA, 2026, 21));
    await expect(uow.run(() => repo.getOrCreateBalance(MIA, 2026))).resolves.toEqual({
      entitled: null,
      adjustment: 21,
      carried: null,
    });
    await uow.run(() => repo.setBalanceAdjustment(MIA, 2026, -7));
    const row = await testPrisma().leaveBalance.findFirstOrThrow({ where: { userId: MIA } });
    expect(row.adjustmentDays.toString()).toBe('-3.5');
    expect(row.version).toBe(2);
  });

  it('CHECK năm 2000–2100', async () => {
    const { uow, repo } = setup();
    await expect(uow.run(() => repo.getOrCreateBalance(MIA, 1999))).rejects.toThrow();
  });
});

describe('PrismaLeaveRepository — khóa theo user', () => {
  it('2 transaction cùng (ws, user) xếp hàng: transaction sau chỉ qua khóa khi transaction trước commit', async () => {
    const a = setup();
    const b = setup();
    const order: string[] = [];
    let releaseA!: () => void;
    const holdA = new Promise<void>((r) => (releaseA = r));
    let aLocked!: () => void;
    const aHasLock = new Promise<void>((r) => (aLocked = r));
    const ta = a.uow.run(async () => {
      await a.repo.lockUser(MIA);
      order.push('A khóa');
      aLocked();
      await holdA;
      order.push('A commit');
    });
    await aHasLock;
    const tb = b.uow.run(async () => {
      await b.repo.lockUser(MIA);
      order.push('B khóa');
    });
    await new Promise((r) => setTimeout(r, 200)); // B phải đang chờ
    expect(order).toEqual(['A khóa']);
    releaseA();
    await Promise.all([ta, tb]);
    expect(order).toEqual(['A khóa', 'A commit', 'B khóa']);
  });

  it('khóa của user khác không chặn nhau', async () => {
    const a = setup();
    const b = setup();
    let releaseA!: () => void;
    const holdA = new Promise<void>((r) => (releaseA = r));
    let aLocked!: () => void;
    const aHasLock = new Promise<void>((r) => (aLocked = r));
    const ta = a.uow.run(async () => {
      await a.repo.lockUser(MIA);
      aLocked();
      await holdA;
    });
    await aHasLock;
    await b.uow.run(() => b.repo.lockUser(HANA)); // xong ngay dù A còn giữ khóa
    releaseA();
    await ta;
  });
});
