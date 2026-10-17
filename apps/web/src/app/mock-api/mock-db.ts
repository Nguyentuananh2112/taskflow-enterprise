import type { MembershipDto, UserDto } from '@taskflow/contracts/auth';
import type { WorkspaceRole } from '@taskflow/contracts/rbac';

import { MockCompany } from './mock-company';
import { MockWorkspaces } from './mock-workspaces';

// Trạng thái trong bộ nhớ của mock API (T-019). Mô phỏng ĐÚNG hành vi phiên của server thật
// (security.md §1.3–1.7): refresh token xoay vòng theo family, cửa sổ ân hạn 10s (REFRESH_IN_PROGRESS),
// logout-all tăng tokenVersion ⇒ access token cũ thành UNAUTHORIZED. KHÔNG phải mã bảo mật thật —
// mật khẩu giữ dạng thô vì đây chỉ là dữ liệu giả trong bộ nhớ của máy dev/test.

type MockUser = UserDto & { password: string; tokenVersion: number };
type AccessEntry = { userId: string; tokenVersion: number; expiresAt: number };
type RefreshEntry = {
  userId: string;
  familyId: string;
  revokedAt: number | null;
  reason: 'ROTATED' | 'LOGOUT' | 'LOGOUT_ALL' | 'PASSWORD_CHANGED' | null;
};

export type MockDbOptions = Readonly<{
  /** TTL access token (giây) — test đặt ngắn để thử TOKEN_EXPIRED. */
  accessTtlSec?: number;
  now?: () => number;
  /** Đăng ký tạo workspace mặc định ⇒ mock board tạo project "Dự án đầu tiên" (ADR-103). */
  onWorkspaceCreated?: (workspaceId: string) => void;
}>;

/** Cửa sổ ân hạn sau khi xoay refresh token (security.md §1.4). */
export const REFRESH_GRACE_MS = 10_000;

export class MockDb {
  readonly accessTtlSec: number;
  readonly now: () => number;
  private readonly onWorkspaceCreated: ((workspaceId: string) => void) | undefined;
  private readonly users = new Map<string, MockUser>();
  /** Workspace + thành viên (T-034) — nguồn duy nhất cho tên/slug/role/xóa mềm. */
  readonly workspaces: MockWorkspaces;
  /** Mốc 3.5: MỘT công ty (ADR-133) — mọi user mock là nhân viên trừ khi test đổi role/grant. */
  readonly company = new MockCompany();
  private readonly access = new Map<string, AccessEntry>();
  private readonly refresh = new Map<string, RefreshEntry>();

  constructor(options: MockDbOptions = {}) {
    this.accessTtlSec = options.accessTtlSec ?? 900;
    this.now = options.now ?? Date.now;
    this.onWorkspaceCreated = options.onWorkspaceCreated;
    this.workspaces = new MockWorkspaces(this.now);
  }

  findUserByEmail(email: string): MockUser | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  getUser(id: string): MockUser | undefined {
    return this.users.get(id);
  }

  createUser(input: { email: string; password: string; fullName: string }) {
    const user: MockUser = {
      id: crypto.randomUUID(),
      email: input.email,
      fullName: input.fullName,
      password: input.password,
      createdAt: new Date(this.now()).toISOString(),
      tokenVersion: 1,
    };
    this.users.set(user.id, user);
    this.company.add(user.id, user.createdAt);
    const workspaceId = this.createWorkspace(`Workspace của ${input.fullName}`, undefined, user.id);
    return { user, defaultWorkspaceId: workspaceId };
  }

  /** Nhân viên công ty hiện tại kèm user (bảng công HR, mock-hr). */
  companyEmployees(): Array<{ user: MockUser; joinedAt: string }> {
    return this.company.employees().flatMap(({ userId, joinedAt }) => {
      const user = this.users.get(userId);
      return user ? [{ user, joinedAt }] : [];
    });
  }

  /** POST /workspaces và register (ADR-103): người tạo là OWNER; slug trống ⇒ sinh từ tên. */
  createWorkspace(name: string, slug: string | undefined, ownerId: string): string {
    const row = this.workspaces.create(
      { name, slug: slug ?? this.workspaces.generateSlug(name) },
      ownerId,
    );
    this.onWorkspaceCreated?.(row.id);
    return row.id;
  }

