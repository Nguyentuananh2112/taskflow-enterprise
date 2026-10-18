import type { LocalDate } from '../../../../core/domain/local-time';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import type { CompanyRole } from '../../domain/roles';

/** Đọc `company_members` (một dòng / user — ADR-133). Gọi TRONG transaction khi cần khóa. */
export interface ICompanyMemberRepository {
  find(userId: string): Promise<CompanyMemberSnapshot | null>;
  /** Khóa dòng `FOR SHARE` rồi đọc (B-H3): đổi role / grant / cho nghỉ song song phải chờ ta commit. */
  findForShare(userId: string): Promise<CompanyMemberSnapshot | null>;
  /** Admin + nhân viên có grant HR_MANAGE (lọc `access_until` ở application) — người nhận thông báo nhóm HR. */
  listHrManagerCandidates(): Promise<CompanyMemberSnapshot[]>;
  /** Thêm dòng (version 1). Đã có dòng của user ⇒ 409 `ResourceConflictError('already_employee')`. */
  insert(input: NewCompanyMember): Promise<CompanyMemberSnapshot>;
  /** Có ít nhất một ADMIN (bootstrap từ chối khi đã có — SEC-HR-64). */
  hasAdmin(): Promise<boolean>;
  listAdmins(): Promise<CompanyMemberSnapshot[]>;
  /** `pg_advisory_xact_lock('taskflow:company:admins')` — bậc 2 bảng khóa ADR-136 (đổi tập Admin). */
  lockAdmins(): Promise<void>;
  /**
   * `taskflow:leave:<user>` RỒI `taskflow:attendance:punch:<user>` (bậc 3, D review HIGH-1) — PHẢI lấy trước khi
   * DELETE / UPDATE dòng `company_members` của người đó (hoàn tất nghỉ việc, nâng EMPLOYEE→ADMIN).
   */
  lockEmployeeWork(userId: string): Promise<void>;
  /**
   * EMPLOYEE → ADMIN: `role = ADMIN`, bỏ grants / `start_date`, `version + 1` — có điều kiện vẫn là EMPLOYEE.
   * `null` ⇒ không còn dòng / không còn là EMPLOYEE.
   */
  promoteToAdmin(userId: string, at: Date): Promise<CompanyMemberSnapshot | null>;
  /** Mọi thành viên hiện tại (Admin + nhân viên), sắp theo `userId` — danh sách quyền của Admin (T-061a). */
  listAll(): Promise<CompanyMemberSnapshot[]>;
  /** Đổi grants của EMPLOYEE, `version + 1` — có điều kiện vẫn là EMPLOYEE; `null` ⇒ không còn / không phải EMPLOYEE. */
  setGrants(
    userId: string,
    grants: CompanyMemberSnapshot['grants'],
    at: Date,
  ): Promise<CompanyMemberSnapshot | null>;
  /**
   * ADMIN → EMPLOYEE (T-061a, CO-09): `role = EMPLOYEE`, `start_date` = nhiệm kỳ MỚI, grants mới, `version + 1` — có
   * điều kiện vẫn là ADMIN; `null` ⇒ không còn / không phải ADMIN.
   */
  demoteToEmployee(
    userId: string,
    input: { startDate: LocalDate; grants: CompanyMemberSnapshot['grants']; at: Date },
  ): Promise<CompanyMemberSnapshot | null>;
  /** Đóng một nhiệm kỳ (`company_member_departures`) — CÙNG transaction với thay đổi dòng. */
  recordDeparture(d: {
    id: string;
    userId: string;
    role: CompanyRole;
    firstDay: LocalDate;
    lastDay: LocalDate;
    leftAt: Date;
    reason: 'OFFBOARDED' | 'ROLE_CHANGED';
  }): Promise<void>;
}

export interface NewCompanyMember {
  userId: string;
  role: CompanyRole;
  grants: CompanyMemberSnapshot['grants'];
  /** EMPLOYEE ⇔ khác null (CHECK). */
  startDate: LocalDate | null;
  at: Date;
}

/** Dòng `companies` (một dòng, id = 1 — ADR-133). */
export interface CompanyProfile {
  name: string;
  version: number;
  /** T-075: đầu mối liên hệ về dữ liệu cá nhân (chữ tự do ≤ 200); null = chưa đặt. */
  privacyContact: string | null;
}

/** Đọc `companies`; `null` khi DB vừa migrate, chưa `admin:bootstrap`. */
export interface ICompanyRepository {
  get(): Promise<CompanyProfile | null>;
  /** Tạo dòng `companies` nếu chưa có (bootstrap); đã có ⇒ giữ nguyên tên cũ. */
  ensure(name: string, at: Date): Promise<CompanyProfile>;
  /**
   * Đổi tên và / hoặc đầu mối liên hệ khi `version` khớp (ADR-010) ⇒ bản mới (`version + 1`); lệch / chưa có dòng ⇒
   * `null`. Trường `undefined` ⇒ giữ nguyên; `privacyContact: null` ⇒ xóa.
   */
  update(input: {
    name?: string | undefined;
    privacyContact?: string | null | undefined;
    expectedVersion: number;
    at: Date;
  }): Promise<CompanyProfile | null>;
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
