import type { Payslip, PayslipLine, PayrollRun } from '../../../../generated/prisma/client';
import type { PayrollRunRecord, PayslipRecord } from '../../application/ports/payroll-store.port';

export type PayslipRow = Payslip & { lines: PayslipLine[] };

/** `BigInt` (cột tiền) ⇒ number — ngoài vùng an toàn là lỗi dữ liệu, không trả số sai (ADR-125). */
export function fromBig(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`Tiền vượt số nguyên an toàn: ${v.toString()}`);
  return n;
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toRun(r: PayrollRun): PayrollRunRecord {
  return {
    id: r.id,
    period: r.period,
    status: r.status,
    standardDays: r.standardDays,
    seniorityPerYear: fromBig(r.seniorityPerYear),
    companyName: r.companyName,
    publishedAt: r.publishedAt,
    publishedById: r.publishedById,
    createdById: r.createdById,
    createdAt: r.createdAt,
  };
}

export function toPayslip(r: PayslipRow): PayslipRecord {
  return {
    id: r.id,
    runId: r.runId,
    userId: r.userId,
    revision: r.revision,
    lockVersion: r.lockVersion,
    fullName: r.fullName,
    level: r.level,
    baseSalary: r.baseSalary === null ? null : fromBig(r.baseSalary),
    hireDate: dateOnly(r.hireDate),
    seniorityYears: r.seniorityYears,
    seniorityAllowance: fromBig(r.seniorityAllowance),
    paidHalfDays: r.paidHalfDays,
    overrideHalfDays: r.overrideHalfDays,
    overrideReason: r.overrideReason,
    revisionReason: r.revisionReason,
    salaryByDays: fromBig(r.salaryByDays),
    incomeTotal: fromBig(r.incomeTotal),
    bonusTotal: fromBig(r.bonusTotal),
    deductionTotal: fromBig(r.deductionTotal),
    netPay: fromBig(r.netPay),
    note: r.note,
    hasSickDays: r.hasSickDays,
    supersededAt: r.supersededAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lines: r.lines.map((l) => ({
      id: l.id,
      section: l.section,
      label: l.label,
      amount: fromBig(l.amount),
    })),
  };
}

/** Cột của `payslips` (không dòng) — tiền ⇒ BigInt. `lines` để bên gọi ghi riêng. */
export function payslipData(p: PayslipRecord) {
  return {
    id: p.id,
    runId: p.runId,
    userId: p.userId,
    revision: p.revision,
    lockVersion: p.lockVersion,
    fullName: p.fullName,
    level: p.level,
    baseSalary: p.baseSalary === null ? null : BigInt(p.baseSalary),
    hireDate: p.hireDate ? new Date(`${p.hireDate}T00:00:00.000Z`) : null,
    seniorityYears: p.seniorityYears,
    seniorityAllowance: BigInt(p.seniorityAllowance),
    paidHalfDays: p.paidHalfDays,
    overrideHalfDays: p.overrideHalfDays,
    overrideReason: p.overrideReason,
    revisionReason: p.revisionReason,
    salaryByDays: BigInt(p.salaryByDays),
    incomeTotal: BigInt(p.incomeTotal),
    bonusTotal: BigInt(p.bonusTotal),
    deductionTotal: BigInt(p.deductionTotal),
    netPay: BigInt(p.netPay),
    note: p.note,
    hasSickDays: p.hasSickDays,
    supersededAt: p.supersededAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
