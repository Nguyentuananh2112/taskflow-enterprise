import type { LeavePolicyFields } from '@taskflow/contracts/leave';

import { daysText } from '@/entities/leave';

/** Phép năm của người có `years` năm làm việc tính tới 31/12 (ADR-131 — cùng công thức server, chỉ để minh họa). */
export const entitledFor = (p: LeavePolicyFields, years: number) =>
  p.annualDays + p.seniorityBonusDays * Math.floor(years / p.seniorityStepYears);

/**
 * Ví dụ sống dưới form (hr-extended §5): "Nhân viên vào 01/03/2019 có 13 ngày phép năm 2026; người vào giữa năm nay có
 * đủ 12 ngày". Người mẫu vào đủ 1 bậc thâm niên trước năm đang sửa.
 */
export function policyExample(p: LeavePolicyFields, year: number): string {
  const hiredYear = year - p.seniorityStepYears - 2;
  return (
    `Ví dụ: nhân viên vào 01/03/${hiredYear} có ${daysText(entitledFor(p, year - hiredYear))} phép năm ${year}; ` +
    `người vào giữa năm ${year} có đủ ${daysText(p.annualDays)}.`
  );
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: `Tháng ${i + 1}`,
}));
