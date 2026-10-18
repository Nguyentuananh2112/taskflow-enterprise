import type { Prisma } from '../../../../generated/prisma/client';
import { uniqueConstraintOf } from '../../../../core/persistence/unique-constraint';
import type {
  IPayrollStore,
  PayrollRunRecord,
  PayslipRecord,
  SalaryProfileRecord,
} from '../../application/ports/payroll-store.port';
import type { ILogger } from '../../../../core/logging/logger';
import { PAYROLL_SETTINGS_ID } from '../../domain/payroll-settings';
import { fromBig, payslipData, toPayslip, toRun } from './prisma-payroll-mapping';
import { readPayrollSettings } from './prisma-payroll-settings';

export type DbProvider = () => Prisma.TransactionClient;

const SETTINGS_ID = PAYROLL_SETTINGS_ID;
const WITH_LINES = { lines: { orderBy: { sortOrder: 'asc' } } } as const;

/**
 * Lương trên Prisma (migration 7, T-048). Tiền `BigInt` ⇄ number ở biên (assert an toàn). Ràng buộc DB là chốt cuối:
 * unique (period), (user, effective_from), một bản hiệu lực / (run, user); trigger: bảng PUBLISHED bất biến ⇒ phát hành
 * = MỘT UPDATE đặt đủ 4 cột; bản điều chỉnh = UPDATE CHỈ `superseded_at` rồi INSERT bản mới đã tính xong.
 */
export class PrismaPayrollStore implements IPayrollStore {
  constructor(
    private readonly db: DbProvider,
    private readonly logger?: Pick<ILogger, 'warn'>,
  ) {}

