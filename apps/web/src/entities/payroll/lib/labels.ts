import type { TodoDto } from '@/shared/api/pending-contracts/payroll';

/** "9/2026" (tháng không số 0 đầu) — dùng cho title tab: "Phiếu lương tháng 9/2026". */
export const monthLabel = (period: string) => `${Number(period.slice(5, 7))}/${period.slice(0, 4)}`;

/** "Tháng 09 năm 2026" — dòng dưới đầu phiếu theo mẫu. */
export const sheetMonth = (period: string) =>
  `Tháng ${period.slice(5, 7)} năm ${period.slice(0, 4)}`;

/** Kỳ YYYY-MM liền trước / sau. */
export function shiftPeriod(period: string, by: number): string {
  const [y = 0, m = 1] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Công "21,5 / 22 ngày" từ nửa ngày. */
export const workDays = (halfDays: number, standardDays: number) =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(halfDays / 2)} / ${standardDays} ngày`;

const dm = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const who = (t: TodoDto) => t.user?.fullName ?? '';

/** Việc còn lại trên đầu bảng tháng (§5.2) bằng lời thường. */
export function todoText(t: TodoDto): string {
  switch (t.kind) {
    case 'MISSING_SALARY_PROFILE':
      return `${who(t)}: chưa có hồ sơ lương`;
    case 'MISSING_HIRE_DATE':
      return `${who(t)}: thiếu ngày vào công ty`;
    case 'HIRE_DATE_AFTER_PERIOD':
      return `${who(t)}: ngày vào công ty sau kỳ lương`;
    case 'HIRE_DATE_CHANGED':
      return `${who(t)}: ngày vào công ty đã đổi — tính lại`;
    case 'SENIORITY_RATE_CHANGED':
      return 'Mức thâm niên đã đổi — tính lại';
    case 'MISSING_OUT':
      return `${who(t)}: ngày ${dm(t.date)} quên chấm ra (chưa tính công)`;
    case 'NEGATIVE_NET_PAY':
      return `${who(t)}: thực lĩnh âm`;
    case 'ATTENDANCE_CHANGED_AFTER_PUBLISH':
      return `${who(t)}: công đã thay đổi sau phát hành`;
    case 'PROFILE_CHANGED_AFTER_PUBLISH':
      return `${who(t)}: hồ sơ đã thay đổi sau phát hành`;
  }
}

/** Việc chặn phát hành (khác cảnh báo). */
export const BLOCKING: ReadonlySet<TodoDto['kind']> = new Set([
  'MISSING_SALARY_PROFILE',
  'MISSING_HIRE_DATE',
  'HIRE_DATE_AFTER_PERIOD',
  'NEGATIVE_NET_PAY',
]);
