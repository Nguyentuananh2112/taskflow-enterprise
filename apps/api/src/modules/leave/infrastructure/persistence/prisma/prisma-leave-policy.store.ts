import type { ILeavePolicyStore, LeavePolicyRow } from '../../../application/ports/leave.ports';
import { halfDaysFromDecimal, halfDaysToDecimal } from '../../../domain/leave-balance';
import type { LeavePolicy } from '../../../domain/leave-policy';
import type { DbProvider } from './db';

const LOCK_KEY = 'taskflow:leave-policy';

type Row = {
  year: number;
  annualDays: { toString(): string };
  seniorityStepYears: number;
  seniorityBonusDays: { toString(): string };
  carryOverEnabled: boolean;
  carryOverMaxDays: { toString(): string };
  carryOverExpiryMonth: number;
  version: number;
  updatedById: string;
  updatedAt: Date;
};

const toRow = (r: Row): LeavePolicyRow => ({
  year: r.year,
  policy: {
    annual: halfDaysFromDecimal(r.annualDays),
    seniorityStepYears: r.seniorityStepYears,
    seniorityBonus: halfDaysFromDecimal(r.seniorityBonusDays),
    carryOverEnabled: r.carryOverEnabled,
    carryOverMax: halfDaysFromDecimal(r.carryOverMaxDays),
    carryOverExpiryMonth: r.carryOverExpiryMonth,
  },
  version: r.version,
  updatedById: r.updatedById,
  updatedAt: r.updatedAt,
});

const columns = (p: LeavePolicy) => ({
  annualDays: halfDaysToDecimal(p.annual),
  seniorityStepYears: p.seniorityStepYears,
  seniorityBonusDays: halfDaysToDecimal(p.seniorityBonus),
  carryOverEnabled: p.carryOverEnabled,
  carryOverMaxDays: halfDaysToDecimal(p.carryOverMax),
  carryOverExpiryMonth: p.carryOverExpiryMonth,
});

/**
 * `leave_policies` (migration 9, T-057). Khóa `taskflow:leave-policy` là advisory TRANSACTION, bậc 1 bảng khóa ADR-136:
 * lệnh ghi phép lấy bản shared, `PUT leave/policy` lấy bản exclusive — nhả khi commit / rollback.
 */
export class PrismaLeavePolicyStore implements ILeavePolicyStore {
  constructor(private readonly db: DbProvider) {}

  async lock(mode: 'shared' | 'exclusive'): Promise<void> {
    await (mode === 'shared'
      ? this.db().$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${LOCK_KEY}, 0))`
      : this.db().$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`);
  }

  async list(): Promise<LeavePolicyRow[]> {
    return (await this.db().leavePolicy.findMany({ orderBy: { year: 'asc' } })).map(toRow);
  }

  async put(input: {
    year: number;
    policy: LeavePolicy;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<LeavePolicyRow | null> {
    const data = { ...columns(input.policy), updatedById: input.updatedById, updatedAt: input.at };
    if (input.expectedVersion === 0) {
      // Tạo dòng mới; đã có dòng (người khác vừa tạo) ⇒ 0 dòng ⇒ 409 như lệch version.
      const created = await this.db().$executeRaw`
        INSERT INTO leave_policies (year, annual_days, seniority_step_years, seniority_bonus_days,
                                    carry_over_enabled, carry_over_max_days, carry_over_expiry_month,
                                    updated_by_id, updated_at)
        VALUES (${input.year}, ${data.annualDays}, ${data.seniorityStepYears}, ${data.seniorityBonusDays},
                ${data.carryOverEnabled}, ${data.carryOverMaxDays}, ${data.carryOverExpiryMonth},
                ${input.updatedById}::uuid, ${input.at})
        ON CONFLICT (year) DO NOTHING`;
      if (created === 0) return null;
    } else {
      const { count } = await this.db().leavePolicy.updateMany({
        where: { year: input.year, version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) return null;
    }
    const row = await this.db().leavePolicy.findUniqueOrThrow({ where: { year: input.year } });
    return toRow(row);
  }
}
