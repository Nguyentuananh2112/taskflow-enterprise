import { toLocal, type LocalDate } from './local-time';

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

/**
 * TẠM (tới khi port nhiệm kỳ công ty trả ngày — T-063): nhiệm kỳ membership ws còn là instant joinedAt / leftAt ⇒ quy về
 * ngày địa phương theo múi giờ lịch của ngày đang xét (giữ đúng hành vi T-037b: ngày rời tính như thường).
 */
export function tenureOnLocalDays(t: { from: Date; until: Date | null }, timezone: string): Tenure {
  return {
    from: toLocal(t.from, timezone).date,
    until: t.until === null ? null : toLocal(t.until, timezone).date,
  };
}
