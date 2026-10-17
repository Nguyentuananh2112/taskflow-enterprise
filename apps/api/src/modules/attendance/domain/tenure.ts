import type { LocalDate } from './local-time';

/**
 * Một nhiệm kỳ nhân viên bằng NGÀY (ADR-133, A C1): `from` = ngày đầu, `until` = ngày cuối (gồm cả hai đầu; `null` = đang
 * làm). So chuỗi `YYYY-MM-DD` — không instant, không múi giờ: HR nhập ngày, đổi múi giờ lịch về sau không dời nhiệm kỳ.
 */
export interface Tenure {
  from: LocalDate;
  until: LocalDate | null;
}

/** Ngày `date` nằm trong một nhiệm kỳ (ngày đầu và ngày cuối đều tính như thường). */
export function employedOn(tenures: readonly Tenure[], date: LocalDate): boolean {
  return tenures.some((t) => t.from <= date && (t.until === null || date <= t.until));
}
