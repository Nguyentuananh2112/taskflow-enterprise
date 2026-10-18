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
  | 'ip+email'
  /** `:userId` của route — người BỊ tác động (vd tạo lại link cho MỘT người, bất kể ai làm). */
  | 'target';

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

/*
 * Luật theo IP (lỗi #2 localhost, T-076): MỘT công ty ⇒ cả văn phòng thường chung MỘT IP NAT. Mọi luật `key: 'ip'`
 * đo cho một văn phòng ~200 người (8:00 mở app, API khởi động lại ⇒ mọi tab nối lại, chiều về đăng xuất). Lá chắn
 * chống dò / lạm dụng nằm ở luật theo (IP, email), email, user, socket — giữ chặt; luật IP chỉ còn là trần thô.
 */

export const RATE_LIMIT_RULES = {
  /**
   * Login, lớp 1 — tổng theo IP, chạy TRƯỚC validate (mọi request, kể cả body sai). 300 / 15 phút: sáng thứ Hai cả
   * văn phòng đăng nhập (kèm vài lần gõ sai) không bị khóa; dò mật khẩu vẫn bị lớp 2 chặn theo (IP, email) / email.
   */
  loginIp: [
    rule({ id: 'login-ip', windowMs: 15 * MINUTE, limit: 300, key: 'ip', failMode: 'closed' }),
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
  /**
   * `inspect` + `activate` (ADR-137, SEC-HR-57): CHUNG một bộ đếm theo IP, chỉ đếm lần sai (400 / 410) —
   * 10 lần / 15 phút, lần 11 ⇒ 429. Fail-closed như login (dò token không được tự do khi Valkey chết).
   * Giữ 10 dù văn phòng chung IP (T-076): CHỈ lần sai được đếm, kích hoạt đúng link không tốn suất.
   */
  activation: [
    rule({
      id: 'activation-ip',
      windowMs: 15 * MINUTE,
      limit: 10,
      key: 'ip',
      failMode: 'closed',
      countOnlyStatuses: [400, 410],
    }),
  ],
  /**
   * Mỗi lần tải trang + mỗi ~15 phút mỗi tab đều refresh ⇒ văn phòng ~200 người × vài tab cần cỡ trăm lượt / phút.
   * Refresh token 256 bit + phát hiện dùng lại theo family mới là lá chắn; trần IP chỉ chặn flood.
   */
  refresh: [
    rule({ id: 'refresh-ip', windowMs: 5 * MINUTE, limit: 1200, key: 'ip', failMode: 'closed' }),
  ],
  /** Cuối giờ cả văn phòng đăng xuất trong vài phút. */
  logout: [rule({ id: 'logout-ip', windowMs: MINUTE, limit: 120, key: 'ip', failMode: 'open' })],
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
  /** `POST /hr/employees` — 30/giờ/actor (thiết kế Mốc 3.5 §5). */
  hireEmployee: [
    rule({ id: 'hire-employee-user', windowMs: HOUR, limit: 30, key: 'user', failMode: 'open' }),
  ],
  /** `GET /workspaces/:wsId/member-candidates` — danh bạ email nội bộ: 60/giờ/actor (R41). */
  memberCandidates: [
    rule({
      id: 'member-candidates-user',
      windowMs: HOUR,
      limit: 60,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** `POST hr/employees/:userId/activation-link` — 10/giờ cho MỖI người đích (SEC-HR-63), tách khỏi hạn mức thêm. */
  activationLink: [
    rule({
      id: 'activation-link-target',
      windowMs: HOUR,
      limit: 10,
      key: 'target',
      failMode: 'open',
    }),
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
  /**
   * Xuất CSV bảng công (SEC-HR-13): truy vấn nặng cả công ty — 20/giờ/user. Mốc 5 (ADR-130): MỌI báo cáo .xlsx
   * (`attendance/export.xlsx`, `leave/export.xlsx`, `payroll/…/export.xlsx`) dùng CHÍNH quy tắc này (cùng `id` ⇒ cùng
   * bucket với CSV) qua `EXPORT_RATE_LIMIT`.
   */
  attendanceExport: [
    rule({
      id: 'attendance-export-user',
      windowMs: HOUR,
      limit: 20,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** Gửi đơn bổ sung giờ (hr-extended ADR-129, SEC-HR-51): 20/giờ/user. */
  correctionSubmit: [
    rule({
      id: 'attendance-correction-user',
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
  /** Request KHÔNG có Authorization — gồm cả login / refresh / logout / activation ⇒ phải ≥ nhu cầu refresh của văn phòng. */
  anonymous: [rule({ id: 'api-ip', windowMs: MINUTE, limit: 600, key: 'ip', failMode: 'open' })],
  /**
   * Trần THÔ theo IP cho request CÓ `Authorization` (review T-016): giới hạn chính vẫn là 300/phút/user
   * sau `authenticate`; trần này chỉ chặn việc xoay token để né giới hạn IP. 3000 ≈ 10 người ở trần user, đủ cho
   * văn phòng ~200 người dùng thực tế (mỗi người ≪ 300/phút) — T-076.
   */
  bearerIp: [
    rule({ id: 'api-bearer-ip', windowMs: MINUTE, limit: 3000, key: 'ip', failMode: 'open' }),
  ],
  /**
   * Xác thực thất bại (401) theo IP: 300/phút — chặn token rác TRƯỚC bước verify (CPU + log).
   * `TOKEN_EXPIRED` cũng là 401: sáng ra mọi tab mở từ hôm qua cùng gửi token hết hạn một lượt ⇒ văn phòng ~200
   * người × vài tab cần cỡ vài trăm (T-076; 30 cũ khóa cả văn phòng).
   */
  authFailure: [
    rule({
      id: 'api-auth-fail-ip',
      windowMs: MINUTE,
      limit: 300,
      key: 'ip',
      failMode: 'open',
      countOnlyStatuses: [401],
    }),
  ],
  /**
   * Socket.io handshake (security.md §5.1). Một công ty ⇒ cả văn phòng thường chung MỘT IP NAT: 8:00 nhiều người mở
   * app, hoặc API khởi động lại ⇒ mọi tab nối lại cùng lúc. 20/phút làm người thứ 21+ mất realtime (lỗi #2 localhost)
   * ⇒ 600/phút chỉ còn là trần chống flood thô. Lá chắn chính: JWT ở handshake + `MAX_SOCKETS_PER_USER` + hạn mức
   * join / renew theo user / socket. Valkey lỗi ⇒ cho qua.
   */
  socketHandshake: [
    rule({ id: 'socket-handshake-ip', windowMs: MINUTE, limit: 600, key: 'ip', failMode: 'open' }),
  ],
  /**
   * `/media` (ADR-141, F-10): không Bearer — hạn mức IP nhẹ. Một trang chat tải vài chục ảnh (trình duyệt cache
   * `private, max-age` tới hạn chữ ký) ⇒ cả văn phòng cùng mở chat ~2000/phút (T-076); Valkey lỗi ⇒ cho qua (chữ
   * ký + kiểm DB vẫn chặn truy cập trái phép).
   */
  media: [rule({ id: 'media-ip', windowMs: MINUTE, limit: 2000, key: 'ip', failMode: 'open' })],
  /**
   * Ảnh đại diện (ADR-142): đặt / gỡ — kể cả HR gỡ cho người khác — CHUNG một bucket 10 / giờ / user. Fail-closed
   * (B): đặt ảnh tốn đĩa + CPU worker sharp; một quy tắc cho cả nhóm cho đơn giản.
   */
  avatar: [rule({ id: 'avatar-user', windowMs: HOUR, limit: 10, key: 'user', failMode: 'closed' })],
  /** Mốc 6 (ADR-144): gửi tin 30 / phút (+ 600 / giờ — `chatSendRules`, chỉnh được ở test). */
  chatSend: [
    rule({ id: 'chat-send-min', windowMs: MINUTE, limit: 30, key: 'user', failMode: 'open' }),
  ],
  chatEdit: [rule({ id: 'chat-edit', windowMs: MINUTE, limit: 30, key: 'user', failMode: 'open' })],
  chatGroupCreate: [
    rule({
      id: 'chat-group-create',
      windowMs: 24 * HOUR,
      limit: 20,
      key: 'user',
      failMode: 'open',
    }),
  ],
  /** Danh bạ `chat/people` (R49): 60 / phút. */
  chatPeople: [
    rule({ id: 'chat-people', windowMs: MINUTE, limit: 60, key: 'user', failMode: 'open' }),
  ],
  /** Upload chat 30 lượt / 10 phút — fail-closed có chủ đích (tốn đĩa, ADR-141; khác R21). */
  chatUpload: [
    rule({ id: 'chat-upload', windowMs: 10 * MINUTE, limit: 30, key: 'user', failMode: 'closed' }),
  ],
} as const satisfies Record<string, readonly RateLimitRule[]>;

/** Mọi route .xlsx (ADR-130): CÙNG quy tắc / bucket với xuất CSV — không phải hạn mức riêng (20/giờ/user chung). */
export const EXPORT_RATE_LIMIT: readonly RateLimitRule[] = RATE_LIMIT_RULES.attendanceExport;
/** Gửi tin: 30 / phút + `hourly` / giờ (600; `CHAT_SEND_HOURLY` chỉ ở APP_ENV=test). */
export function chatSendRules(hourly = 600): readonly RateLimitRule[] {
  return [
    ...RATE_LIMIT_RULES.chatSend,
    rule({ id: 'chat-send-hour', windowMs: HOUR, limit: hourly, key: 'user', failMode: 'open' }),
  ];
}

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
