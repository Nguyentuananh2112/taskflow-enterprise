import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import type { RawResponse } from './http-client';
import type { ApiUnderTest } from './suite';

/**
 * Upload nhị phân cho Mốc 6 (test-spec-chat §1.1, ADR-141): `application/octet-stream` + `X-Upload-Name`. `rawRequest`
 * chỉ gửi trọn body một lần ⇒ ở đây tự điều khiển luồng: chunked (không `Content-Length`), khai `Content-Length` sai,
 * hủy socket ở byte `abortAt`, gửi chậm `dripBps`.
 */
export interface UploadOptions {
  /** Mặc định `/chat/uploads`. */
  path?: string;
  /** Query `?as=` (chỉ `/chat/uploads`). */
  as?: 'image' | 'file';
  /** Tên gốc ⇒ `X-Upload-Name: encodeURIComponent(name)`; `null` ⇒ KHÔNG gửi header. */
  name?: string | null;
  /** Gửi nguyên chuỗi làm `X-Upload-Name` (ca percent-encoding hỏng). Ưu tiên hơn `name`. */
  rawName?: string;
  contentType?: string;
  /** Không `Content-Length` (Transfer-Encoding: chunked). */
  chunked?: boolean;
  /** Khai `Content-Length` khác độ dài thật. */
  declaredLength?: number;
  /** Hủy socket sau khi gửi đúng `abortAt` byte. */
  abortAt?: number;
  /** Gửi chậm (byte / giây) — giữ kết nối mở (SEC-CH-24). */
  dripBps?: number;
  /** Gửi đúng `stallAt` byte rồi NGỪNG (không end, không hủy) — server phải tự cắt theo idle timeout (SEC-CH-27). */
  stallAt?: number;
  method?: string;
  /** Header thêm (vd bỏ Bearer bằng `authorization: undefined`). */
  headers?: Record<string, string | undefined>;
}

export type UploadResult = RawResponse | { aborted: true; status: 0 };

const CHUNK = 64 * 1024;

export function upload(
  api: ApiUnderTest,
  token: string | undefined,
  body: Buffer,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const base = opts.path ?? '/chat/uploads';
  const query = opts.as ? `?as=${opts.as}` : '';
  const url = new URL(`/api/v1${base}${query}`, api.baseUrl);
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/octet-stream',
    origin: api.webOrigin,
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (opts.rawName !== undefined) headers['x-upload-name'] = opts.rawName;
  else if (opts.name !== null)
    headers['x-upload-name'] = encodeURIComponent(opts.name ?? 'tep.bin');
  if (!opts.chunked) headers['content-length'] = String(opts.declaredLength ?? body.length);
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === undefined) Reflect.deleteProperty(headers, k);
    else headers[k] = v;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (r: UploadResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const req = httpRequest(
      url,
      { method: opts.method ?? (base === '/me/avatar' ? 'PUT' : 'POST'), headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(toRaw(res.statusCode ?? 0, res.headers, Buffer.concat(chunks))));
        res.on('error', () => done({ aborted: true, status: 0 }));
      },
    );
    // Server cắt kết nối (413 sớm, timeout) ⇒ có thể không kịp có response: coi như bị cắt.
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code ?? '')) {
        done({ aborted: true, status: 0 });
      } else if (!settled) reject(err);
    });
    void pump(req, body, opts).catch(() => undefined);
  });
}

async function pump(
  req: ReturnType<typeof httpRequest>,
  body: Buffer,
  opts: UploadOptions,
): Promise<void> {
  const limit = opts.abortAt ?? opts.stallAt ?? body.length;
  const step = opts.dripBps ? Math.max(1, Math.floor(opts.dripBps / 4)) : CHUNK;
  for (let off = 0; off < limit; off += step) {
    if (req.destroyed) return;
    const piece = body.subarray(off, Math.min(off + step, limit));
    const ok = req.write(piece);
    if (!ok) await new Promise((r) => req.once('drain', r));
    if (opts.dripBps) await new Promise((r) => setTimeout(r, 250));
  }
  if (opts.abortAt !== undefined) {
    req.destroy();
    return;
  }
  if (opts.stallAt !== undefined) return;
  req.end();
}

function toRaw(
  status: number,
  headers: IncomingHttpHeaders,
  body: Buffer,
): RawResponse & { body: Buffer } {
  const text = body.toString('utf8');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status, headers, text, json, body };
}

/** GET `/media/...` (hoặc URL tuyệt đối do API trả) KHÔNG Bearer — trả cả byte. */
export function media(
  api: ApiUnderTest,
  signedUrl: string,
  headers: Record<string, string> = {},
): Promise<RawResponse & { body: Buffer }> {
  const url = new URL(signedUrl, api.baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(toRaw(res.statusCode ?? 0, res.headers, Buffer.concat(chunks))));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Tách URL ký (ADR-141): path + `v` / `exp` / `sig` — để ca SEC-CH-11 / 35 sửa từng phần. */
export function parseSignedUrl(signedUrl: string) {
  const url = new URL(signedUrl, 'http://placeholder.invalid');
  return {
    path: url.pathname,
    v: url.searchParams.get('v'),
    exp: url.searchParams.get('exp'),
    sig: url.searchParams.get('sig'),
    with(changes: Partial<Record<'path' | 'v' | 'exp' | 'sig', string>>): string {
      const next = new URL(url.toString());
      if (changes.path) next.pathname = changes.path;
      for (const k of ['v', 'exp', 'sig'] as const) {
        const value = changes[k];
        if (value !== undefined) next.searchParams.set(k, value);
      }
      return `${next.pathname}${next.search}`;
    },
  };
}
