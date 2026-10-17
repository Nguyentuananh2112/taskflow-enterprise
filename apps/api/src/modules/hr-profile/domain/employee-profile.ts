import type { LocalDate } from '../../../core/domain/local-time';
import { seniorityOf } from '../../../core/domain/seniority';

/** Bốn trường hồ sơ (ADR-128) — `null` = chưa có / đã xóa. */
export interface ProfileFields {
  hireDate: LocalDate | null;
  department: string | null;
  jobTitle: string | null;
  workPhone: string | null;
}

/** Bản vá từ request: bỏ qua (`undefined`) = giữ nguyên, `null` = xóa. */
export type ProfilePatch = { [K in keyof ProfileFields]?: ProfileFields[K] | null | undefined };

/** Một dòng `employee_profiles` (PK `user_id`, không phiên bản lịch sử — chỉ `version` khóa lạc quan). */
export interface EmployeeProfileSnapshot extends ProfileFields {
  userId: string;
  /** ≥ 1 khi đã có dòng; "chưa có hồ sơ" biểu diễn bằng `null` ở port, `version 0` ở DTO. */
  version: number;
  updatedById: string;
  updatedAt: Date;
}

export const EMPTY_PROFILE: ProfileFields = Object.freeze({
  hireDate: null,
  department: null,
  jobTitle: null,
  workPhone: null,
});

const PROFILE_KEYS = ['hireDate', 'department', 'jobTitle', 'workPhone'] as const;

export function fieldsOf(p: ProfileFields | null): ProfileFields {
  return p
    ? {
        hireDate: p.hireDate,
        department: p.department,
        jobTitle: p.jobTitle,
        workPhone: p.workPhone,
      }
    : { ...EMPTY_PROFILE };
}

export function applyPatch(current: ProfileFields | null, patch: ProfilePatch): ProfileFields {
  const next = fieldsOf(current);
  for (const key of PROFILE_KEYS) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

export const hasPatch = (patch: ProfilePatch) => PROFILE_KEYS.some((k) => patch[k] !== undefined);

export const sameFields = (a: ProfileFields, b: ProfileFields) =>
  PROFILE_KEYS.every((k) => a[k] === b[k]);

/**
 * Giá trị audit `PROFILE_SET` (ADR-128): KHÔNG có `workPhone` (dữ liệu liên lạc — chỉ cờ `workPhoneChanged` ở
 * `after`); lý do để ở khóa `note` (bước D7' của retention xóa được), không bao giờ khóa `reason`.
 */
export function profileAuditView(p: ProfileFields): Record<string, string | null> {
  return { hireDate: p.hireDate, department: p.department, jobTitle: p.jobTitle };
}

/** Thâm niên theo "hôm nay" của giờ nghiệp vụ; `null` khi chưa có `hireDate`. */
export function seniorityFor(
  hireDate: LocalDate | null,
  today: LocalDate,
): { years: number; months: number } | null {
  return hireDate ? seniorityOf(hireDate, today) : null;
}
