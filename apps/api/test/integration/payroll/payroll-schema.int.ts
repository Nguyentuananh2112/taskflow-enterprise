// T-048 tầng I (payroll.md v4 §3, test-spec-payroll): migration 7 trên Postgres thật — RD-05 phiếu đã phát hành bất
// biến kể cả SQL thẳng (trigger), RD-11 bảng lương + audit `PAYROLL_*` ngoài mọi bước retention, SEC-PAY-12
// `payroll_settings` luôn một dòng, CHECK số tiền / công / đẳng thức thực lĩnh.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RetentionJob, type RetentionPolicy } from '../../../src/composition/retention-job';
import { prismaRetentionStores } from '../../../src/composition/retention-stores';
import { FakeClock } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2036-12-01T00:00:00.000Z'); // 10 năm sau dữ liệu — mọi ngưỡng retention đều đã qua
const OLD = new Date('2026-10-05T03:00:00.000Z');
const POLICY: RetentionPolicy = {
  clientInfoDays: 395,
  leaveReasonDays: 395,
  recordsDays: 730,
  notificationsDays: 180,
  hrAuditDays: 1826,
};

let kay: string;
let mia: string;

beforeEach(async () => {
  await resetDatabase();
  const p = testPrisma();
  // resetDatabase: TRUNCATE users CASCADE kéo theo payroll_settings (FK updated_by_id) ⇒ đặt lại dòng của migration.
  await p.$executeRawUnsafe(
    `INSERT INTO payroll_settings (id, seniority_per_year, version, updated_by_id, updated_at)
     VALUES (1, 500000, 1, NULL, now()) ON CONFLICT (id) DO NOTHING`,
  );
  const user = async (name: string) =>
    (
      await p.user.create({
        data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
      })
    ).id;
  kay = await user('kay');
  mia = await user('mia');
});
afterAll(disconnectTestPrisma);

async function draftWithPayslip() {
  const p = testPrisma();
  const run = await p.payrollRun.create({
    data: {
      id: randomUUID(),
      period: '2026-09',
      standardDays: 22,
      seniorityPerYear: 500_000n,
      createdById: kay,
      createdAt: OLD,
    },
  });
  const slip = await p.payslip.create({
    data: {
      id: randomUUID(),
      runId: run.id,
      userId: mia,
      fullName: 'Mia',
      level: 'L2',
      baseSalary: 9_000_000n,
      paidHalfDays: 44,
      salaryByDays: 9_000_000n,
      incomeTotal: 9_000_000n,
      bonusTotal: 1_000_000n,
      deductionTotal: 500_000n,
      netPay: 9_500_000n,
      createdAt: OLD,
      lines: {
        create: [
          {
            id: randomUUID(),
            section: 'BONUS',
            label: 'Thưởng kênh',
            amount: 1_000_000n,
            sortOrder: 0,
          },
          { id: randomUUID(), section: 'DEDUCTION', label: 'BHXH', amount: 500_000n, sortOrder: 1 },
        ],
      },
    },
  });
  return { run, slip };
}

const publish = (runId: string) =>
  testPrisma().payrollRun.update({
    where: { id: runId },
    data: { status: 'PUBLISHED', publishedAt: OLD, publishedById: kay, companyName: 'Công ty A' },
  });

