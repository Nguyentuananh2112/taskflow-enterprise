/**
 * Đồng hồ nghiệp vụ tất định cho test (TL d9, 2026-10-17): API nhận `TEST_CLOCK_ANCHOR` (chỉ khi APP_ENV=test,
 * A — fix/T-038-test-clock) ⇒ giờ nghiệp vụ = mốc + thời gian thực đã trôi kể từ lúc process khởi động. Auth/JWT
 * và rate limiter vẫn theo giờ thật.
 *
 * Mốc KHÔNG là một ngày cố định: `joinedAt` của thành viên ghi theo giờ thật ⇒ mốc nằm trước hôm nay thì mọi
 * thành viên thành NOT_EMPLOYED ở "hôm nay" của mốc. Vì vậy mốc = THỨ trong tuần + GIỜ cố định, ngày là lần đầu
 * tiên thứ đó xuất hiện từ hôm nay + 2 ngày ⇒ kỳ vọng tất định (thứ Ba 10:00 = ngày làm việc, trong ca) mà mốc
 * luôn ở tương lai gần.
 */

const VN_OFFSET_MS = 7 * 3_600_000; // Asia/Ho_Chi_Minh, không DST
const DAY_MS = 86_400_000;

/** 0 = Chủ nhật … 6 = thứ Bảy (getUTCDay của ngày VN). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Mốc ISO (UTC) = `weekday` đầu tiên từ (hôm nay VN + 2 ngày), lúc `hms` (HH:mm:ss) giờ VN. */
export function nextVnAnchor(weekday: Weekday, hms: string, from: Date = new Date()): string {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
  const vnToday = new Date(from.getTime() + VN_OFFSET_MS);
  const day = new Date(
    Date.UTC(vnToday.getUTCFullYear(), vnToday.getUTCMonth(), vnToday.getUTCDate() + 2),
  );
  while (day.getUTCDay() !== weekday) day.setUTCDate(day.getUTCDate() + 1);
  return new Date(day.getTime() + ((h * 60 + m) * 60 + s) * 1000 - VN_OFFSET_MS).toISOString();
}

/** YYYY-MM-DD theo giờ VN của một thời điểm ISO. */
export const vnDateOf = (iso: string): string =>
  new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 10);

/** Cộng `days` ngày lịch vào YYYY-MM-DD. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Mốc mặc định của suite bảo mật HR: thứ Ba 10:00 VN. Ghi đè bằng `SEC_CLOCK_ANCHOR` (ISO). Mỗi file test có
 * process API riêng (`useApi`) ⇒ tính một lần mỗi file là đủ nhất quán trong file.
 */
export const SEC_CLOCK_ANCHOR = process.env.SEC_CLOCK_ANCHOR ?? nextVnAnchor(2, '10:00:00');

/** Số ngày của tháng `month` (1..12) năm `year` — tháng 2 theo năm nhuận (hạn E của ADR-131). */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Offset (ms) của múi giờ IANA `tz` tại thời điểm `utcMs` (dương = trước UTC). */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** YYYY-MM-DD theo múi `tz` của một thời điểm ISO (`vnDateOf` cho lịch khác VN, vd `Europe/Berlin`). */
export const dateInTz = (iso: string, tz: string): string => {
  const ms = Date.parse(iso);
  return new Date(ms + tzOffsetMs(tz, ms)).toISOString().slice(0, 10);
};

/** Giờ địa phương `date` + `hms` ở múi `tz` ⇒ ISO UTC. Giờ rơi vào khe đổi giờ (không tồn tại) ⇒ ném lỗi. */
export function localToIso(date: string, hms: string, tz = 'Asia/Ho_Chi_Minh'): string {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
  const wall = Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) * 60 + s) * 1000;
  let utc = wall - tzOffsetMs(tz, wall);
  utc = wall - tzOffsetMs(tz, utc);
  if (utc + tzOffsetMs(tz, utc) !== wall) throw new Error(`${date} ${hms} không tồn tại ở ${tz}`);
  return new Date(utc).toISOString();
}

/**
 * Mốc theo NGÀY (test-spec-company §1.4, test-spec-hr-extended §1.1): lần đầu tiên ngày `day` xuất hiện từ (hôm nay
 * theo `tz` + 2 ngày — như `nextVnAnchor`, để `joinedAt` giờ thật luôn trước mốc), lúc `hms` giờ địa phương.
 *
 * `day`: `'MM-DD'` (vd `'12-31'`, `'02-29'` ⇒ năm nhuận kế tiếp) · `'*-DD'` (ngày DD của tháng bất kỳ, vd `'*-01'`
 * đầu tháng) · `'MM-L'` / `'*-L'` (ngày cuối tháng — hạn E của cộng dồn phép).
 */
export function nextVnDateAnchor(
  day: string,
  hms: string,
  opts: { tz?: string; from?: Date } = {},
): string {
  const tz = opts.tz ?? 'Asia/Ho_Chi_Minh';
  const match = /^(\*|0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]|L)$/.exec(day);
  if (!match) throw new Error(`day phải là 'MM-DD' | '*-DD' | 'MM-L' | '*-L', nhận '${day}'`);
  const [, mm = '*', dd = 'L'] = match;
  const start = addDays(dateInTz((opts.from ?? new Date()).toISOString(), tz), 2);
  let cursor = start;
  // ≤ 8 năm lịch: đủ cho 02-29 (chu kỳ nhuận dài nhất 8 năm quanh 2100).
  for (let i = 0; i < 8 * 366; i += 1) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const dom = Number(cursor.slice(8, 10));
    const wantDom = dd === 'L' ? daysInMonth(year, month) : Number(dd);
    if ((mm === '*' || Number(mm) === month) && dom === wantDom) return localToIso(cursor, hms, tz);
    cursor = addDays(cursor, 1);
  }
  throw new Error(`không tìm được ngày ${day} trong 8 năm kể từ ${start}`);
}
