import type { CalendarDate, CalendarDay, HalfDays, LeaveSpan } from './leave-days';
import { countTenureHalfDays, type LeaveTenure } from './leave-tenure';

// Chính sách phép (T-057, hr-extended.md ADR-131) — HÀM THUẦN, số nguyên nửa ngày, ngày là chuỗi `YYYY-MM-DD`.
// Stryker `leave-domain` ≥ 90 % + property test (LP-01…LP-13).

/** Một bộ chính sách đã chuẩn hóa sang nửa ngày. Mặc định = mức luật (Đ.113 k.1, Đ.114). */
export interface LeavePolicy {
  annual: HalfDays;
  seniorityStepYears: number;
  seniorityBonus: HalfDays;
  carryOverEnabled: boolean;
  carryOverMax: HalfDays;
  carryOverExpiryMonth: number;
}

export const LEGAL_LEAVE_POLICY: Readonly<LeavePolicy> = Object.freeze({
  annual: 24,
  seniorityStepYears: 5,
  seniorityBonus: 2,
  carryOverEnabled: false,
  carryOverMax: 0,
  carryOverExpiryMonth: 3,
});

export type PolicySource = 'SET' | 'INHERITED' | 'DEFAULT';

export interface ResolvedPolicy {
  policy: LeavePolicy;
  source: PolicySource;
  /** Năm của dòng được dùng; null khi `DEFAULT`. */
  fromYear: number | null;
}

/** LP-01: năm có dòng ⇒ dòng đó; không ⇒ dòng GẦN NHẤT TRƯỚC đó; không có ⇒ mức luật. Dòng năm sau không dùng. */
export function resolvePolicy(
  rows: readonly { year: number; policy: LeavePolicy }[],
  year: number,
): ResolvedPolicy {
  let best: { year: number; policy: LeavePolicy } | undefined;
  for (const r of rows) {
    if (r.year <= year && (best === undefined || r.year > best.year)) best = r;
  }
  if (!best) return { policy: LEGAL_LEAVE_POLICY, source: 'DEFAULT', fromYear: null };
  return {
    policy: best.policy,
    source: best.year === year ? 'SET' : 'INHERITED',
    fromYear: best.year,
  };
}

const yearOf = (d: CalendarDate) => Number(d.slice(0, 4));
const endOfYear = (year: number): CalendarDate => `${String(year)}-12-31`;
const startOfYear = (year: number): CalendarDate => `${String(year)}-01-01`;

/**
 * Số năm TRÒN từ `from` tới `on` (chuỗi ngày thuần — kể cả 29/02: chưa tới 28/02 năm không nhuận thì chưa tròn).
 * `on < from` ⇒ 0.
 */
export function fullYearsBetween(from: CalendarDate, on: CalendarDate): number {
  if (on < from) return 0;
  const years = yearOf(on) - yearOf(from);
  return on.slice(5) < from.slice(5) ? years - 1 : years;
}

/** LP-02: thâm niên tính tới 31/12/Y — đủ N năm trong năm Y ⇒ được cộng ngay năm Y. */
export const seniorityYearsAt = (hireDate: CalendarDate, year: number): number =>
  fullYearsBetween(hireDate, endOfYear(year));

export interface Entitlement {
  /** `annual + bonus` (trước ghi đè); 0 khi năm không giao nhiệm kỳ / bắt đầu sau 31/12. */
  base: HalfDays;
  bonus: HalfDays;
  seniorityYears: number | null;
  entitled: HalfDays;
  source: 'POLICY' | 'OVERRIDE';
  missingHireDate: boolean;
}

/**
 * `entitlementOf` (ADR-131, LP-02…05, LP-13): `base = annual + bonus × floor(years / step)`; năm Y không giao nhiệm
 * kỳ EMPLOYEE nào (`tenure` null) ⇒ 0; ngày hiệu lực `max(hireDate, tenure.from)` sau 31/12/Y ⇒ 0; vào giữa năm ⇒
 * ĐỦ base (người dùng chốt, không tỷ lệ). Không `hireDate` ⇒ `annual`, cờ thiếu. Ghi đè khác null thắng (LP-05).
 */
export function entitlementOf(input: {
  policy: LeavePolicy;
  year: number;
  hireDate: CalendarDate | null;
  /** Nhiệm kỳ dùng để đếm năm Y (đã chọn bởi bên gọi); null ⇒ không giao. */
  tenure: LeaveTenure | null;
  override: HalfDays | null;
}): Entitlement {
  const { policy, year, hireDate, tenure } = input;
  const missingHireDate = hireDate === null;
  const seniorityYears = hireDate === null ? null : seniorityYearsAt(hireDate, year);
  const covers =
    tenure !== null &&
    tenure.from <= endOfYear(year) &&
    (tenure.until === null || tenure.until >= startOfYear(year));
  const effective = !covers
    ? null
    : hireDate !== null && hireDate > tenure.from
      ? hireDate
      : tenure.from;
  const bonus =
    effective === null || effective > endOfYear(year) || seniorityYears === null
      ? 0
      : policy.seniorityBonus * Math.floor(seniorityYears / policy.seniorityStepYears);
  const base = effective === null || effective > endOfYear(year) ? 0 : policy.annual + bonus;
  if (input.override !== null) {
    return {
      base,
      bonus,
      seniorityYears,
      entitled: input.override,
      source: 'OVERRIDE',
      missingHireDate,
    };
  }
  return { base, bonus, seniorityYears, entitled: base, source: 'POLICY', missingHireDate };
}

