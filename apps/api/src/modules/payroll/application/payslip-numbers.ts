import {
  completedYears,
  computePayslip,
  periodLastDay,
  seniorityAllowanceOf,
  type PayslipMathLine,
  type PayslipTotals,
} from '@taskflow/contracts/payroll';

/** Lý do CHẶN phát hành của một phiếu (= `PublishBlockReason` của contracts — parity ở test). */
export type PublishBlockReason =
  | 'NEGATIVE_NET_PAY'
  | 'MISSING_SALARY_PROFILE'
  | 'MISSING_HIRE_DATE'
  | 'HIRE_DATE_AFTER_PERIOD'
  | 'HIRE_DATE_CHANGED'
  | 'SENIORITY_RATE_CHANGED';

export interface PayslipNumbersInput {
  period: string;
  /** Phiên bản hồ sơ lương áp cho kỳ; `null` ⇒ thiếu hồ sơ (chặn phát hành, lương theo công = 0). */
  profile: { level: string; baseSalary: number } | null;
  /** `EmployeeProfile.hireDate` hiện hành (ADR-128) — ảnh chụp lên phiếu. */
  hireDate: string | null;
  seniorityPerYear: number;
  standardDays: number;
  paidHalfDays: number;
  overrideHalfDays: number | null;
  lines: readonly PayslipMathLine[];
}

export interface PayslipNumbers extends PayslipTotals {
  seniorityYears: number;
  /** Công đang tính = override ?? theo chấm công, trần 2S. */
  countedHalfDays: number;
  /** Lý do chặn của CHÍNH phiếu (thiếu hồ sơ / ngày vào / ngày vào sau kỳ / thực lĩnh âm). */
  blockReasons: PublishBlockReason[];
}

/**
 * Số trên một phiếu (payroll.md ADR-125) — hàm THUẦN quanh `computePayslip` (nguồn tổng duy nhất). Thâm niên = mức/năm ×
 * số năm TRÒN từ `hireDate` tới ngày cuối kỳ, trả đủ không chia theo công (kể cả h = 0, nghỉ việc / lên Admin giữa
 * tháng). Thiếu hồ sơ lương ⇒ lương theo công 0 + cờ; thiếu `hireDate` hoặc `hireDate` sau kỳ ⇒ thâm niên 0 + cờ.
 */
export function payslipNumbers(q: PayslipNumbersInput): PayslipNumbers {
  const years = q.hireDate === null ? null : completedYears(q.hireDate, periodLastDay(q.period));
  const seniorityYears = years ?? 0;
  const countedHalfDays = Math.min(q.overrideHalfDays ?? q.paidHalfDays, 2 * q.standardDays);
  const totals = computePayslip({
    baseSalary: q.profile?.baseSalary ?? 0,
    paidHalfDays: countedHalfDays,
    standardDays: q.standardDays,
    seniorityAllowance: seniorityAllowanceOf(q.seniorityPerYear, seniorityYears),
    lines: q.lines,
  });
  const blockReasons: PublishBlockReason[] = [];
  if (q.profile === null) blockReasons.push('MISSING_SALARY_PROFILE');
  if (q.hireDate === null) blockReasons.push('MISSING_HIRE_DATE');
  else if (years === null) blockReasons.push('HIRE_DATE_AFTER_PERIOD');
  if (totals.netPay < 0) blockReasons.push('NEGATIVE_NET_PAY');
  return { ...totals, seniorityYears, countedHalfDays, blockReasons };
}

/** Phiên bản hồ sơ lương áp cho kỳ: `effectiveFrom ≤ period` muộn nhất; không có ⇒ null. */
export function profileFor<T extends { effectiveFrom: string }>(
  versions: readonly T[],
  period: string,
): T | null {
  return versions
    .filter((v) => v.effectiveFrom <= period)
    .reduce<T | null>((a, v) => (!a || v.effectiveFrom > a.effectiveFrom ? v : a), null);
}

/**
 * Cờ "đã đổi — cần tính lại" của một phiếu NHÁP (chặn phát hành): `hireDate` ảnh chụp ≠ hiện hành; mức thâm niên ảnh
 * chụp của bảng ≠ cài đặt hiện hành.
 */
export function staleReasons(q: {
  snapshotHireDate: string | null;
  currentHireDate: string | null;
  runSeniorityPerYear: number;
  currentSeniorityPerYear: number;
}): PublishBlockReason[] {
  const out: PublishBlockReason[] = [];
  if (q.snapshotHireDate !== q.currentHireDate) out.push('HIRE_DATE_CHANGED');
  if (q.runSeniorityPerYear !== q.currentSeniorityPerYear) out.push('SENIORITY_RATE_CHANGED');
  return out;
}
