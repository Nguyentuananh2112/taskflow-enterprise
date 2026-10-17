import {
  ApiError as ApiErrorEnvelope,
  apiSuccess,
  toValidationIssues,
  type ErrorCode,
  type PageMeta,
} from '@taskflow/contracts/common';
import { HttpResponse } from 'msw';
import type * as z from 'zod';

// Dựng response của mock API. Mọi response đều được parse bằng CHÍNH schema của contracts trước khi
// trả về ⇒ mock không thể trả dữ liệu mà server thật không được phép trả (T-019 việc 1).

// Giờ trong `meta.timestamp` = đồng hồ của mock (`createMockApi({ now })`), như API thật neo giờ khi test.
let clock: () => number = Date.now;
export function setMockClock(now: () => number): void {
  clock = now;
}
const meta = () => ({
  timestamp: new Date(clock()).toISOString(),
  requestId: crypto.randomUUID(),
});

type Init = Readonly<{ status?: number; headers?: HeadersInit; page?: PageMeta }>;

export function ok<S extends z.ZodType>(schema: S, data: z.input<S>, init: Init = {}) {
  const body = apiSuccess(schema).parse({
    success: true,
    data,
    meta: { ...meta(), ...(init.page ? { page: init.page } : {}) },
  });
  return HttpResponse.json(body, { status: init.status ?? 200, headers: init.headers ?? {} });
}

export function noContent(init: Init = {}) {
  return new HttpResponse(null, { status: 204, headers: init.headers ?? {} });
}

export function fail(status: number, code: ErrorCode, details: unknown = null, init: Init = {}) {
  const body = ApiErrorEnvelope.parse({
    success: false,
    error: { code, message: MESSAGES[code] ?? code, details },
    meta: meta(),
  });
  return HttpResponse.json(body, { status, headers: init.headers ?? {} });
}

/**
 * Validate body bằng schema contracts, y như server (ADR-081, ADR-096: issue không chứa `input`).
 * Trả `{ data }` hoặc `{ response }` 400 VALIDATION_ERROR.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S>; response?: never } | { response: Response; data?: never }> {
  // Như express.json({ type: 'application/json' }): chỉ parse body khi Content-Type là JSON (kể cả DELETE).
  const isJson = (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .startsWith('application/json');
  const raw: unknown = isJson ? await request.json().catch(() => undefined) : undefined;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  return {
    response: fail(400, 'VALIDATION_ERROR', { issues: toValidationIssues(parsed.error) }),
  };
}

/** Lỗi validation do luật ở application (vd mật khẩu phổ biến) — cùng dạng `details.issues`. */
export function ruleViolation(path: string, code: string, message: string) {
  return fail(400, 'VALIDATION_ERROR', { issues: [{ path: [path], code, message }] });
}

/** Cursor opaque (base64url của offset) — đủ cho mock; server thật mã hóa khóa sắp xếp. */
export function paginate<T>(items: readonly T[], cursor: string | undefined, limit: number) {
  const offset = cursor ? Number(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const hasMore = offset + limit < items.length;
  const nextCursor = hasMore ? btoa(String(offset + limit)).replace(/=+$/, '') : null;
  return { data: slice, page: { nextCursor, hasMore, limit } satisfies PageMeta };
}

/** Parse query string bằng schema contracts (400 như server khi sai). */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): { data: z.output<S>; response?: never } | { response: Response; data?: never } {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (parsed.success) return { data: parsed.data };
  return {
    response: fail(400, 'VALIDATION_ERROR', { issues: toValidationIssues(parsed.error) }),
  };
}

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Dữ liệu không hợp lệ.',
  UNAUTHORIZED: 'Phiên đăng nhập không hợp lệ.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  INVALID_CURRENT_PASSWORD: 'Mật khẩu hiện tại không đúng.',
  REFRESH_TOKEN_INVALID: 'Phiên đăng nhập đã kết thúc.',
  REFRESH_IN_PROGRESS: 'Đang làm mới phiên, thử lại sau giây lát.',
  EMAIL_ALREADY_EXISTS: 'Email đã được sử dụng.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type phải là application/json.',
  ORIGIN_NOT_ALLOWED: 'Nguồn yêu cầu không được phép.',
  FORBIDDEN_ACCESS: 'Bạn không có quyền thực hiện thao tác này.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy tài nguyên.',
  VERSION_CONFLICT: 'Task đã bị người khác cập nhật.',
  INVALID_STATUS_TRANSITION: 'Không thể chuyển sang trạng thái này.',
  PROJECT_ARCHIVED: 'Dự án đã được lưu trữ.',
  BUSINESS_RULE_VIOLATION: 'Vi phạm luật nghiệp vụ.',
  PAYLOAD_TOO_LARGE: 'Tệp quá lớn.',
  INVALID_UPLOAD_NAME: 'Tên tệp không hợp lệ.',
  UNSUPPORTED_FILE_TYPE: 'Loại tệp không được nhận.',
  MACRO_OR_ACTIVE_CONTENT: 'Tệp có macro hoặc nội dung chủ động.',
};
