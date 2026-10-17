import * as z from 'zod';

import { ApiError, CLIENT_ERROR_CODES, isApiError } from './api-error';
import { parseEnvelope as parse, readFile } from './envelope';
import { createSingleFlight } from './single-flight';
import {
  defaultCreateXhr,
  sendViaXhr,
  uploadHeaders,
  type CreateXhr,
  type UploadOptions,
} from './upload';

export type { ApiResult, DownloadResult } from './envelope';

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
  /** Tạo XHR cho `upload` (test inject). Mặc định `new XMLHttpRequest()`. */
  xhr?: CreateXhr;
  auth?: AuthHooks;
}>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = Readonly<Record<string, string | number | boolean | null | undefined>>;

export type RequestOptions<S extends z.ZodType> = Readonly<{
  /** Schema của `data` (lấy từ @taskflow/contracts). Bắt buộc: không có response "tin mù". */
  schema: S;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /**
   * Header `Idempotency-Key` (chấm công — attendance-leave.md §5): mỗi lần BẤM một key mới; tự thử
   * lại sau lỗi mạng thì gửi lại CÙNG key ⇒ server trả kết quả cũ, không tạo lượt thứ hai.
   */
  idempotencyKey?: string;
  /** Mặc định `application/json`; tải file (CSV) đặt kiểu file. */
  accept?: string;
}>;

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
  const createXhr: CreateXhr = deps.xhr ?? defaultCreateXhr;
  const refresh = deps.auth ? createSingleFlight(deps.auth.refresh) : null;

  type Sent = { response: Response; sentToken: string | null };

  /** Gửi qua transport; AbortError ném lại nguyên dạng, lỗi khác ⇒ NETWORK_ERROR (status 0). */
  async function transmit(go: () => Promise<Response>): Promise<Response> {
    try {
      return await go();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError({
        status: 0,
        code: CLIENT_ERROR_CODES.network,
        message: 'Không kết nối được máy chủ.',
        cause,
      });
    }
  }

  /** Upload nhị phân qua XHR (header: `uploadHeaders`). */
  async function sendUpload(
    method: 'PUT' | 'POST',
    path: string,
    opts: UploadOptions<z.ZodType>,
  ): Promise<Sent> {
    await refresh?.inflight()?.catch(() => undefined); // như `send`: chờ refresh đang chạy
    const token = deps.auth?.getAccessToken() ?? null;
    const headers = uploadHeaders(opts.name, deps.clientId(), token);
    const url = buildUrl(deps.baseUrl(), path, opts.query);
    const { body, signal, onProgress } = opts;
    const response = await transmit(() =>
      sendViaXhr(createXhr, { method, url, headers, body, signal, onProgress }),
    );
    return { response, sentToken: token };
  }

  async function send(method: Method, path: string, opts: RequestOptions<z.ZodType>) {
    await refresh?.inflight()?.catch(() => undefined); // hàng đợi: chờ refresh đang chạy
    const token = deps.auth?.getAccessToken() ?? null;
    const headers = new Headers({ Accept: opts.accept ?? 'application/json' });
    // T-029 H2: API bắt buộc Content-Type JSON cho MỌI POST/PATCH, kể cả không có body (ép trình
    // duyệt preflight — một lớp chống CSRF, security.md §6.3). Thiếu ⇒ 415: refresh/logout/logout-all
    // hỏng mà UI vẫn tưởng thành công. Không có body ⇒ gửi `{}`.
    const hasBodyMethod = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const body = opts.body === undefined ? (hasBodyMethod ? {} : undefined) : opts.body;
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (method !== 'GET') headers.set('X-Client-Id', deps.clientId());
    if (opts.idempotencyKey) headers.set('Idempotency-Key', opts.idempotencyKey);

    const url = buildUrl(deps.baseUrl(), path, opts.query); // lỗi lập trình: ném thẳng, không bọc
    const response = await transmit(() =>
      doFetch(url, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        // Chỉ route /auth/* cần cookie refresh. Staging/prod: `__Host-tf_rt; Path=/` (ADR-109 — trình
        // duyệt gửi cho mọi path nên FE tự giới hạn `include`); dev: `tf_rt; Path=/api/v1/auth`.
        credentials: path.startsWith('/auth/') ? 'include' : 'omit',
        signal: opts.signal ?? null,
      }),
    );
    return { response, sentToken: token };
  }

  /** Có token mới hơn token đã gửi chưa? Request khác vừa refresh xong ⇒ dùng luôn, không refresh lại. */
  async function renewed(sentToken: string | null): Promise<boolean> {
    const current = deps.auth?.getAccessToken() ?? null;
    if (current !== null && current !== sentToken) return true;
    return (await refresh?.run()) ?? false;
  }

  /**
   * Refresh ném lỗi (mạng, 5xx) ⇒ KHÔNG kết thúc phiên (frontend.md §3.3: lỗi mạng không đẩy về
   * /login) — trả lỗi mạng cho request này, phiên vẫn giữ để thử lại sau.
   */
  const refreshUnavailable = (cause: unknown) =>
    isApiError(cause)
      ? cause
      : new ApiError({
          status: 0,
          code: CLIENT_ERROR_CODES.network,
          message: 'Không kết nối được máy chủ.',
          cause,
        });

  /**
   * Chính sách xác thực DUY NHẤT cho mọi transport (fetch JSON, download, upload XHR): gửi `attempt`, đọc bằng
   * `read`; TOKEN_EXPIRED ⇒ refresh rồi gửi lại `attempt` đúng 1 lần (upload gửi lại cùng Blob).
   */
  async function authed<T>(
    attempt: () => Promise<Sent>,
    read: (response: Response) => Promise<T>,
    retried = false,
  ): Promise<T> {
    const { response, sentToken } = await attempt();
    try {
      return await read(response);
    } catch (error) {
      if (!(error instanceof ApiError) || !deps.auth || !refresh) throw error;
      // Chỉ TOKEN_EXPIRED mới tự refresh (security.md §2.5) — và chỉ thử lại 1 lần.
      if (error.code === 'TOKEN_EXPIRED') {
        if (!retried) {
          const ok = await renewed(sentToken).catch((cause: unknown) => {
            throw refreshUnavailable(cause);
          });
          if (ok) return authed(attempt, read, true);
        }
        deps.auth.onSessionEnded('expired');
      } else if (
        (error.code === 'UNAUTHORIZED' || error.code === 'SESSION_REVOKED') &&
        sentToken !== null
      ) {
        // tv lệch / sid bị thu hồi (security.md §2.5), hoặc không còn thuộc công ty / quá giờ nghỉ việc (ADR-135
        // SESSION_REVOKED): token không còn giá trị, KHÔNG refresh — về đăng nhập.
        deps.auth.onSessionEnded('revoked');
      }
      throw error;
    }
  }

  const request = <S extends z.ZodType>(method: Method, path: string, opts: RequestOptions<S>) =>
    authed(
      () => send(method, path, opts),
      (r) => parse(r, opts.schema),
    );

  const call =
    (method: Method) =>
    async <S extends z.ZodType>(path: string, opts: RequestOptions<S>) =>
      (await request(method, path, opts)).data;

  return {
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    patch: call('PATCH'),
    delete: call('DELETE'),
    /** Khi cần `meta.page` (danh sách phân trang cursor) hoặc `requestId`. */
    request,
    /** GET một file (CSV — attendance-leave §5): Bearer + tự refresh như mọi request, trả Blob. */
    download: (path: string, opts: Readonly<{ query?: Query; accept: string }>) =>
      authed(() => send('GET', path, { schema: z.never(), ...opts }), readFile),
    /**
     * Tải lên nhị phân có tiến độ + hủy (XHR). Cùng Bearer / refresh / kết thúc phiên như `request`; hủy ⇒
     * AbortError, KHÔNG kết thúc phiên. Trả `data` đã parse bằng `schema`.
     */
    upload: async <S extends z.ZodType>(
      method: 'PUT' | 'POST',
      path: string,
      opts: UploadOptions<S>,
    ) =>
      (
        await authed(
          () => sendUpload(method, path, opts),
          (r) => parse(r, opts.schema),
        )
      ).data,
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
