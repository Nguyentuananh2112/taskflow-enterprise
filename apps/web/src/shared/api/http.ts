import {
  ApiError as ApiErrorEnvelope,
  ApiErrorBody,
  ErrorCode,
  apiSuccess,
  type PageMeta,
} from '@taskflow/contracts/common';
import * as z from 'zod';

import { ApiError, CLIENT_ERROR_CODES } from './api-error';
import { createSingleFlight } from './single-flight';

// Fetch wrapper duy nhất của web (ADR-060: không axios; frontend.md §3.3). Nơi duy nhất được gọi fetch.

/** Cổng xác thực — Phase 4 (entities/session) hiện thực; T-012 để trống. */
export type AuthHooks = Readonly<{
  getAccessToken: () => string | null;
  /** Gọi /auth/refresh. `true` = đã có access token mới. Được bọc single-flight bên dưới. */
  refresh: () => Promise<boolean>;
  /** Phiên chấm dứt: refresh thất bại (`expired`) hoặc server từ chối token (`revoked`). */
  onSessionEnded: (reason: 'expired' | 'revoked') => void;
}>;

export type HttpDeps = Readonly<{
  /** API_URL lúc chạy, gồm `/api/v1` (đọc lười để không cần cấu hình khi import module). */
  baseUrl: () => string;
  clientId: () => string;
  fetch?: typeof fetch;
  auth?: AuthHooks;
}>;

/**
 * Envelope lỗi của contracts nhưng `code` là string bất kỳ (ADR-102): vỏ vẫn parse chặt, chỉ nới
 * enum mã lỗi để web cũ không hỏng khi API mới thêm mã.
 */
const ErrorEnvelopeAnyCode = ApiErrorEnvelope.extend({
  error: ApiErrorBody.extend({ code: z.string().min(1) }),
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Query = Readonly<Record<string, string | number | boolean | null | undefined>>;

export type RequestOptions<S extends z.ZodType> = Readonly<{
  /** Schema của `data` (lấy từ @taskflow/contracts). Bắt buộc: không có response "tin mù". */
  schema: S;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}>;

export type ApiResult<T> = { data: T; page: PageMeta | undefined; requestId: string | undefined };

const buildUrl = (base: string, path: string, query: Query | undefined) => {
  if (!path.startsWith('/')) throw new Error(`Đường dẫn API phải bắt đầu bằng "/": ${path}`);
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
};

export function createHttpClient(deps: HttpDeps) {
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const refresh = deps.auth ? createSingleFlight(deps.auth.refresh) : null;

  async function send(method: Method, path: string, opts: RequestOptions<z.ZodType>) {
    await refresh?.inflight()?.catch(() => undefined); // hàng đợi: chờ refresh đang chạy
    const token = deps.auth?.getAccessToken() ?? null;
    const headers = new Headers({ Accept: 'application/json' });
    if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (method !== 'GET') headers.set('X-Client-Id', deps.clientId());

    const url = buildUrl(deps.baseUrl(), path, opts.query); // lỗi lập trình: ném thẳng, không bọc
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: opts.body === undefined ? null : JSON.stringify(opts.body),
        // Cookie refresh chỉ sống ở Path=/api/v1/auth (security.md §2.3).
        credentials: path.startsWith('/auth/') ? 'include' : 'omit',
        signal: opts.signal ?? null,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError({
        status: 0,
        code: CLIENT_ERROR_CODES.network,
        message: 'Không kết nối được máy chủ.',
        cause,
      });
    }
    return { response, sentToken: token };
  }

  async function parse<S extends z.ZodType>(response: Response, schema: S) {
    const headerRequestId = response.headers.get('X-Request-Id') ?? undefined;
    const bad = (cause: unknown) =>
      new ApiError({
        status: response.status,
        code: CLIENT_ERROR_CODES.badResponse,
        message: 'Phản hồi từ máy chủ không hợp lệ.',
        requestId: headerRequestId,
        cause,
      });

    if (response.status === 204) {
      const empty = schema.safeParse(undefined);
      if (!empty.success) throw bad(empty.error);
      return { data: empty.data, page: undefined, requestId: headerRequestId };
    }
    // Envelope theo @taskflow/contracts (data-and-api §3.1): rẽ theo `success`, rồi parse chặt.
    const body: unknown = await response.json().catch((e: unknown) => e);
    const isFailure =
      typeof body === 'object' && body !== null && 'success' in body && body.success === false;
    if (isFailure) {
      const failure = ErrorEnvelopeAnyCode.safeParse(body);
      if (!failure.success) throw bad(failure.error);
      const { code, message, details } = failure.data.error;
      const requestId = failure.data.meta.requestId;
      const known = ErrorCode.safeParse(code);
      throw new ApiError({
        status: response.status,
        code: known.success ? known.data : CLIENT_ERROR_CODES.unknown,
        message,
        details,
        requestId,
        ...(known.success ? {} : { serverCode: code }),
      });
    }
    const success = apiSuccess(schema).safeParse(body);
    if (!success.success) throw bad(success.error);
    // Với S generic, TS không suy được khóa `data` của z.object({ data: S }) ⇒ ép về output của S
    // (giá trị đã được chính `schema` parse ở trên).
    const { data, meta } = success.data as { data: z.output<S>; meta: typeof success.data.meta };
    return { data, page: meta.page, requestId: meta.requestId };
  }

  /** Có token mới hơn token đã gửi chưa? Request khác vừa refresh xong ⇒ dùng luôn, không refresh lại. */
  async function renewed(sentToken: string | null): Promise<boolean> {
    const current = deps.auth?.getAccessToken() ?? null;
    if (current !== null && current !== sentToken) return true;
    return (await refresh?.run().catch(() => false)) ?? false;
  }

  async function request<S extends z.ZodType>(
    method: Method,
    path: string,
    opts: RequestOptions<S>,
    retried = false,
  ): Promise<ApiResult<z.output<S>>> {
    const { response, sentToken } = await send(method, path, opts);
    try {
      return await parse(response, opts.schema);
    } catch (error) {
      if (!(error instanceof ApiError) || !deps.auth || !refresh) throw error;
      // Chỉ TOKEN_EXPIRED mới tự refresh (security.md §2.5) — và chỉ thử lại 1 lần.
      if (error.code === 'TOKEN_EXPIRED') {
        if (!retried && (await renewed(sentToken))) return request(method, path, opts, true);
        deps.auth.onSessionEnded('expired');
      } else if (error.code === 'UNAUTHORIZED' && sentToken !== null) {
        // tv lệch / sid bị thu hồi (security.md §2.5): token không còn giá trị, không refresh.
        deps.auth.onSessionEnded('revoked');
      }
      throw error;
    }
  }

  const call =
    (method: Method) =>
    async <S extends z.ZodType>(path: string, opts: RequestOptions<S>) =>
      (await request(method, path, opts)).data;

  return {
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    delete: call('DELETE'),
    /** Khi cần `meta.page` (danh sách phân trang cursor) hoặc `requestId`. */
    request: <S extends z.ZodType>(method: Method, path: string, opts: RequestOptions<S>) =>
      request(method, path, opts),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
