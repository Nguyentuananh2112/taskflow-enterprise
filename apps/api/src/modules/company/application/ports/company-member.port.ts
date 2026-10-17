import type { LocalDate } from '../../../../core/domain/local-time';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import type { CompanyRole } from '../../domain/roles';

/** Đọc `company_members` (một dòng / user — ADR-133). Gọi TRONG transaction khi cần khóa. */
export interface ICompanyMemberRepository {
  find(userId: string): Promise<CompanyMemberSnapshot | null>;
  /** Khóa dòng `FOR SHARE` rồi đọc (B-H3): đổi role / grant / cho nghỉ song song phải chờ ta commit. */
  findForShare(userId: string): Promise<CompanyMemberSnapshot | null>;
}

/** Một nhiệm kỳ EMPLOYEE theo NGÀY (ADR-133, A C1): `until = null` ⇒ đang làm. */
export interface CompanyTenure {
  userId: string;
  from: LocalDate;
  until: LocalDate | null;
}

export interface CompanyTenureQuery {
  /** Bỏ ⇒ mọi người có nhiệm kỳ giao khoảng (gồm người đã nghỉ); `[]` ⇒ `[]`. */
  userIds?: readonly string[] | undefined;
  /** Bao gồm cả hai đầu (ngày công `YYYY-MM-DD`). */
  from: LocalDate;
  to: LocalDate;
}

/**
 * `ICompanyTenurePort` của attendance / leave (ADR-136): nhiệm kỳ EMPLOYEE giao `[from, to]` —
 * `tenure.from ≤ to` VÀ (`until` null HOẶC `until ≥ from`). Gồm nhiệm kỳ hiện tại (`company_members.role =
 * EMPLOYEE`) + đã đóng (`company_member_departures`, cả `ROLE_CHANGED`). Sắp theo `userId` rồi `from`.
 */
export interface ICompanyTenureReader {
  tenuresOf(query: CompanyTenureQuery): Promise<CompanyTenure[]>;
}

/** Người gọi đã đọc lại sau khóa — dùng cho audit / luật self. */
export interface CompanyActor {
  userId: string;
  role: CompanyRole;
  grants: readonly CompanyMemberSnapshot['grants'][number][];
}