/** Hạn dùng phép chuyển sang: NGÀY CUỐI tháng `month` năm `year` (tháng 2 ⇒ 28/29 theo năm nhuận — D-L3). */
export function carryOverExpiresOn(year: number, month: number): CalendarDate {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * `carried(Y)` (ADR-131, LP-06/06b): làm LIÊN TỤC qua 31/12/(Y−1) → 01/01/Y và năm Y−1 bật chuyển phép ⇒
 * `min(trần(Y−1), max(0, còn lại cuối năm Y−1))`, còn lại cuối năm chỉ trừ đơn APPROVED. Không chuyển tiếp lần 2:
 * `remainingAtYearEnd` của bên gọi KHÔNG gồm phép chuyển sang năm Y−1.
 */
export function carriedOverOf(input: {
  previousPolicy: LeavePolicy;
  continuous: boolean;
  remainingAtYearEnd: HalfDays;
}): HalfDays {
  if (!input.continuous || !input.previousPolicy.carryOverEnabled) return 0;
  return Math.min(input.previousPolicy.carryOverMax, Math.max(0, input.remainingAtYearEnd));
}

/** Liên tục qua giao thừa (Y−1 → Y): MỘT nhiệm kỳ chứa cả 31/12/(Y−1) lẫn 01/01/Y. */
export function continuousInto(tenures: readonly LeaveTenure[], year: number): boolean {
  const eve = endOfYear(year - 1);
  const day = startOfYear(year);
  return tenures.some((t) => t.from <= eve && (t.until === null || t.until >= day));
}

/** Nửa ngày của một đơn trong nhiệm kỳ, tách ở hạn `expiresOn`: ≤ hạn (`early`) và sau hạn (`late`) — LP-07. */
export function splitAtExpiry(
  span: LeaveSpan,
  calendar: readonly CalendarDay[],
  tenure: LeaveTenure,
  expiresOn: CalendarDate,
): { early: HalfDays; late: HalfDays } {
  // Khoảng rỗng (vd nhiệm kỳ kết thúc trước hạn) ⇒ `clipToTenure` trả null ⇒ 0 — không cần nhánh riêng.
  const dayAfter = new Date(Date.parse(`${expiresOn}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const until = tenure.until !== null && tenure.until < expiresOn ? tenure.until : expiresOn;
  return {
    early: countTenureHalfDays(span, calendar, { from: tenure.from, until }),
    late: countTenureHalfDays(span, calendar, {
      from: tenure.from > dayAfter ? tenure.from : dayAfter,
      until: tenure.until,
    }),
  };
}

export interface AnnualBalance {
  /** `entitled + adjustment`. */
  budget: HalfDays;
  carried: HalfDays;
  usedEarly: HalfDays;
  usedLate: HalfDays;
  /** Phần phép chuyển sang chưa dùng và CÒN HẠN tại `today`. */
  carriedUsable: HalfDays;
  remaining: HalfDays;
  /** Hợp lệ ⇔ `max(0, uEarly − C) + uLate ≤ B` (không bao giờ để `remaining < 0` do đơn mới). */
  covers: boolean;
}

/**
 * Kiểm số dư (ADR-131, thay ADR-122): `uEarly`/`uLate` = nửa ngày ANNUAL (APPROVED + PENDING khác + đơn đang xét)
 * của nhiệm kỳ hiện tại, ≤ hạn / sau hạn. Phép chuyển sang trừ trước, chỉ cho phần ≤ hạn (LP-07/08).
 */
export function annualBalance(input: {
  entitled: HalfDays;
  adjustment: HalfDays;
  carried: HalfDays;
  usedEarly: HalfDays;
  usedLate: HalfDays;
  today: CalendarDate;
  expiresOn: CalendarDate;
}): AnnualBalance {
  const budget = input.entitled + input.adjustment;
  const fromBudget = Math.max(0, input.usedEarly - input.carried) + input.usedLate;
  const carriedUsable =
    input.today <= input.expiresOn ? Math.max(0, input.carried - input.usedEarly) : 0;
  return {
    budget,
    carried: input.carried,
    usedEarly: input.usedEarly,
    usedLate: input.usedLate,
    carriedUsable,
    remaining: budget - fromBudget + carriedUsable,
    covers: fromBudget <= budget,
  };
}
