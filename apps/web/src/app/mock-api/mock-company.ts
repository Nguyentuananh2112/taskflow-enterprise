import {
  effectiveCompanyPermissions,
  type CompanyGrant,
  type CompanyRole,
  type MeCompanyDto,
} from '@taskflow/contracts/company';

// Mốc 3.5 (ADR-133): MỘT công ty — dòng `company_members` có ⇔ đang thuộc công ty. Mock giữ vai trò, quyền cấp thêm,
// đầu nhiệm kỳ, lịch nghỉ việc; KHÔNG phải mã phân quyền thật (server tính `permissions`, web chỉ đọc).

type Row = {
  role: CompanyRole;
  /** Đầu nhiệm kỳ (ISO) — ngày trước đó là NOT_EMPLOYED ở bảng công. */
  joinedAt: string;
  grants: CompanyGrant[];
  offboardLastDay: string | null;
};

export class MockCompany {
  name = 'Công ty Mẫu';
  private readonly rows = new Map<string, Row>();

  /** Mọi tài khoản mock vào công ty là nhân viên (như backfill migration 5); test đổi bằng `setAccess`. */
  add(userId: string, joinedAt: string): void {
    this.rows.set(userId, { role: 'EMPLOYEE', joinedAt, grants: [], offboardLastDay: null });
  }

  /** Đổi vai trò / quyền cấp thêm (như `PUT admin/access/:userId`); ADMIN ⇒ grants rỗng (ADR-134). */
  setAccess(userId: string, role: CompanyRole, grants: CompanyGrant[] = []): void {
    const row = this.rows.get(userId);
    if (row) Object.assign(row, { role, grants: role === 'ADMIN' ? [] : grants });
  }

  setOffboarding(userId: string, lastDay: string | null): void {
    const row = this.rows.get(userId);
    if (row) row.offboardLastDay = lastDay;
  }

  /** Khối `company` của `/auth/me`; undefined = không thuộc công ty (⇒ 401 SESSION_REVOKED). */
  of(userId: string): MeCompanyDto | undefined {
    const row = this.rows.get(userId);
    if (!row) return undefined;
    return {
      name: this.name,
      role: row.role,
      grants: [...row.grants],
      permissions: [...effectiveCompanyPermissions(row.role, row.grants)],
      status: row.offboardLastDay ? 'OFFBOARDING' : 'ACTIVE',
      offboardLastDay: row.offboardLastDay,
    };
  }

  /** Nhân viên hiện tại (role EMPLOYEE — Admin không chấm công, ADR-134), theo thứ tự vào. */
  employees(): Array<{ userId: string; joinedAt: string }> {
    return [...this.rows].flatMap(([userId, row]) =>
      row.role === 'EMPLOYEE' ? [{ userId, joinedAt: row.joinedAt }] : [],
    );
  }

  /** Đầu nhiệm kỳ nhân viên (undefined: không phải nhân viên hiện tại). */
  joinedAt(userId: string): string | undefined {
    const row = this.rows.get(userId);
    return row?.role === 'EMPLOYEE' ? row.joinedAt : undefined;
  }
}
