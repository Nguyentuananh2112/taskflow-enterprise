import type { LocalDate } from './local-time';

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Thâm niên (năm + tháng tròn) từ `hireDate` tới `today` — hàm ngày THUẦN (không múi giờ), dùng chung cho danh sách
 * nhân viên / hồ sơ (T-054) và lương (ADR-125). Tháng tròn: ngày hiện tại chưa tới "ngày kỷ niệm" của tháng thì chưa
 * tính (ngày kỷ niệm kẹp vào ngày cuối tháng khi tháng ngắn hơn — vào 31/01 ⇒ đủ 1 tháng vào 28/02 hoặc 29/02).
 * `hireDate` sau `today` ⇒ 0 năm 0 tháng.
 */
export function seniorityOf(
  hireDate: LocalDate,
  today: LocalDate,
): { years: number; months: number } {
  if (hireDate > today) return { years: 0, months: 0 };
  const [hy, hm, hd] = hireDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let months = (ty - hy) * 12 + (tm - hm);
  if (td < Math.min(hd, daysInMonth(ty, tm))) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}
