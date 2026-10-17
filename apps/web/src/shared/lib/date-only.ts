// Ngày dạng `YYYY-MM-DD` (dueDate — data-and-api R4). KHÔNG `new Date('YYYY-MM-DD')`: chuỗi đó bị
// hiểu là UTC nửa đêm ⇒ lệch một ngày ở múi giờ âm. So quá hạn bằng so sánh chuỗi với "hôm nay"
// theo giờ địa phương của người dùng (frontend.md §6.2).

import { serverClock } from './server-clock';

const pad = (n: number) => String(n).padStart(2, '0');

/** Hôm nay theo giờ địa phương, dạng `YYYY-MM-DD`. */
export function todayDateOnly(now: Date = new Date(serverClock.now())): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Quá hạn = hạn chót trước hôm nay (ngày hôm nay chưa tính là quá hạn). */
export function isOverdue(
  dueDate: string | null,
  now: Date = new Date(serverClock.now()),
): boolean {
  return dueDate !== null && dueDate < todayDateOnly(now);
}

/** `2026-10-15` ⇒ `15/10/2026` (định dạng vi-VN, không qua Date để khỏi lệch múi giờ). */
export function formatDateOnly(dueDate: string): string {
  const [year, month, day] = dueDate.split('-');
  return `${day}/${month}/${year}`;
}
