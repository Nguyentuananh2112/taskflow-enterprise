// Giờ hiển thị theo MÚI GIỜ CỦA LỊCH (không theo máy người dùng — attendance-leave.md §6, ADR-120).
// Chỉ dùng Intl (không thêm thư viện ngày).

const hm = (timeZone: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

/** 'YYYY-MM-DD' của thời điểm `iso` theo `timeZone`. */
export function dateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** "08:05"; lượt ra sau 00:00 vẫn thuộc `workDate` hôm trước ⇒ "00:30 (+1)". */
export function timeOfDay(iso: string, timeZone: string, workDate?: string): string {
  const text = hm(timeZone).format(new Date(iso));
  if (!workDate) return text;
  const day = dateIn(iso, timeZone);
  if (day === workDate) return text;
  const diff = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000,
  );
  return `${text} (${diff > 0 ? '+' : ''}${diff})`;
}

/** Phút trong ngày ⇒ "08:00" (ca làm từ lịch). */
export function minutesToClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 125 ⇒ "2 giờ 5 phút"; 45 ⇒ "45 phút". */
export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} phút`;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
}

/** Đồng hồ theo server: độ lệch = serverNow − giờ máy lúc nhận response. */
export function serverOffsetMs(serverNow: string, receivedAtMs: number): number {
  return Date.parse(serverNow) - receivedAtMs;
}

/** '2026-10' ± n tháng. */
export function shiftMonth(month: string, delta: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' ⇒ "T5, 15/10" (ngày lịch, không phụ thuộc múi giờ). */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${date}T00:00:00Z`));
}
