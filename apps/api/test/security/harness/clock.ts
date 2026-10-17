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