describe('RD-05 — bảng / phiếu đã phát hành bất biến (trigger)', () => {
  it('NHÁP sửa được; PUBLISHED: cột tiền, dòng, xóa phiếu, quay về DRAFT ⇒ DB từ chối', async () => {
    const p = testPrisma();
    const { run, slip } = await draftWithPayslip();
    await p.payslip.update({
      where: { id: slip.id },
      data: { bonusTotal: 1_200_000n, netPay: 9_700_000n },
    });
    await publish(run.id);

    await expect(
      p.payslip.update({ where: { id: slip.id }, data: { bonusTotal: 2n, netPay: 8_500_002n } }),
    ).rejects.toThrow(/bất biến/);
    await expect(p.payslip.update({ where: { id: slip.id }, data: { note: 'x' } })).rejects.toThrow(
      /bất biến/,
    );
    await expect(
      p.payslipLine.updateMany({ where: { payslipId: slip.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/bất biến/);
    await expect(p.payslipLine.deleteMany({ where: { payslipId: slip.id } })).rejects.toThrow(
      /bất biến/,
    );
    await expect(p.payslip.delete({ where: { id: slip.id } })).rejects.toThrow(/không xóa/);
    await expect(
      p.payrollRun.update({
        where: { id: run.id },
        data: { status: 'DRAFT', publishedAt: null, publishedById: null, companyName: null },
      }),
    ).rejects.toThrow(/bất biến/);
    await expect(
      p.payrollRun.update({ where: { id: run.id }, data: { standardDays: 21 } }),
    ).rejects.toThrow(/bất biến/);

    const after = await p.payslip.findUniqueOrThrow({ where: { id: slip.id } });
    expect(after.netPay).toBe(9_700_000n);
  });

  it('bản điều chỉnh: chỉ đặt superseded_at được; bản mới revision 2 + dòng của nó; thêm dòng vào bản cũ ⇒ lỗi', async () => {
    const p = testPrisma();
    const { run, slip } = await draftWithPayslip();
    await publish(run.id);
    await p.$transaction(async (tx) => {
      await tx.payslip.update({ where: { id: slip.id }, data: { supersededAt: NOW } });
      await tx.payslip.create({
        data: {
          id: randomUUID(),
          runId: run.id,
          userId: mia,
          revision: 2,
          revisionReason: 'Sai thưởng kênh',
          fullName: 'Mia',
          level: 'L2',
          baseSalary: 9_000_000n,
          paidHalfDays: 44,
          salaryByDays: 9_000_000n,
          incomeTotal: 9_000_000n,
          bonusTotal: 1_500_000n,
          deductionTotal: 500_000n,
          netPay: 10_000_000n,
          lines: {
            create: [
              {
                id: randomUUID(),
                section: 'BONUS',
                label: 'Thưởng kênh',
                amount: 1_500_000n,
                sortOrder: 0,
              },
            ],
          },
        },
      });
    });
    // Bản cũ đã bị thay ⇒ không thêm dòng; partial unique: một bản hiệu lực / (run, user).
    await expect(
      p.payslipLine.create({
        data: {
          id: randomUUID(),
          payslipId: slip.id,
          section: 'BONUS',
          label: 'x',
          amount: 1n,
          sortOrder: 5,
        },
      }),
    ).rejects.toThrow(/bất biến/);
    expect(await p.payslip.count({ where: { runId: run.id, supersededAt: null } })).toBe(1);
  });
});

describe('CHECK migration 7', () => {
  it('thực lĩnh ≠ (1)+(2)−(3), tiền âm / > 1e12, công > 62, sửa công thiếu lý do, revision 2 thiếu lý do ⇒ từ chối', async () => {
    const p = testPrisma();
    const { run } = await draftWithPayslip();
    const base = {
      runId: run.id,
      userId: kay,
      fullName: 'Kay',
      paidHalfDays: 40,
      salaryByDays: 100n,
      incomeTotal: 100n,
      bonusTotal: 0n,
      deductionTotal: 0n,
      netPay: 100n,
    };
    for (const bad of [
      { netPay: 99n },
      { paidHalfDays: 63 },
      { overrideHalfDays: 40 },
      { overrideReason: 'không sửa công' },
      { revision: 2 },
      { level: 'L1' }, // có level mà thiếu lương cơ bản
      { level: 'L1', baseSalary: 0n },
      { seniorityYears: 81 },
    ]) {
      await expect(
        p.payslip.create({ data: { id: randomUUID(), ...base, ...bad } }),
      ).rejects.toThrow();
    }
    // Thực lĩnh âm được trên NHÁP (chặn ở phát hành, không ở DB).
    await expect(
      p.payslip.create({
        data: { id: randomUUID(), ...base, deductionTotal: 300n, netPay: -200n },
      }),
    ).resolves.toMatchObject({ netPay: -200n });
    await expect(
      p.payrollRun.create({
        data: {
          id: randomUUID(),
          period: '2026-13',
          standardDays: 22,
          seniorityPerYear: 0n,
          createdById: kay,
        },
      }),
    ).rejects.toThrow();
    await expect(
      p.salaryProfile.create({
        data: {
          id: randomUUID(),
          userId: mia,
          effectiveFrom: '2026-10',
          level: 'L2',
          baseSalary: 1_000_000_000_001n,
          createdById: kay,
        },
      }),
    ).rejects.toThrow();
  });

  it('SEC-PAY-12: payroll_settings luôn một dòng (id = 1), mức 0..1e12, mặc định 500 000', async () => {
    const p = testPrisma();
    const rows = await p.payrollSettings.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, seniorityPerYear: 500_000n });
    await expect(p.payrollSettings.create({ data: { id: 2 } })).rejects.toThrow();
    await expect(
      p.payrollSettings.update({ where: { id: 1 }, data: { seniorityPerYear: -1n } }),
    ).rejects.toThrow();
  });
});

describe('RD-11 — lương ngoài mọi bước retention', () => {
  it('chạy job retention 10 năm sau: bảng lương, phiếu, dòng, hồ sơ lương, audit PAYROLL_* còn nguyên; audit khác bị xóa', async () => {
    const p = testPrisma();
    const { run } = await draftWithPayslip();
    await publish(run.id);
    await p.salaryProfile.create({
      data: {
        id: randomUUID(),
        userId: mia,
        effectiveFrom: '2026-09',
        level: 'L2',
        baseSalary: 9_000_000n,
        createdById: kay,
        createdAt: OLD,
      },
    });
    const audit = (action: string, after: object) =>
      p.hrAuditLog.create({
        data: { id: randomUUID(), actorId: kay, action, after, createdAt: OLD },
      });
    await audit('PAYROLL_PUBLISH', { period: '2026-09', note: 'ghi chú kế toán' });
    await audit('PAYROLL_PAYSLIP_SET', { netPay: 9_500_000, note: 'sửa công' });
    await audit('GRANT_SET', { grants: ['HR_MANAGE'] });

    const uow = new RecordingUnitOfWork();
    const job = new RetentionJob({
      stores: prismaRetentionStores(() => uow.db()),
      policy: POLICY,
      uow,
      clock: new FakeClock(NOW),
    });
    expect((await job.execute()).complete).toBe(true);

    expect(await p.payrollRun.count()).toBe(1);
    expect(await p.payslip.count()).toBe(1);
    expect(await p.payslipLine.count()).toBe(2);
    expect(await p.salaryProfile.count()).toBe(1);
    const left = await p.hrAuditLog.findMany({ select: { action: true, after: true } });
    expect(left.map((a) => a.action).sort()).toEqual(['PAYROLL_PAYSLIP_SET', 'PAYROLL_PUBLISH']);
    // D7' (scrub `note`) cũng bỏ qua audit lương.
    for (const a of left) expect(a.after).toHaveProperty('note');
  });
});
