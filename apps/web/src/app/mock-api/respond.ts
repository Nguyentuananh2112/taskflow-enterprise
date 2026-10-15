import {
  ApiError as ApiErrorEnvelope,
  apiSuccess,
  toValidationIssues,
  type ErrorCode,
} from '@taskflow/contracts/common';
import { HttpResponse } from 'msw';
import type * as z from 'zod';

// Dựng response của mock API. Mọi response đều được parse bằng CHÍNH schema của contracts trước khi
// trả về ⇒ mock không thể trả dữ liệu mà server thật không được phép trả (T-019 việc 1).

const meta = () => ({ timestamp: new Date().toISOString(), requestId: crypto.randomUUID() });

type Init = Readonly<{ status?: number; headers?: HeadersInit }>;

export function ok<S extends z.ZodType>(schema: S, data: z.input<S>, init: Init = {}) {
  const body = apiSuccess(schema).parse({ success: true, data, meta: meta() });
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
  const raw: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  return {
    response: fail(400, 'VALIDATION_ERROR', { issues: toValidationIssues(parsed.error) }),
  };
}

/** Lỗi validation do luật ở application (vd mật khẩu phổ biến) — cùng dạng `details.issues`. */
export function ruleViolation(path: string, message: string) {
  return fail(400, 'VALIDATION_ERROR', { issues: [{ path: [path], code: 'custom', message }] });
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
};
