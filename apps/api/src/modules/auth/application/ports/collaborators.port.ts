// Port do module auth ĐỊNH NGHĨA, module khác HIỆN THỰC, wire ở composition root (ADR-093).

/** Khớp cấu trúc `MeCompanyDto` (contracts) — phần `company` của `GET /auth/me`. */
export interface MeCompanyView {
  name: string | null;
  role: 'ADMIN' | 'EMPLOYEE';
  grants: ('HR_MANAGE' | 'PAYROLL_MANAGE')[];
  permissions: string[];
  status: 'ACTIVE' | 'OFFBOARDING';
  offboardLastDay: string | null;
}

/**
 * Tư cách công ty (Mốc 3.5, ADR-133/137) — module company hiện thực, đọc DB mỗi lần (không cache). "Hoạt động"
 * = còn dòng `company_members` VÀ chưa tới `access_until` (B HIGH-2: cùng điều kiện ở mọi cửa).
 */
export interface ICompanySessionGate {
  isActive(userId: string): Promise<boolean>;
  /** `null` ⇔ `isActive` false. */
  meOf(userId: string): Promise<MeCompanyView | null>;
  /** null khi chưa có dòng `companies` (chưa bootstrap). */
  companyName(): Promise<string | null>;
}

export interface MembershipView {
  workspaceId: string;
  workspaceName: string;
  slug: string;
  role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';
}

/** `GET /auth/me`: membership của user, đã loại workspace xóa mềm (ADR-047). Module Workspace hiện thực. */
export interface IMembershipReader {
  listForUser(userId: string): Promise<MembershipView[]>;
}

/** Ngắt socket (security.md 5.4). Gateway Socket.io hiện thực ở Phase 3; chỉ gọi SAU commit. */
export interface IAuthRealtimeNotifier {
  disconnectSession(sid: string): Promise<void>;
  disconnectUser(userId: string): Promise<void>;
}
