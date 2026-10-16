/**
 * Bảng rate limit (security.md §6.4). Một nơi duy nhất cho con số — route chỉ chọn rule theo tên.
 * Khóa Valkey: `rl:{id}:{key}` (security.md §2.4); email luôn được băm SHA-256.
 */
export type RateLimitKey =
  /** IP thật sau `trust proxy`, IPv6 gom theo /56 (`ipKeyGenerator`). */
  | 'ip'
  /** userId đã xác thực; chưa xác thực ⇒ rơi về IP. */
  | 'user'
  /** SHA-256 của email (trim + lowercase) trong body. */
  | 'email'
  | 'ip+email';

export interface RateLimitRule {
  /** Tiền tố khóa Valkey, duy nhất. */
  readonly id: string;
  readonly windowMs: number;
  readonly limit: number;
  readonly key: RateLimitKey;
  /**
   * `closed`: Valkey lỗi ⇒ 503 (login/register/refresh — không để brute force tự do).
   * `open`: Valkey lỗi ⇒ cho qua + log (không làm sập dịch vụ) — ADR-074.
   */
  readonly failMode: 'open' | 'closed';
  /** Chỉ đếm request thất bại (status ≥ 400), vd "5 lần đăng nhập SAI". */
  readonly countFailedOnly?: boolean;
  /** Chỉ đếm request có status thuộc danh sách (vd chỉ 401 — xác thực thất bại). */
  readonly countOnlyStatuses?: readonly number[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const rule = (r: RateLimitRule): RateLimitRule => r;

export const RATE_LIMIT_RULES = {
  /** Login, lớp 1 — tổng theo IP, chạy TRƯỚC validate (mọi request, kể cả body sai). */
  loginIp: [
    rule({ id: 'login-ip', windowMs: 15 * MINUTE, limit: 20, key: 'ip', failMode: 'closed' }),
  ],
  /**
   * Login, lớp 2 (ADR-108 — chống khóa tài khoản từ xa, M4 của T-028): chạy SAU validate (400 không
   * bị đếm, email đã chuẩn hóa) và CHỈ đếm `401 INVALID_CREDENTIALS`. Bucket chặt theo cặp
   * (IP, emailHash) chặn dò từ một IP mà không khóa chủ tài khoản ở IP khác; bucket theo email đủ cao
   * (100/giờ) để vài chục IP không khóa được người dùng thật, vẫn chặn stuffing phân tán quy mô lớn.
   * Request bị 429 không được đếm (không phải 401) ⇒ chờ hết cửa sổ là mở, không gia hạn mãi.
   */
  login: [
    rule({
      id: 'login-fail-ip-email',
      windowMs: 15 * MINUTE,
      limit: 10,
      key: 'ip+email',
      failMode: 'closed',
      countOnlyStatuses: [401],
    }),
    rule({
      id: 'login-fail-email',
      windowMs: HOUR,
      limit: 100,
      key: 'email',
      failMode: 'closed',
      countOnlyStatuses: [401],
    }),
  ],
  register: [rule({ id: 'register-ip', windowMs: HOUR, limit: 5, key: 'ip', failMode: 'closed' })],
  refresh: [
    rule({ id: 'refresh-ip', windowMs: 5 * MINUTE, limit: 60, key: 'ip', failMode: 'closed' }),
  ],
  logout: [rule({ id: 'logout-ip', windowMs: MINUTE, limit: 10, key: 'ip', failMode: 'open' })],
  logoutAll: [
    rule({ id: 'logout-all-user', windowMs: MINUTE, limit: 10, key: 'user', failMode: 'open' }),
  ],
  /** Fail-CLOSED (L2 của T-028, ADR-108): Valkey chết ⇒ 503, không cho dò mật khẩu hiện tại tự do. */
  changePassword: [
    rule({
      id: 'change-password-user',
      windowMs: 15 * MINUTE,
      limit: 5,
      key: 'user',
      failMode: 'closed',
    }),
  ],
  updateMe: [
    rule({ id: 'update-me-user', windowMs: HOUR, limit: 30, key: 'user', failMode: 'open' }),
  ],
  addMember: [
    rule({ id: 'add-member-user', windowMs: HOUR, limit: 30, key: 'user', failMode: 'open' }),
  ],
  createWorkspace: [
    rule({ id: 'create-workspace-user', windowMs: HOUR, limit: 10, key: 'user', failMode: 'open' }),
  ],
  restoreWorkspace: [
    rule({
      id: 'restore-workspace-user',
      windowMs: HOUR,
      limit: 10,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** Check-in / check-out (thiết kế §5): 10/phút/user — chống bấm liên tục, không chặn thử lại vì mạng. */
  attendancePunch: [
    rule({
      id: 'attendance-punch-user',
      windowMs: MINUTE,
      limit: 10,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** Xuất CSV bảng công (SEC-HR-13): truy vấn nặng cả công ty — 20/giờ/user. */
  attendanceExport: [
    rule({
      id: 'attendance-export-user',
      windowMs: HOUR,
      limit: 20,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** Mặc định cho API đã xác thực / chưa xác thực (gắn toàn cục). */
  authenticated: [
    rule({ id: 'api-user', windowMs: MINUTE, limit: 300, key: 'user', failMode: 'open' }),
  ],
  anonymous: [rule({ id: 'api-ip', windowMs: MINUTE, limit: 100, key: 'ip', failMode: 'open' })],
  /**
   * Trần THÔ theo IP cho request CÓ `Authorization` (review T-016): giới hạn chính vẫn là 300/phút/user
   * sau `authenticate`; trần này chỉ chặn việc xoay token để né giới hạn IP. 1000 ≈ 3 người dùng ở
   * mức trần user cùng lúc, trong khi sử dụng thực tế mỗi người ≪ 300/phút ⇒ văn phòng NAT vài chục
   * người không bị chạm tới.
   */
  bearerIp: [
    rule({ id: 'api-bearer-ip', windowMs: MINUTE, limit: 1000, key: 'ip', failMode: 'open' }),
  ],
  /**
   * Xác thực thất bại (401) theo IP: 30/phút — chặn token rác TRƯỚC bước verify (CPU + log).
   * `TOKEN_EXPIRED` cũng là 401: dùng bình thường mỗi người ≤ 1 lần/15 phút ⇒ xa ngưỡng.
   */
  authFailure: [
    rule({
      id: 'api-auth-fail-ip',
      windowMs: MINUTE,
      limit: 30,
      key: 'ip',
      failMode: 'open',
      countOnlyStatuses: [401],
    }),
  ],
  /** Socket.io handshake (security.md §5.1). */
  socketHandshake: [
    rule({ id: 'socket-handshake-ip', windowMs: MINUTE, limit: 20, key: 'ip', failMode: 'open' }),
  ],
} as const satisfies Record<string, readonly RateLimitRule[]>;

/** `project:join`: 30 lần/phút/socket — đếm trong bộ nhớ của socket (trạng thái gắn với kết nối). */
export const PROJECT_JOIN_LIMIT = { windowMs: MINUTE, limit: 30 } as const;
/**
 * `project:join` gộp mọi socket của user trên instance (review B G1-realtime M2): mỗi join tốn ~2×3
 * truy vấn kể cả khi bị từ chối ⇒ hạn mức theo socket nhân với số socket không chặn được một user.
 */
export const PROJECT_JOIN_LIMIT_PER_USER = { windowMs: MINUTE, limit: 60 } as const;
/**
 * `auth:renew`: mỗi lần verify token + kiểm lại membership mọi phòng (tới ~20 truy vấn DB) ⇒ giới
 * hạn theo socket và theo user (gộp mọi socket của user trên instance) — T-028 Medium. Client bình
 * thường renew ~1 lần / 15 phút / socket.
 */
export const AUTH_RENEW_LIMIT = {
  socket: { windowMs: MINUTE, limit: 5 },
  user: { windowMs: MINUTE, limit: 30 },
} as const;
/** Tối đa số phòng project một socket được ở cùng lúc (security.md §5.2). */
export const MAX_PROJECT_ROOMS_PER_SOCKET = 20;
/**
 * Tối đa số socket đồng thời của một user trên MỘT instance (review B G1-realtime M2) — vài tab ×
 * vài thiết bị là đủ; vượt ⇒ handshake `RATE_LIMITED`. Đếm theo phòng `user:{id}` local.
 */
export const MAX_SOCKETS_PER_USER = 20;
