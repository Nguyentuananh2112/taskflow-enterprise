/**
 * Ca SEC đã có thân test nhưng CHƯA chạy được vì tính năng chưa làm — danh sách DUY NHẤT được phép
 * skip. Mỗi mục bắt buộc có lý do + ticket. Ca không có ở đây ⇒ chạy mặc định (local lẫn CI).
 *
 * `skip-budget-reporter.ts` làm lượt chạy ĐỎ nếu có ca bị skip mà không khai báo ở đây (kể cả skip
 * động bằng `ctx.skip()` — vd build từ chối khởi động, probe không thấy limiter/gateway). Trước đây
 * mọi ca `pendingRoute` đều skip khi thiếu `SEC_RUN_PENDING` ⇒ CI không chạy 44 ca dù route đã có.
 *
 * Nghiệm thu branch làm tính năng: `SEC_RUN_PENDING=all` hoặc danh sách ticket/id (vd `T-040,SEC-28`).
 * Tính năng merge ⇒ XÓA mục khỏi đây trong cùng PR.
 */
export interface DeclaredPending {
  readonly reason: string;
  readonly ticket: string;
}

export const DECLARED_PENDING: Readonly<Record<string, DeclaredPending>> = {};

/** Tiền tố tên ca skip hợp lệ: `[PENDING <ticket>] <id> — <title>` (reporter đọc id sau `] `). */
export const PENDING_PREFIX = '[PENDING ';
