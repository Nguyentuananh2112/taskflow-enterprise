import { toLocal, type LocalDate } from './local-time';

/** Một nhiệm kỳ thành viên (nhân viên): `from` = joinedAt, `until` = leftAt (`null` = đang là thành viên). */
export interface Tenure {
  from: Date;
  until: Date | null;
}

/**
 * Ngày `date` (theo `timezone` của lịch hiệu lực ngày đó) nằm trong một nhiệm kỳ: ngày địa phương của
 * joinedAt ≤ `date` ≤ ngày địa phương của leftAt — ngày gia nhập và ngày rời đều tính như thường (TL, Q9).
 */
export function employedOn(tenures: readonly Tenure[], date: LocalDate, timezone: string): boolean {
  return tenures.some(
    (t) =>
      toLocal(t.from, timezone).date <= date &&
      (t.until === null || date <= toLocal(t.until, timezone).date),
  );
}
