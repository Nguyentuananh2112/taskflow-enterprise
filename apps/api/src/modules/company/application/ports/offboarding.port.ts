import type { LocalDate } from '../../../../core/domain/local-time';
import type { CompanyMemberSnapshot } from '../../domain/company-member';

/** Nhiệm kỳ đã đóng gần nhất của một người không còn dòng `company_members` (trạng thái LEFT). */
export interface DepartedEmployee {
  userId: string;
  firstDay: LocalDate;
  lastDay: LocalDate;
}

/**
 * Vòng đời nghỉ việc (T-062, ADR-137) trên `company_members` / `company_member_departures`. Gọi TRONG transaction của
 * bên gọi; mọi mốc thời gian là tham số từ đồng hồ ứng dụng (KHÔNG `now()` của DB — D review MEDIUM-2).
 */
export interface ICompanyOffboardingRepository {
  /** Đặt / đổi lịch nghỉ, `version + 1`. `null` ⇒ không còn dòng. */
  schedule(input: {
    userId: string;
    lastDay: LocalDate;
    accessUntil: Date;
    scheduledById: string;
    at: Date;
  }): Promise<CompanyMemberSnapshot | null>;
  /** Hủy lịch nghỉ, `version + 1`, có điều kiện ĐANG có lịch. `null` ⇒ không có lịch / không còn dòng. */
  cancel(userId: string, at: Date): Promise<CompanyMemberSnapshot | null>;
  /**
   * `DELETE … WHERE user_id = $1 AND offboard_access_until <= $now RETURNING …` — đếm 1 mới đi tiếp (request ‖ job ⇒
   * đúng một departure — F). `null` ⇒ chưa tới hạn / đã được người khác hoàn tất.
   */
  deleteIfDue(userId: string, now: Date): Promise<CompanyMemberSnapshot | null>;
  /** Người tới hạn hoàn tất (`offboard_access_until <= now`), cũ nhất trước — job mỗi phút. */
  listDue(now: Date, limit: number): Promise<string[]>;
  /** Dòng EMPLOYEE hiện có (danh sách nhân viên — Admin không phải nhân viên, ADR-134). */
  listEmployees(): Promise<CompanyMemberSnapshot[]>;
  /** Dòng của đúng các user này (mọi role) — response lên / hủy lịch. */
  listMembersByIds(userIds: readonly string[]): Promise<CompanyMemberSnapshot[]>;
  /** Người đã rời (có departure, không còn dòng) — nhiệm kỳ cuối của mỗi người. */
  listDeparted(): Promise<DepartedEmployee[]>;
}
