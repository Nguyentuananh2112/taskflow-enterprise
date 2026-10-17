import type { LocalDate } from '../../../../core/domain/local-time';

/**
 * Dọn đơn nghỉ khi một nhiệm kỳ EMPLOYEE đóng (nghỉ việc — T-062; nâng lên Admin — T-061a): HÀNH ĐỘNG HỆ THỐNG của leave
 * (`EmploymentLeaveHooks.offboardCleanup`, D T-064) — mọi PENDING ⇒ CANCELLED, APPROVED bắt đầu sau `lastDay` ⇒ REVOKED,
 * vắt qua giữ. Company sở hữu port, adapter ở leave, nối ở composition.
 *
 * Gọi TRONG transaction của bên gọi, SAU `members.lockEmployeeWork(userId)` (bậc 3 ADR-136 — D HIGH-1) và TRƯỚC khi
 * UPDATE / DELETE dòng `company_members` của người đó.
 */
export interface IOffboardLeavePort {
  offboardCleanup(input: {
    userId: string;
    lastDay: LocalDate;
    actorId: string;
  }): Promise<{ cancelled: number; revoked: number }>;
}
