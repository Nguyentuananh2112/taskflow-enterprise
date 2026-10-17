import type { PutEmployeeProfileBody } from '@taskflow/contracts/company';

import { isApiError } from '@/shared/api';

import { employeeErrorMessage } from './messages';

export type ProfileForm = Readonly<{
  hireDate: string;
  department: string;
  jobTitle: string;
  workPhone: string;
}>;
type Fields = Pick<PutEmployeeProfileBody, 'hireDate' | 'department' | 'jobTitle' | 'workPhone'>;

const KEYS = ['hireDate', 'department', 'jobTitle', 'workPhone'] as const;

export const EMPTY_PROFILE_FORM: ProfileForm = {
  hireDate: '',
  department: '',
  jobTitle: '',
  workPhone: '',
};

/** Giá trị server (null = trống) ⇒ ô nhập (chuỗi rỗng). */
export function profileFormOf(p: Partial<Record<keyof ProfileForm, string | null>>): ProfileForm {
  return Object.fromEntries(KEYS.map((k) => [k, p[k] ?? ''])) as ProfileForm;
}

/**
 * Chỉ gửi trường ĐÃ ĐỔI so với `before` (bỏ qua = server giữ nguyên); xóa trắng ô đang có giá trị ⇒ `null` (xóa).
 * Thêm nhân viên mới: `before` rỗng ⇒ chỉ gửi ô có nhập.
 */
export function profileChanges(form: ProfileForm, before: ProfileForm): Fields {
  const out: Fields = {};
  for (const k of KEYS) {
    const v = form[k].trim();
    if (v !== before[k]) out[k] = v === '' ? null : v;
  }
  return out;
}

const BY_RULE: Readonly<Record<string, string>> = {
  REASON_REQUIRED: 'Đổi ngày vào công ty đã có cần ghi lý do sửa.',
  HIRE_DATE_IN_FUTURE: 'Ngày vào công ty không được sau hôm nay.',
};

/** Lỗi lưu hồ sơ bằng lời thường; ô sai định dạng (SĐT, ngày) chỉ ra đúng ô. */
export function profileErrorMessage(error: unknown): string {
  if (isApiError(error, 'VERSION_CONFLICT')) {
    return 'Hồ sơ vừa được người khác sửa. Bấm "Tải bản mới" để xem rồi sửa lại.';
  }
  const d = isApiError(error) ? (error.details as Record<string, unknown> | null) : null;
  if (typeof d?.rule === 'string' && BY_RULE[d.rule]) return BY_RULE[d.rule] ?? '';
  const issues = Array.isArray(d?.issues) ? (d.issues as Array<{ path?: unknown[] }>) : [];
  if (issues.some((i) => i.path?.[0] === 'workPhone')) {
    return 'Số điện thoại công việc cần 8–15 chữ số (có thể bắt đầu bằng +).';
  }
  if (issues.some((i) => i.path?.[0] === 'hireDate')) {
    return 'Ngày vào công ty không hợp lệ (từ 01/01/1950 đến hôm nay).';
  }
  return employeeErrorMessage(error);
}
