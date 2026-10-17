import { addDays, instantOf, type LocalDate } from '../../../core/domain/local-time';
import type { CompanyGrant, CompanyRole } from './roles';

/** Giờ chốt ngày công (attendance A#7): hết quyền lúc 06:00 ngày SAU ngày làm cuối. */
export const ACCESS_CUTOFF_MIN = 6 * 60;

/** Dòng `company_members` — tồn tại ⇔ đang thuộc công ty (ADR-133). */
export interface CompanyMemberSnapshot {
  userId: string;
  role: CompanyRole;
  grants: CompanyGrant[];
  /** Ngày đầu nhiệm kỳ EMPLOYEE hiện tại; null với ADMIN. */
  startDate: LocalDate | null;
  offboardLastDay: LocalDate | null;
  offboardAccessUntil: Date | null;
  offboardScheduledById: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Thời điểm hết quyền của người có ngày làm cuối `lastDay` theo múi giờ lịch công ty (ADR-135). */
export function accessUntilOf(lastDay: LocalDate, timeZone: string): Date {
  return instantOf(addDays(lastDay, 1), ACCESS_CUTOFF_MIN, timeZone);
}

/**
 * Còn quyền vào hệ thống lúc `now`: chưa có lịch nghỉ, hoặc chưa tới `access_until`. Mọi cửa (HTTP công ty,
 * `loadMembership` workspace, `/auth/refresh`, socket) áp ĐÚNG hàm / điều kiện này (B HIGH-2).
 */
export function isCompanyAccessActive(
  member: Pick<CompanyMemberSnapshot, 'offboardAccessUntil'>,
  now: Date,
): boolean {
  return (
    member.offboardAccessUntil === null || now.getTime() < member.offboardAccessUntil.getTime()
  );
}

export type EmployeeStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'OFFBOARDING' | 'LEFT';

/**
 * Trạng thái hiển thị — SUY RA, không lưu (ADR-133): không còn dòng ⇒ LEFT; chưa có mật khẩu ⇒ chờ kích hoạt;
 * có lịch nghỉ ⇒ OFFBOARDING; còn lại ACTIVE. `null` = chưa từng thuộc công ty.
 */
export function employeeStatusOf(input: {
  member: Pick<CompanyMemberSnapshot, 'offboardLastDay'> | null;
  hasPassword: boolean;
  hasDeparture: boolean;
}): EmployeeStatus | null {
  if (!input.member) return input.hasDeparture ? 'LEFT' : null;
  if (!input.hasPassword) return 'PENDING_ACTIVATION';
  return input.member.offboardLastDay === null ? 'ACTIVE' : 'OFFBOARDING';
}
