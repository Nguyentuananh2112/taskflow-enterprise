// T-057 tầng I/C (hr-extended ADR-131, migration 9; test-spec-hr-extended LP / CC-HR-24): CHECK của migration 9,
// PrismaLeavePolicyStore (version, tạo trùng), setCarried ifNull / overwrite, khóa `taskflow:leave-policy` EXCLUSIVE
// chặn SHARED (2 kết nối thật), chạy lại LP-12 / LP-09 trên Postgres (LSP), CC-HR-24 chụp carried song song = 1 giá trị.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { LEGAL_LEAVE_POLICY } from '../../../src/modules/leave/domain/leave-policy';
import { PrismaLeavePolicyStore } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave-policy.store';
import { PrismaLeaveRepository } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import { createLeaveHarness, U } from '../../../src/modules/leave/testing/leave-harness';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';
import { prismaLeaveBackend } from './prisma-leave-backend';

const REPEAT = Number(process.env.LEAVE_CC_REPEAT ?? '20');
const at = new Date('2026-11-17T03:00:00Z');

beforeEach(async () => {
  await resetDatabase();
});
afterAll(disconnectTestPrisma);

async function seedUser(id: string) {
  await testPrisma().user.createMany({
    data: [
      { id, email: `${id.slice(-12)}@example.test`, fullName: id.slice(-4), passwordHash: 'x' },
    ],
    skipDuplicates: true,
  });
}

describe('migration 9 — CHECK', () => {
  it('leave_policies: dưới luật / ngoài khoảng / không bội 0,5 ⇒ CHECK; leave_balances: carried / entitled âm hoặc 0,25 ⇒ CHECK', async () => {
    await seedUser(U.Hana);
    const row = (over: Record<string, unknown>) =>
      testPrisma().leavePolicy.create({ data: { year: 2026, updatedById: U.Hana, ...over } });
    for (const [over, chk] of [
      [{ annualDays: 11.5 }, 'leave_policies_annual_chk'],
      [{ annualDays: 12.3 }, 'leave_policies_annual_chk'],
      [{ seniorityStepYears: 6 }, 'leave_policies_step_chk'],
      [{ seniorityBonusDays: 0.5 }, 'leave_policies_bonus_chk'],
      [{ carryOverMaxDays: 30.5 }, 'leave_policies_carry_max_chk'],
      [{ carryOverExpiryMonth: 13 }, 'leave_policies_expiry_month_chk'],
      [{ year: 1999 }, 'leave_policies_year_chk'],
    ] as const) {
      await expect(row(over), chk).rejects.toThrow(new RegExp(chk));
    }
    await expect(row({})).resolves.toMatchObject({ year: 2026 });
    await seedUser(U.Mia);
    for (const [col, chk] of [
      ['carriedOverDays', 'leave_balances_carried_chk'],
      ['entitledDays', 'leave_balances_entitled_chk'],
    ] as const) {
      for (const bad of [-0.5, 0.25]) {
        await expect(
          testPrisma().leaveBalance.create({ data: { userId: U.Mia, year: 2026, [col]: bad } }),
          `${col}=${String(bad)}`,
        ).rejects.toThrow(new RegExp(chk));
      }
    }
    // Dòng tạo lười: entitled / carried NULL (= theo chính sách / chưa chụp).
    await expect(
      testPrisma().leaveBalance.create({ data: { userId: U.Mia, year: 2026 } }),
    ).resolves.toMatchObject({ entitledDays: null, carriedOverDays: null });
  });
});

