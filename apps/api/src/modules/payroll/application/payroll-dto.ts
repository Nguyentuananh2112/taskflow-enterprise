import type {
  PayrollSettingsDto,
  PayslipDto,
  SalaryProfileVersionDto,
} from '@taskflow/contracts/payroll';

import type {
  PayrollRunRecord,
  PayrollSettingsRecord,
  PayslipRecord,
  SalaryProfileRecord,
} from './ports/payroll-store.port';

export type PersonRef = { id: string; fullName: string };
export type Refs = ReadonlyMap<string, PersonRef>;

export const UNKNOWN_USER = 'Người dùng đã xóa';
export const refOf = (refs: Refs, id: string): PersonRef =>
  refs.get(id) ?? { id, fullName: UNKNOWN_USER };

export function settingsDto(s: PayrollSettingsRecord, refs: Refs): PayrollSettingsDto {
  return {
    seniorityPerYear: s.seniorityPerYear,
    version: s.version,
    updatedAt: s.updatedAt.toISOString(),
    updatedBy: s.updatedById ? refOf(refs, s.updatedById) : null,
  };
}

export function profileVersionDto(p: SalaryProfileRecord, refs: Refs): SalaryProfileVersionDto {
  return {
    id: p.id,
    effectiveFrom: p.effectiveFrom,
    level: p.level,
    baseSalary: p.baseSalary,
    createdBy: refOf(refs, p.createdById),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Phiếu đầy đủ (ADR-125: mọi số là ảnh chụp). Tên công ty chỉ có khi đã phát hành. */
export function payslipDto(run: PayrollRunRecord, p: PayslipRecord): PayslipDto {
  return {
    period: run.period,
    userId: p.userId,
    fullName: p.fullName,
    companyName: run.companyName,
    status: run.status,
    revision: p.revision,
    lockVersion: p.lockVersion,
    level: p.level,
    baseSalary: p.baseSalary,
    hireDate: p.hireDate,
    seniorityYears: p.seniorityYears,
    seniorityPerYear: run.seniorityPerYear,
    seniorityAllowance: p.seniorityAllowance,
    paidHalfDays: p.paidHalfDays,
    standardDays: run.standardDays,
    overrideHalfDays: p.overrideHalfDays,
    overrideReason: p.overrideReason,
    lines: p.lines.map((l) => ({ id: l.id, section: l.section, label: l.label, amount: l.amount })),
    note: p.note,
    salaryByDays: p.salaryByDays,
    incomeTotal: p.incomeTotal,
    bonusTotal: p.bonusTotal,
    deductionTotal: p.deductionTotal,
    netPay: p.netPay,
    revisionReason: p.revisionReason,
    revisedAt: p.revision > 1 ? p.createdAt.toISOString() : null,
    supersededAt: p.supersededAt?.toISOString() ?? null,
    publishedAt: run.publishedAt?.toISOString() ?? null,
    hasSickDays: p.hasSickDays,
  };
}
