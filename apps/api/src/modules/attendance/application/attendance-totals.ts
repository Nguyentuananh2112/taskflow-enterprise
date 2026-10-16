import type { AttendanceDayDto, AttendanceTotalsDto } from '@taskflow/contracts';

/**
 * Tổng tháng của một người (bảng HR, CSV). Chỉ ngày công mới đếm: NOT_EMPLOYED / HOLIDAY / OFF ⇒ 0 (TL).
 * Vắng: ABSENT = 1 ngày, ABSENT + `absentHalf` (nghỉ nửa ngày, vắng nửa kia) = 0,5. Nghỉ phép: FULL = 1
 * (ON_LEAVE), AM/PM = 0,5 trên ngày công.
 */
export function totalsOf(days: readonly AttendanceDayDto[]): AttendanceTotalsDto {
  const t: AttendanceTotalsDto = {
    workedMin: 0,
    lateDays: 0,
    lateMin: 0,
    earlyDays: 0,
    earlyMin: 0,
    absentDays: 0,
    leaveDays: 0,
    missingOutDays: 0,
  };
  for (const d of days) {
    if (d.status === 'NOT_EMPLOYED' || d.status === 'HOLIDAY' || d.status === 'OFF') continue;
    t.workedMin += d.workedMin;
    t.lateMin += d.lateMin;
    t.earlyMin += d.earlyMin;
    if (d.late) t.lateDays += 1;
    if (d.early) t.earlyDays += 1;
    if (d.status === 'ABSENT') t.absentDays += d.absentHalf ? 0.5 : 1;
    if (d.status === 'MISSING_OUT') t.missingOutDays += 1;
    if (d.leave === 'FULL') t.leaveDays += 1;
    else if (d.leave !== null) t.leaveDays += 0.5;
  }
  return t;
}
