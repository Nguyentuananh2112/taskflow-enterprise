// Port của gateway realtime. core KHÔNG import module nghiệp vụ (dependency-cruiser) — module
// hiện thực theo cấu trúc, wire ở composition root (ADR-016, ADR-093).

export interface SocketPrincipal {
  userId: string;
  /** familyId của phiên refresh — phòng `session:{sid}` (logout 1 thiết bị). */
  sid: string;
  /** Hạn access token — hẹn giờ `auth:expired` (security.md §5.3). */
  expiresAt: Date;
}

/**
 * Xác thực access token ở handshake và `auth:renew` — đúng các bước security.md §2.5 (verify,
 * `tv`, `sid`). Composition root bọc `AccessTokenAuthenticator` của module auth.
 * Lỗi: ném `TokenExpiredError` / `UnauthorizedError` / `ServiceUnavailableError` (core/errors).
 */
export interface ISocketAuthenticator {
  authenticate(token: string): Promise<SocketPrincipal>;
}

/** Hình dạng `AccessTokenAuthenticator` của module auth (khai báo cấu trúc — core không import module). */
export interface BearerAuthenticator {
  authenticate(
    authorization: string | undefined,
  ): Promise<{ id: string; sid: string; exp: number }>;
}

/** Bọc authenticator HTTP của auth thành authenticator cho socket (token nằm trong `auth`, không phải header). */
export function socketAuthenticatorFrom(auth: BearerAuthenticator): ISocketAuthenticator {
  return {
    async authenticate(token) {
      const user = await auth.authenticate(`Bearer ${token}`);
      return { userId: user.id, sid: user.sid, expiresAt: new Date(user.exp * 1000) };
    },
  };
}

/**
 * `project:join` (security.md §5.2) — module Workspace hiện thực (T-015).
 * `true` ⇔ user là thành viên ws (ws chưa xóa mềm) VÀ project ∈ ws. Project archived vẫn `true`.
 */
export interface IProjectAccessChecker {
  canAccessProject(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<boolean>;
}

/** Ai/đâu gây ra event — đi vào vỏ `RealtimeEnvelope` (data-and-api §4.3). */
export interface RealtimeEventMeta {
  actorId: string;
  /** `X-Client-Id` đã validate uuid; không phải thông tin xác thực (security §5.2). */
  originClientId?: string | null;
}

export type WorkspaceRole = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';
