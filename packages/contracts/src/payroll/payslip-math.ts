// Mốc 4 (payroll.md ADR-125, T-049): phép tính phiếu lương — hàm THUẦN dùng chung web (xem trước tổng khi gõ) và API (tính
// lại, là chuẩn). Tiền là số nguyên VND; công là số nguyên NỬA NGÀY; ngày là chuỗi `YYYY-MM-DD` (không `Date`, không múi
// giờ ⇒ cùng kết quả ở mọi máy). Đầu vào sai ⇒ ném `RangeError` (không bao giờ trả số sai).

import { MAX_HALF_DAYS, MAX_MONEY_VND, MAX_PAYSLIP_LINES, type PAYSLIP_SECTIONS } from './limits';

type PayslipSection = (typeof PAYSLIP_SECTIONS)[number];

/** Một dòng gõ tay khi TÍNH (body đầy đủ có `label` là `PayslipLineInput` ở payroll.schemas). */
export interface PayslipMathLine {
  section: PayslipSection;
  /** ≥ 0 — dấu do mục quyết định. */
  amount: number;
}

export interface PayslipInput {
  baseSalary: number;
  /** Công tính lương (nửa ngày) sau khi sửa tay; trần `2 × standardDays` áp ở đây. */
  paidHalfDays: number;
  /** Công chuẩn của tháng (ngày, ≥ 1) — ảnh chụp của bảng lương. */
  standardDays: number;
  /** Phụ cấp thâm niên đã tính (`seniorityAllowanceOf`) — trả đủ, không chia theo công. */
  seniorityAllowance: number;
  lines: readonly PayslipMathLine[];
}

export interface PayslipTotals {
  salaryByDays: number;
  seniorityAllowance: number;
  /** (1) = lương theo công + thâm niên + Σ INCOME. */
  incomeTotal: number;
  /** (2) = Σ BONUS. */
  bonusTotal: number;
  /** (3) = Σ DEDUCTION. */
  deductionTotal: number;
  /** (4) = (1) + (2) − (3); âm ⇒ cấm phát hành (`NEGATIVE_NET_PAY`). */
  netPay: number;
}

function assertInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${name} phải là số nguyên trong [${String(min)}, ${String(max)}]: ${String(value)}`,
    );
  }
}

/**
 * Lương theo công, làm tròn half-up MỘT lần trên lương cơ bản: `floor((2·base·h' + 2S) / (4S))` với `h' = min(h, 2S)`
 * (= base × (h'/2) / S làm tròn nửa lên). Mọi phép là số nguyên; lớn nhất 2·1e12·62 ≈ 1,24e14 < 2^53.
 */
export function salaryByDays(
  baseSalary: number,
  paidHalfDays: number,
  standardDays: number,
): number {
  assertInt('baseSalary', baseSalary, 0, MAX_MONEY_VND);
  assertInt('paidHalfDays', paidHalfDays, 0, MAX_HALF_DAYS);
  assertInt('standardDays', standardDays, 1, 31);
  const h = Math.min(paidHalfDays, 2 * standardDays);
  return Math.floor((2 * baseSalary * h + 2 * standardDays) / (4 * standardDays));
}

/** Tổng phiếu — DUY NHẤT nơi sinh tổng (ADR-125); server ghi cùng transaction với dòng, web dùng để xem trước. */
export function computePayslip(input: PayslipInput): PayslipTotals {
  if (input.lines.length > MAX_PAYSLIP_LINES) {
    throw new RangeError(
      `Tối đa ${String(MAX_PAYSLIP_LINES)} dòng / phiếu: ${String(input.lines.length)}`,
    );
  }
  assertInt('seniorityAllowance', input.seniorityAllowance, 0, MAX_MONEY_VND);
  const sums: Record<PayslipSection, number> = { INCOME: 0, BONUS: 0, DEDUCTION: 0 };
  for (const line of input.lines) {
    assertInt('amount', line.amount, 0, MAX_MONEY_VND);
    sums[line.section] += line.amount;
  }
  const byDays = salaryByDays(input.baseSalary, input.paidHalfDays, input.standardDays);
  const incomeTotal = byDays + input.seniorityAllowance + sums.INCOME;
  const totals: PayslipTotals = {
    salaryByDays: byDays,
    seniorityAllowance: input.seniorityAllowance,
    incomeTotal,
    bonusTotal: sums.BONUS,
    deductionTotal: sums.DEDUCTION,
    netPay: incomeTotal + sums.BONUS - sums.DEDUCTION,
  };
  for (const [name, value] of Object.entries(totals)) {
    if (!Number.isSafeInteger(value))
      throw new RangeError(`${name} vượt số nguyên an toàn: ${String(value)}`);
  }
  return totals;
}

// ---------------------------------------------------------------- ngày & thâm niên (chuỗi thuần)

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parts(date: string): [number, number, number] {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`Ngày phải có dạng YYYY-MM-DD: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Số ngày của tháng `m` (1..12) năm `y`. */
export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Ngày cuối của kỳ lương `YYYY-MM`. */
export function periodLastDay(period: string): string {
  const m = PERIOD.exec(period);
  if (!m) throw new RangeError(`Kỳ lương phải có dạng YYYY-MM: ${period}`);
  return `${period}-${String(daysInMonth(Number(m[1]), Number(m[2]))).padStart(2, '0')}`;
}

/**
 * Số năm làm việc TRÒN từ `hireDate` tới `asOf` (gồm ngày kỷ niệm): kỷ niệm năm Y là cùng ngày/tháng, ngày không có
 * trong tháng đó (29/02 năm không nhuận) ⇒ ngày cuối tháng (28/02). `hireDate > asOf` ⇒ `null` (bên gọi gắn cờ chặn phát
 * hành). Thuần chuỗi — không phụ thuộc múi giờ.
 */
export function completedYears(hireDate: string, asOf: string): number | null {
  const [hy, hm, hd] = parts(hireDate);
  const [ay, am, ad] = parts(asOf);
  if (hireDate > asOf) return null;
  const anniversaryDay = Math.min(hd, daysInMonth(ay, hm));
  const reached = am > hm || (am === hm && ad >= anniversaryDay);
  return ay - hy - (reached ? 0 : 1);
}

/** Phụ cấp thâm niên = mức/năm × số năm tròn (0 nếu < 1 năm) — không chia theo công (payroll §0, TL chốt). */
export function seniorityAllowanceOf(perYear: number, years: number): number {
  assertInt('seniorityPerYear', perYear, 0, MAX_MONEY_VND);
  assertInt('seniorityYears', years, 0, 200);
  const value = perYear * years;
  if (!Number.isSafeInteger(value) || value > MAX_MONEY_VND) {
    throw new RangeError(`seniorityAllowance vượt trần: ${String(value)}`);
  }
  return value;
}
