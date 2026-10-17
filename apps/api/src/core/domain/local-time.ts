/**
 * Quy đổi thời điểm (UTC) ⇄ ngày + phút-trong-ngày theo múi giờ IANA của lịch làm việc (ADR-120).
 * Chỉ dùng `Intl.DateTimeFormat` — không thêm thư viện ngày. Server không phụ thuộc múi giờ máy.
 */

/** Ngày thuần `YYYY-MM-DD` theo lịch của múi giờ đang xét. */
export type LocalDate = string;

const MINUTE_MS = 60_000;
export const DAY_MIN = 24 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalTime {
  date: LocalDate;
  /** Phút kể từ 00:00 địa phương của `date` (0–1439). */
  minute: number;
}

export function toLocal(instant: Date, timeZone: string): LocalTime {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    minute: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

/** Số ngày lịch giữa hai ngày thuần (`b − a`). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (DAY_MIN * MINUTE_MS),
  );
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MIN * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
}

/** Thứ trong tuần, 0 = thứ Hai … 6 = Chủ nhật (khớp bitmask `workdays` T2..CN). */
export function weekdayOf(date: LocalDate): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Phút của `instant` tính từ 00:00 địa phương của `date` — có thể âm (trước ngày) hoặc ≥ 1440 (lượt
 * OUT sau nửa đêm vẫn thuộc `date`). Đo theo giờ ĐỒNG HỒ địa phương: ngày đổi giờ (DST) không làm lệch
 * mốc 08:00 / 17:30 của lịch.
 */
export function minutesFrom(date: LocalDate, instant: Date, timeZone: string): number {
  const local = toLocal(instant, timeZone);
  return daysBetween(date, local.date) * DAY_MIN + local.minute;
}

/** Offset (phút) của múi giờ tại `instant`: giờ địa phương − UTC. */
function offsetMin(instant: Date, timeZone: string): number {
  const local = toLocal(instant, timeZone);
  const asUtc = Date.parse(`${local.date}T00:00:00Z`) + local.minute * MINUTE_MS;
  return Math.round((asUtc - Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/**
 * Thời điểm UTC của `date` + `minute` (giờ địa phương). Giờ không tồn tại (khoảng nhảy DST mùa xuân) ⇒
 * thời điểm ngay sau khoảng nhảy; giờ lặp (mùa thu) ⇒ lần đầu. Dùng cho test và quy đổi mốc của lịch.
 */
export function instantOf(date: LocalDate, minute: number, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  let guess = naive - offsetMin(new Date(naive), timeZone) * MINUTE_MS;
  guess = naive - offsetMin(new Date(guess), timeZone) * MINUTE_MS;
  return new Date(guess);
}
