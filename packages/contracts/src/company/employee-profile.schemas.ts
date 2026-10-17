import * as z from 'zod';

import { DateOnly, singleLineText, Uuid } from '../common';
import { EmployeeStatus } from './company-roles';

// Mốc 5 — hồ sơ nhân viên tối giản (docs/design/hr-extended.md ADR-128, T-054). Cấp CÔNG TY: một dòng / user, không
// phiên bản, nguồn DUY NHẤT của `hireDate` (lương + phép). KHÔNG lưu CCCD, địa chỉ, ngày sinh, SĐT/email cá nhân.

/** Cận dưới cố định; cận trên = hôm nay theo giờ nghiệp vụ (server kiểm — CHECK của DB không dùng now()). */
export const HIRE_DATE_MIN = '1950-01-01';

export const HireDate = DateOnly.refine((d) => d >= HIRE_DATE_MIN, {
  error: `Ngày vào công ty không trước ${HIRE_DATE_MIN}`,
});

/** Phòng ban / chức vụ: trim, 1..100, không ký tự điều khiển. */
export const ProfileText = singleLineText(1, 100);

/**
 * SĐT công việc: bỏ khoảng trắng, `.`, `-`, `(`, `)` rồi chỉ còn `+` (đầu) và 8..15 chữ số — khớp CHECK
 * `^\+?[0-9]{8,15}$` của migration 6. Ký tự khác ⇒ 400.
 */
export const WorkPhone = z
  .string()
  .trim()
  .max(32)
  .transform((s) => s.replace(/[\s.()-]/g, ''))
  .pipe(z.string().regex(/^\+?[0-9]{8,15}$/, 'Số điện thoại 8–15 chữ số, có thể bắt đầu bằng +'));

/** Bốn trường hồ sơ — `null` = xóa giá trị, bỏ qua = giữ nguyên. */
export const EmployeeProfileFields = {
  hireDate: HireDate.nullable().optional(),
  department: ProfileText.nullable().optional(),
  jobTitle: ProfileText.nullable().optional(),
  workPhone: WorkPhone.nullable().optional(),
};

/** Thâm niên tính tới hôm nay (giờ nghiệp vụ) từ `hireDate`; null khi chưa có `hireDate`. */
export const SeniorityDto = z.object({
  years: z.int().min(0),
  months: z.int().min(0).max(11),
});
export type SeniorityDto = z.infer<typeof SeniorityDto>;

/**
 * `GET hr/employee-profiles/:userId` · `/me` · response PUT. Danh sách nằm ở `GET hr/employees` (EmployeeDto có các
 * trường hồ sơ phẳng, KHÔNG có `workPhone` — TL chốt 17/10).
 */
export const EmployeeProfileDto = z.object({
  userId: Uuid,
  fullName: z.string(),
  status: EmployeeStatus,
  hireDate: DateOnly.nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  workPhone: z.string().nullable(),
  /** 0 = chưa có hồ sơ (PUT tạo với `expectedVersion: 0`). */
  version: z.int().min(0),
  seniority: SeniorityDto.nullable(),
  missingHireDate: z.boolean(),
});
export type EmployeeProfileDto = z.infer<typeof EmployeeProfileDto>;

/** `GET hr/employee-profiles/departments` — gợi ý đã dùng trong công ty (sắp theo chữ cái, không trùng). */
export const ProfileSuggestionsDto = z.object({
  departments: z.array(z.string()),
  jobTitles: z.array(z.string()),
});
export type ProfileSuggestionsDto = z.infer<typeof ProfileSuggestionsDto>;

export const EmployeeProfileParams = z.object({ userId: Uuid });
export type EmployeeProfileParams = z.infer<typeof EmployeeProfileParams>;

/**
 * `PUT hr/employee-profiles/:userId` — strict (trường lạ như `userId`, `version`, `updatedById` ⇒ 400). Đổi
 * `hireDate` ĐÃ CÓ ⇒ `reason` bắt buộc (422 REASON_REQUIRED); lý do vào `after.note` của audit.
 */
export const PutEmployeeProfileBody = z.strictObject({
  ...EmployeeProfileFields,
  /** `0` khi tạo hồ sơ lần đầu; lệch ⇒ 409 VERSION_CONFLICT. */
  expectedVersion: z.int().min(0),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type PutEmployeeProfileBody = z.infer<typeof PutEmployeeProfileBody>;

/**
 * Phép năm bị âm do đổi `hireDate` (T-057 nối; rỗng tới khi đó). Cùng tên/đơn vị với `negativeBalances` của
 * PUT leave/policy (`remainingDays`).
 */
export const NegativeBalanceDto = z.object({ year: z.int(), remainingDays: z.number() });
export type NegativeBalanceDto = z.infer<typeof NegativeBalanceDto>;

export const ProfileWarning = z.enum(['ADJUSTMENT_DAYS_REVIEW']);
export type ProfileWarning = z.infer<typeof ProfileWarning>;

export const PutEmployeeProfileResponse = z.object({
  profile: EmployeeProfileDto,
  negativeBalances: z.array(NegativeBalanceDto),
  warnings: z.array(ProfileWarning),
});
export type PutEmployeeProfileResponse = z.infer<typeof PutEmployeeProfileResponse>;