  /** Membership của các workspace CHƯA xóa (workspace xóa mềm ⇒ 404 với mọi thành viên — R18). */
  membershipsOf(userId: string): MembershipDto[] {
    return this.workspaces.activeOf(userId).map(({ workspace, member }) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      slug: workspace.slug,
      role: member.role,
    }));
  }

  membershipIn(userId: string, workspaceId: string): MembershipDto | undefined {
    return this.membershipsOf(userId).find((m) => m.workspaceId === workspaceId);
  }

  /** Thêm vào workspace có sẵn (test/seed) — hoặc đổi role nếu đã là thành viên. */
  setMembership(userId: string, workspace: MembershipDto, role: WorkspaceRole): void {
    this.workspaces.setMember(workspace.workspaceId, userId, role);
  }

  /** Thành viên của workspace, theo thứ tự tham gia. */
  membersOf(
    workspaceId: string,
  ): Array<{ user: UserDto; membership: MembershipDto; joinedAt: string }> {
    return this.workspaces.membersOf(workspaceId).flatMap((m) => {
      const user = this.users.get(m.userId);
      const membership = user && this.membershipIn(user.id, workspaceId);
      return user && membership ? [{ user, membership, joinedAt: m.joinedAt }] : [];
    });
  }

  /** Cấp access token (chuỗi ngẫu nhiên — mock không ký JWT). */
  issueAccess(user: MockUser) {
    const accessToken = `mock-at-${crypto.randomUUID()}`;
    this.access.set(accessToken, {
      userId: user.id,
      tokenVersion: user.tokenVersion,
      expiresAt: this.now() + this.accessTtlSec * 1000,
    });
    return { accessToken, expiresIn: this.accessTtlSec };
  }

  /** `ok` | `expired` (TOKEN_EXPIRED) | `invalid` (UNAUTHORIZED: sai token hoặc tv lệch). */
  verifyAccess(
    token: string,
  ): { status: 'ok'; user: MockUser } | { status: 'expired' | 'invalid' } {
    const entry = this.access.get(token);
    const user = entry && this.users.get(entry.userId);
    if (!entry || !user || entry.tokenVersion !== user.tokenVersion) return { status: 'invalid' };
    if (entry.expiresAt <= this.now()) return { status: 'expired' };
    return { status: 'ok', user };
  }

  /** Mở family refresh mới (login/register/đổi mật khẩu). */
  issueRefresh(userId: string, familyId: string = crypto.randomUUID()): string {
    const token = `mock-rt-${crypto.randomUUID()}`;
    this.refresh.set(token, { userId, familyId, revokedAt: null, reason: null });
    return token;
  }

  /** Xoay refresh token (security.md §1.4). */
  rotateRefresh(
    token: string | undefined,
  ):
    { status: 'ok'; userId: string; refreshToken: string } | { status: 'invalid' | 'in-progress' } {
    const entry = token === undefined ? undefined : this.refresh.get(token);
    if (!entry || !this.users.has(entry.userId)) return { status: 'invalid' };
    if (entry.revokedAt !== null) {
      if (entry.reason !== 'ROTATED') return { status: 'invalid' };
      if (this.now() - entry.revokedAt < REFRESH_GRACE_MS) return { status: 'in-progress' };
      this.revokeFamily(entry.familyId); // reuse ⇒ thu hồi cả family
      return { status: 'invalid' };
    }
    entry.revokedAt = this.now();
    entry.reason = 'ROTATED';
    return {
      status: 'ok',
      userId: entry.userId,
      refreshToken: this.issueRefresh(entry.userId, entry.familyId),
    };
  }

  revokeRefresh(token: string | undefined): void {
    const entry = token === undefined ? undefined : this.refresh.get(token);
    if (entry && entry.revokedAt === null) this.revokeFamily(entry.familyId, 'LOGOUT');
  }

  /** Đăng xuất mọi thiết bị / đổi mật khẩu: thu hồi mọi refresh + tăng tokenVersion. */
  revokeAllSessions(userId: string, reason: 'LOGOUT_ALL' | 'PASSWORD_CHANGED'): void {
    for (const entry of this.refresh.values()) {
      if (entry.userId === userId && entry.revokedAt === null) {
        entry.revokedAt = this.now();
        entry.reason = reason;
      }
    }
    const user = this.users.get(userId);
    if (user) user.tokenVersion += 1;
  }

  private revokeFamily(familyId: string, reason: RefreshEntry['reason'] = null): void {
    for (const entry of this.refresh.values()) {
      if (entry.familyId === familyId && entry.revokedAt === null) {
        entry.revokedAt = this.now();
        entry.reason = reason;
      }
    }
  }
}