  async lockPeriod(period: string): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:payroll:${period}`}, 0))`;
  }

  getSettings() {
    return readPayrollSettings(this.db(), this.logger);
  }

  async updateSettings(input: Parameters<IPayrollStore['updateSettings']>[0]) {
    const { count } = await this.db().payrollSettings.updateMany({
      where: { id: SETTINGS_ID, version: input.expectedVersion },
      data: {
        seniorityPerYear: BigInt(input.seniorityPerYear),
        version: { increment: 1 },
        updatedById: input.updatedById,
        updatedAt: input.at,
      },
    });
    return count === 1 ? this.getSettings() : null;
  }

  async listProfiles(userIds?: readonly string[]): Promise<SalaryProfileRecord[]> {
    if (userIds?.length === 0) return [];
    const rows = await this.db().salaryProfile.findMany({
      where: userIds ? { userId: { in: [...userIds] } } : {},
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({ ...r, baseSalary: fromBig(r.baseSalary) }));
  }

  async insertProfile(record: SalaryProfileRecord): Promise<'ok' | 'duplicate'> {
    const { count } = await this.db().salaryProfile.createMany({
      data: [{ ...record, baseSalary: BigInt(record.baseSalary) }],
      skipDuplicates: true,
    });
    return count === 1 ? 'ok' : 'duplicate';
  }

  async listRuns() {
    const runs = await this.db().payrollRun.findMany({ orderBy: { period: 'desc' } });
    const sums = await this.db().payslip.groupBy({
      by: ['runId'],
      where: { supersededAt: null },
      _count: { _all: true },
      _sum: { netPay: true },
    });
    const byRun = new Map(sums.map((s) => [s.runId, s]));
    return runs.map((r) => ({
      ...toRun(r),
      payslipCount: byRun.get(r.id)?._count._all ?? 0,
      netTotal: fromBig(byRun.get(r.id)?._sum.netPay ?? 0n),
    }));
  }

  async findRun(period: string): Promise<PayrollRunRecord | null> {
    const r = await this.db().payrollRun.findUnique({ where: { period } });
    return r ? toRun(r) : null;
  }

  async insertRun(record: PayrollRunRecord): Promise<'ok' | 'exists'> {
    try {
      await this.db().payrollRun.create({
        data: {
          id: record.id,
          period: record.period,
          status: record.status,
          standardDays: record.standardDays,
          seniorityPerYear: BigInt(record.seniorityPerYear),
          createdById: record.createdById,
          createdAt: record.createdAt,
        },
      });
      return 'ok';
    } catch (err) {
      // Khóa kỳ tuần tự hóa tạo nháp — unique (period) chỉ là chốt cuối.
      if (uniqueConstraintOf(err) !== null) return 'exists';
      throw err;
    }
  }

  async updateDraftRun(runId: string, input: { standardDays: number; seniorityPerYear: number }) {
    const { count } = await this.db().payrollRun.updateMany({
      where: { id: runId, status: 'DRAFT' },
      data: { standardDays: input.standardDays, seniorityPerYear: BigInt(input.seniorityPerYear) },
    });
    return count === 1;
  }

  async publishRun(input: Parameters<IPayrollStore['publishRun']>[0]) {
    const { count } = await this.db().payrollRun.updateMany({
      where: { id: input.runId, status: 'DRAFT' },
      data: {
        status: 'PUBLISHED',
        publishedAt: input.publishedAt,
        publishedById: input.publishedById,
        companyName: input.companyName,
      },
    });
    return count === 1;
  }

  async listCurrentPayslips(runId: string): Promise<PayslipRecord[]> {
    const rows = await this.db().payslip.findMany({
      where: { runId, supersededAt: null },
      include: WITH_LINES,
      orderBy: { userId: 'asc' },
    });
    return rows.map((r) => toPayslip(r));
  }

  async findCurrentPayslip(runId: string, userId: string): Promise<PayslipRecord | null> {
    const r = await this.db().payslip.findFirst({
      where: { runId, userId, supersededAt: null },
      include: WITH_LINES,
    });
    return r ? toPayslip(r) : null;
  }

  async listRevisions(runId: string, userId: string): Promise<PayslipRecord[]> {
    const rows = await this.db().payslip.findMany({
      where: { runId, userId },
      include: WITH_LINES,
      orderBy: { revision: 'asc' },
    });
    return rows.map((r) => toPayslip(r));
  }

  async insertPayslip(record: PayslipRecord): Promise<void> {
    await this.db().payslip.create({ data: payslipData(record) });
    await this.#insertLines(record);
  }

  async updateDraftPayslip(record: PayslipRecord, expectedLockVersion: number) {
    const { id, runId: _run, userId: _user, createdAt: _c, ...rest } = payslipData(record);
    const { count } = await this.db().payslip.updateMany({
      where: { id, supersededAt: null, lockVersion: expectedLockVersion },
      data: { ...rest, lockVersion: { increment: 1 } },
    });
    if (count !== 1) return null;
    await this.db().payslipLine.deleteMany({ where: { payslipId: record.id } });
    await this.#insertLines(record);
    return this.findCurrentPayslip(record.runId, record.userId);
  }

  async supersede(payslipId: string, at: Date) {
    const { count } = await this.db().payslip.updateMany({
      where: { id: payslipId, supersededAt: null },
      data: { supersededAt: at },
    });
    return count === 1;
  }

  async myPayslips(userId: string) {
    const rows = await this.db().payslip.findMany({
      where: { userId, supersededAt: null, run: { status: 'PUBLISHED' } },
      select: { revision: true, run: { select: { period: true, publishedAt: true } } },
      orderBy: { run: { period: 'desc' } },
    });
    return rows.map((r) => ({
      period: r.run.period,
      revision: r.revision,
      publishedAt: r.run.publishedAt!,
    }));
  }

  async payslipPeriods(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db().payslip.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, run: { select: { period: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.run.period]));
  }

  async #insertLines(record: PayslipRecord): Promise<void> {
    if (record.lines.length === 0) return;
    await this.db().payslipLine.createMany({
      data: record.lines.map((l, i) => ({
        id: l.id,
        payslipId: record.id,
        section: l.section,
        label: l.label,
        amount: BigInt(l.amount),
        sortOrder: i,
      })),
    });
  }
}
