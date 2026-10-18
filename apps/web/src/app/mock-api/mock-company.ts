import { createHash, randomBytes } from 'node:crypto';

import {
  effectiveCompanyPermissions,
  type CompanyGrant,
  type CompanyRole,
  type MeCompanyDto,
} from '@taskflow/contracts/company';

import { MockPrivacy } from './mock-privacy';
import { MockProfiles } from './mock-profiles';

// Mốc 3.5 (ADR-133/137): MỘT công ty — dòng `company_members` có ⇔ đang thuộc công ty; nghỉ việc = xóa dòng + ghi
// departure. Mock giữ vai trò, quyền cấp thêm, nhiệm kỳ, lịch nghỉ việc, token kích hoạt (chỉ lưu SHA-256 như server);
// KHÔNG phải mã phân quyền thật (server tính `permissions`, web chỉ đọc).

type Row = {
  role: CompanyRole;
  /** Đầu nhiệm kỳ (ISO) — ngày trước đó là NOT_EMPLOYED ở bảng công. */
  joinedAt: string;
  startDate: string;
  grants: CompanyGrant[];
  offboardLastDay: string | null;
  version: number;
};
type Token = { userId: string; expiresAt: number; usedAt: number | null; revokedAt: number | null };

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export class MockCompany {
  /** Mốc 6 (ADR-142): URL avatar hiện tại (variant 64) — createMockApi nối vào MockAvatars. */
  avatarOf: (userId: string) => string | null = () => null;

  name = 'Công ty Mẫu';
  version = 1;
  /** T-075: đầu mối liên hệ về dữ liệu cá nhân; null ⇒ web hiện "quản trị viên". */
  privacyContact: string | null = null;
  /** T-075: phiên bản thông báo đã đọc + đồng ý lý do nghỉ, theo người. */
  readonly privacy = new MockPrivacy();
  private readonly rows = new Map<string, Row>();
  /** Người đã nghỉ: ngày làm cuối (departure gần nhất). */
  readonly departures = new Map<string, { lastDay: string }>();
  private readonly tokens = new Map<string, Token>();
  /** Hồ sơ nhân viên (Mốc 5, ADR-128) — sống độc lập với dòng công ty. */
  readonly profiles = new MockProfiles();

  /** Mọi tài khoản mock vào công ty là nhân viên (như backfill migration 5); test đổi bằng `setAccess`. */
  add(userId: string, joinedAt: string, startDate = joinedAt.slice(0, 10)): void {
    this.rows.set(userId, {
      role: 'EMPLOYEE',
      joinedAt,
      startDate,
      grants: [],
      offboardLastDay: null,
      version: 1,
    });
  }

  row(userId: string): Readonly<Row> | undefined {
    return this.rows.get(userId);
  }

  members(): Array<[string, Readonly<Row>]> {
    return [...this.rows];
  }

  /** Đổi vai trò / quyền cấp thêm (như `PUT admin/access/:userId`); ADMIN ⇒ grants rỗng (ADR-134). */
  setAccess(userId: string, role: CompanyRole, grants: CompanyGrant[] = []): void {
    const row = this.rows.get(userId);
    if (row)
      Object.assign(row, {
        role,
        grants: role === 'ADMIN' ? [] : grants,
        version: row.version + 1,
      });
  }

  setOffboarding(userId: string, lastDay: string | null): void {
    const row = this.rows.get(userId);
    if (row) Object.assign(row, { offboardLastDay: lastDay, version: row.version + 1 });
  }

  /** Nghỉ việc đã hoàn tất (xóa dòng + departure — ADR-133): phiên còn lại nhận 401 SESSION_REVOKED. */
  remove(userId: string): void {
    const row = this.rows.get(userId);
    this.rows.delete(userId);
    if (row) this.departures.set(userId, { lastDay: row.offboardLastDay ?? row.startDate });
    // Nghỉ việc thu hồi token kích hoạt còn sống (ADR-137 bước 5); mốc thu hồi không cần chính xác ở mock.
    for (const t of this.tokens.values()) if (t.userId === userId) t.revokedAt ??= 0;
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

  // ---------------------------------------------------------------- token kích hoạt (ADR-137)

  /** Token mới (32 byte base64url), thu hồi token còn sống của người đó NGAY; DB chỉ giữ hash. */
  issueToken(userId: string, now: number, ttlMs: number): { token: string; expiresAt: number } {
    for (const t of this.tokens.values()) {
      if (t.userId === userId && t.usedAt === null) t.revokedAt ??= now;
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + ttlMs;
    this.tokens.set(sha256(token), { userId, expiresAt, usedAt: null, revokedAt: null });
    return { token, expiresAt };
  }

  /** `invalid` = không có (400); `gone` = đã dùng / hết hạn / thu hồi (410). */
  lookup(token: string, now: number): { userId: string } | 'invalid' | 'gone' {
    const t = this.tokens.get(sha256(token));
    if (!t) return 'invalid';
    if (t.usedAt !== null || t.revokedAt !== null || t.expiresAt <= now) return 'gone';
    return { userId: t.userId };
  }

  consume(token: string, now: number): void {
    const t = this.tokens.get(sha256(token));
    if (t) t.usedAt = now;
  }
}