describe('PrismaLeavePolicyStore + setCarried', () => {
  it('put: version 0 tạo ⇒ 1; tạo lần 2 ⇒ null; version khớp ⇒ +1; lệch ⇒ null; list sắp theo năm', async () => {
    await seedUser(U.Hana);
    const uow = new RecordingUnitOfWork();
    const store = new PrismaLeavePolicyStore(() => uow.db());
    const put = (year: number, expectedVersion: number, annual = 26) =>
      uow.run(() =>
        store.put({
          year,
          policy: { ...LEGAL_LEAVE_POLICY, annual },
          expectedVersion,
          updatedById: U.Hana,
          at,
        }),
      );
    expect(await put(2026, 0)).toMatchObject({ year: 2026, version: 1, policy: { annual: 26 } });
    expect(await put(2026, 0)).toBeNull();
    expect(await put(2026, 1, 28)).toMatchObject({ version: 2, policy: { annual: 28 } });
    expect(await put(2026, 1)).toBeNull();
    await put(2025, 0);
    expect((await uow.run(() => store.list())).map((r) => r.year)).toEqual([2025, 2026]);
  });

  it('setCarried: ifNull chỉ ghi khi NULL (idempotent); overwrite ghi đè; tạo dòng nếu chưa có', async () => {
    await seedUser(U.Mia);
    const uow = new RecordingUnitOfWork();
    const repo = new PrismaLeaveRepository(() => uow.db());
    await uow.run(() => repo.setCarried(U.Mia, 2026, 6, 'ifNull'));
    await uow.run(() => repo.setCarried(U.Mia, 2026, 9, 'ifNull'));
    expect(await uow.run(() => repo.getOrCreateBalance(U.Mia, 2026))).toMatchObject({ carried: 6 });
    await uow.run(() => repo.setCarried(U.Mia, 2026, 2, 'overwrite'));
    expect(await uow.run(() => repo.getOrCreateBalance(U.Mia, 2026))).toEqual({
      entitled: null,
      adjustment: 0,
      carried: 2,
    });
  });

  it('khóa: EXCLUSIVE đang giữ ⇒ SHARED ở kết nối khác CHỜ tới khi commit (bậc 1 ADR-136)', async () => {
    const a = new RecordingUnitOfWork();
    const b = new RecordingUnitOfWork();
    const storeA = new PrismaLeavePolicyStore(() => a.db());
    const storeB = new PrismaLeavePolicyStore(() => b.db());
    const order: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const holding = a.run(async () => {
      await storeA.lock('exclusive');
      order.push('A:exclusive');
      await hold;
      order.push('A:commit');
    });
    await new Promise((r) => setTimeout(r, 200));
    const waiting = b.run(async () => {
      await storeB.lock('shared');
      order.push('B:shared');
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(order).toEqual(['A:exclusive']); // B vẫn chờ
    release();
    await Promise.all([holding, waiting]);
    expect(order).toEqual(['A:exclusive', 'A:commit', 'B:shared']);
  });
});

describe('LSP trên Postgres: LP-12 / LP-09 (cùng kịch bản với test đơn vị)', () => {
  const carryPolicy = async (h: Awaited<ReturnType<typeof createLeaveHarness>>) => {
    await h.uow.run(() =>
      h.policies.put({
        year: 2025,
        policy: {
          ...LEGAL_LEAVE_POLICY,
          carryOverEnabled: true,
          carryOverMax: 10,
          carryOverExpiryMonth: 12,
        },
        expectedVersion: 0,
        updatedById: U.Hana,
        at,
      }),
    );
    await h.seed({
      id: '00000000-0000-7000-8000-0000000e0009',
      status: 'APPROVED',
      startDate: '2025-03-03',
      endDate: '2025-03-04',
    });
  };

  it('LP-12: GET không tạo dòng; ghi đầu tiên chụp đúng số tạm tính; LP-09: PATCH 2025 ⇒ tính lại', async () => {
    const h = await createLeaveHarness(prismaLeaveBackend());
    await carryPolicy(h);
    await expect(h.queries.myBalance(h.as(U.Mia), 2026)).resolves.toMatchObject({
      carriedOverDays: 5,
      carriedFinal: false,
    });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toBeNull();
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: 0 });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 10 });
    await h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2025, adjustment: -16 });
    expect(await h.readModel.findBalance(U.Mia, 2026)).toMatchObject({ carried: 4 });
  });
});

describe('CC-HR-24: nhiều lệnh ghi đầu năm song song (submit ‖ PATCH ‖ job) ⇒ carried một giá trị', () => {
  it(`×${String(REPEAT)}`, async () => {
    for (let round = 1; round <= REPEAT; round++) {
      await resetDatabase();
      const h = await createLeaveHarness(prismaLeaveBackend());
      await h.uow.run(() =>
        h.policies.put({
          year: 2025,
          policy: {
            ...LEGAL_LEAVE_POLICY,
            carryOverEnabled: true,
            carryOverMax: 10,
            carryOverExpiryMonth: 12,
          },
          expectedVersion: 0,
          updatedById: U.Hana,
          at,
        }),
      );
      await Promise.allSettled([
        h.leave.submit(h.as(U.Mia), {
          type: 'ANNUAL',
          startDate: '2026-11-30',
          endDate: '2026-11-30',
          dayPart: 'FULL',
        }),
        h.leave.adjustBalance(h.as(U.Hana), { userId: U.Mia, year: 2026, adjustment: 0 }),
        h.uow.run(async () => {
          await h.kit.lockFor(U.Mia);
          await h.kit.snapshotCarried(U.Mia, 2026, '2026-11-17');
        }),
      ]);
      const balance = await h.readModel.findBalance(U.Mia, 2026);
      expect(balance?.carried, `vòng ${String(round)}`).toBe(10);
      expect(await testPrisma().leaveBalance.count({ where: { userId: U.Mia, year: 2026 } })).toBe(
        1,
      );
    }
  }, 300_000);
});
