import type { MembershipDto, UserDto } from '@taskflow/contracts/auth';

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
}>;

/** Cửa sổ ân hạn sau khi xoay refresh token (security.md §1.4). */
export const REFRESH_GRACE_MS = 10_000;

export class MockDb {
  readonly accessTtlSec: number;
  readonly now: () => number;
  private readonly users = new Map<string, MockUser>();
  private readonly memberships = new Map<string, MembershipDto[]>();
  private readonly access = new Map<string, AccessEntry>();
  private readonly refresh = new Map<string, RefreshEntry>();

  constructor(options: MockDbOptions = {}) {
    this.accessTtlSec = options.accessTtlSec ?? 900;
    this.now = options.now ?? Date.now;
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
    const workspace: MembershipDto = {
      workspaceId: crypto.randomUUID(),
      workspaceName: `Workspace của ${input.fullName}`,
      slug: `ws-${user.id.slice(0, 8)}`,
      role: 'OWNER',
    };
    this.memberships.set(user.id, [workspace]);
    return { user, defaultWorkspaceId: workspace.workspaceId };
  }

  membershipsOf(userId: string): MembershipDto[] {
    return this.memberships.get(userId) ?? [];
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
