import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';

const detail = (error: unknown, key: 'rule' | 'reason') =>
  isApiError(error) && typeof error.details === 'object' && error.details !== null
    ? (error.details as Record<string, unknown>)[key]
    : undefined;

const BY_RULE: Readonly<Record<string, string>> = {
  START_DATE_OUT_OF_RANGE: 'Ngày vào làm phải trong 31 ngày qua và không sau hôm nay.',
  LAST_DAY_OUT_OF_RANGE: 'Ngày làm cuối phải trong khoảng 31 ngày trước đến 90 ngày tới.',
  EMAIL_UNAVAILABLE: 'Email này thuộc một tài khoản đã xóa — dùng email khác.',
  ALREADY_ACTIVATED: 'Người này đã kích hoạt tài khoản — không cần link nữa.',
};
const BY_REASON: Readonly<Record<string, string>> = {
  already_employee: 'Email này đang là nhân viên của công ty.',
};

/** Câu lỗi bằng lời thường cho thao tác nhân viên (không mã kỹ thuật). */
export function employeeErrorMessage(error: unknown): string {
  const rule = detail(error, 'rule');
  const reason = detail(error, 'reason');
  if (typeof rule === 'string' && BY_RULE[rule]) return BY_RULE[rule];
  if (typeof reason === 'string' && BY_REASON[reason]) return BY_REASON[reason];
  if (isApiError(error, 'FORBIDDEN_ACCESS')) {
    return 'Việc này chỉ Quản trị viên làm được (chính bạn, hoặc người giữ quyền Nhân sự / Kế toán).';
  }
  return serverErrorMessage(error);
}

/** "dd/mm/yyyy" từ ngày `YYYY-MM-DD`. */
export const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Ngày `YYYY-MM-DD` cộng `days` (theo lịch, không theo múi giờ máy). */
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
