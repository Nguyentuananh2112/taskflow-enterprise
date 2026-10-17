import type { SeniorityDto } from '@taskflow/contracts/company';

/** "7 năm 7 tháng" · "3 tháng" · "dưới 1 tháng" (thâm niên server tính tới hôm nay). */
export function seniorityText(s: SeniorityDto): string {
  const parts = [s.years > 0 && `${s.years} năm`, s.months > 0 && `${s.months} tháng`].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(' ') : 'dưới 1 tháng';
}

/** "Vào công ty 03/2019 — 7 năm 7 tháng"; null khi chưa có ngày vào. */
export function hireDateLine(hireDate: string | null, seniority: SeniorityDto | null) {
  if (!hireDate) return null;
  const month = `${hireDate.slice(5, 7)}/${hireDate.slice(0, 4)}`;
  return seniority ? `Vào công ty ${month} — ${seniorityText(seniority)}` : `Vào công ty ${month}`;
}

export const MISSING_HIRE_DATE = 'Thiếu ngày vào công ty — cần cho lương và phép thâm niên';
