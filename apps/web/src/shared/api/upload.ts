import type * as z from 'zod';

// Transport tải lên bằng XHR (avatar-chat.md §7 E2): fetch chưa báo tiến độ upload trên mọi trình duyệt ⇒
// XHR riêng. CHỈ là transport: xác thực, refresh, parse envelope vẫn ở http.ts (một chỗ duy nhất).

/** Tiến độ 0..1. Gửi lại sau refresh ⇒ báo lại từ 0. */
export type UploadProgress = (fraction: number) => void;

/**
 * Tải lên nhị phân (`http.upload` — ADR-141): body `application/octet-stream`, tên gốc trong `X-Upload-Name`.
 * Đường DUY NHẤT gửi nhị phân — `http.request` vẫn chỉ gửi JSON.
 */
export type UploadOptions<S extends z.ZodType> = Readonly<{
  schema: S;
  body: Blob;
  /** Tên gốc của tệp — gửi `encodeURIComponent` (header chỉ chứa ASCII). */
  name: string;
  query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  signal?: AbortSignal;
  onProgress?: UploadProgress;
  /** Tệp lớn (chat 20 MB): token còn ít hơn ngần này ms ⇒ refresh TRƯỚC khi gửi. Avatar (~100 KB) không cần. */
  minTokenValidityMs?: number;
}>;

export const defaultCreateXhr: CreateXhr = () => new XMLHttpRequest();

/**
 * `application/octet-stream` KHÔNG thuộc nhóm Content-Type "safelisted" của CORS ⇒ trình duyệt vẫn preflight
 * như JSON — lớp chống CSRF của T-029 H2 còn nguyên; API chỉ nhận octet-stream ở đúng cặp method + path
 * (ADR-141, B M1).
 */
export function uploadHeaders(name: string, clientId: string, token: string | null): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/octet-stream',
    'X-Client-Id': clientId,
    'X-Upload-Name': encodeURIComponent(name),
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export type XhrRequest = Readonly<{
  method: 'PUT' | 'POST';
  url: URL;
  headers: Headers;
  body: Blob;
  signal?: AbortSignal | undefined;
  onProgress?: UploadProgress | undefined;
}>;

/** Tạo XHR — inject được để test (`HttpDeps.xhr`). */
export type CreateXhr = () => XMLHttpRequest;

const NO_BODY_STATUS = new Set([101, 204, 205, 304]);

/** `getAllResponseHeaders()` ⇒ Headers ("name: value" mỗi dòng, CRLF). */
function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    try {
      headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
    } catch {
      // tên header lạ ⇒ bỏ qua dòng đó
    }
  }
  return headers;
}

const abortError = () => new DOMException('Đã hủy tải lên.', 'AbortError');

/**
 * Gửi một lượt. Thành công (mọi status HTTP) ⇒ `Response` dựng lại để http.ts parse như fetch; lỗi mạng /
 * timeout ⇒ `TypeError` (như fetch); hủy ⇒ `DOMException` AbortError.
 */
export function sendViaXhr(createXhr: CreateXhr, req: XhrRequest): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    if (req.signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = createXhr();
    const onAbort = () => xhr.abort();
    const cleanup = () => req.signal?.removeEventListener('abort', onAbort);

    xhr.open(req.method, req.url.href);
    // Chỉ /auth/* cần cookie — upload không bao giờ gửi cookie (như `credentials: 'omit'` ở fetch).
    xhr.withCredentials = false;
    xhr.responseType = 'text';
    req.headers.forEach((value, name) => xhr.setRequestHeader(name, value));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) req.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      cleanup();
      req.onProgress?.(1);
      const status = xhr.status;
      const body = NO_BODY_STATUS.has(status) ? null : xhr.responseText;
      resolve(new Response(body, { status, headers: parseHeaders(xhr.getAllResponseHeaders()) }));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new TypeError('Lỗi mạng khi tải lên.'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    req.onProgress?.(0);
    xhr.send(req.body);
  });
}
