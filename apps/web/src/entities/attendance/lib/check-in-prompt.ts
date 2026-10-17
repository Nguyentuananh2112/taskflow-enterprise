import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';

// Dialog nhắc chấm công (T-045): quyết định CHỈ theo `me/today` + giờ SERVER (không theo giờ máy).

/** Phút trong ngày của thời điểm `ms` theo `timeZone` (0–1439). */
export function minuteOfDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * Hiện khi: ngày làm, không lễ, chưa vào, không nghỉ cả ngày, không NOT_EMPLOYED, có lịch và ca CHƯA kết thúc
 * (contracts bảo đảm `startMin < endMin` ⇒ ca không qua đêm). `nowMs` = giờ server hiện tại.
 */
export function shouldPromptCheckIn(t: AttendanceTodayDto, nowMs: number): boolean {
  if (!t.isWorkday || t.isHoliday || t.firstIn !== null) return false;
  if (t.leave === 'FULL' || t.status === 'NOT_EMPLOYED' || t.schedule === null) return false;
  return minuteOfDay(nowMs, t.timezone) < t.schedule.endMin;
}

/** Lời chào theo giờ server: sáng < 11:00 ≤ trưa < 13:00 ≤ chiều < 18:00 ≤ tối. */
export function greetingAt(minute: number): string {
  if (minute < 11 * 60) return 'Chào buổi sáng';
  if (minute < 13 * 60) return 'Chào buổi trưa';
  if (minute < 18 * 60) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/**
 * Tên gọi trong lời chào: bỏ phần trong ngoặc ("Olivia (dữ liệu mẫu)" ⇒ "Olivia"), tên tiếng Việt lấy TỪ CUỐI
 * ("Nguyễn Văn An" ⇒ "An"); không còn chữ nào ⇒ `null` (lời chào không kèm tên).
 */
export function callName(fullName: string): string | null {
  const words = fullName
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.at(-1) ?? null;
}
