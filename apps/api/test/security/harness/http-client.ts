import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

/**
 * Client HTTP thô (node:http) — kiểm soát tuyệt đối header (Origin, Content-Type, Content-Encoding,
 * thiếu header…) mà `fetch` có thể tự thêm/chặn. Không theo redirect.
 */
export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  /** Body parse JSON; `undefined` nếu không phải JSON. */
  json: unknown;
}

export interface RawRequest {
  method?: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer | undefined;
}

export function rawRequest(baseUrl: string, req: RawRequest): Promise<RawResponse> {
  const url = new URL(req.path, baseUrl);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (value !== undefined) headers[key] = value;
  }
  if (req.body !== undefined && headers['content-length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(req.body));
  }

  return new Promise((resolve, reject) => {
    const client = httpRequest(
      url,
      { method: req.method ?? 'GET', headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
        res.on('error', reject);
      },
    );
    client.on('error', reject);
    if (req.body !== undefined) client.write(req.body);
    client.end();
  });
}

/** Envelope lỗi (data-and-api.md §3.1). */
export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> | null };
  meta: { timestamp: string; requestId: string | null };
}

export function errorEnvelope(res: RawResponse): ErrorEnvelope {
  const body = res.json as Partial<ErrorEnvelope> | undefined;
  if (!body || body.success !== false || !body.error) {
    throw new Error(`Không phải envelope lỗi (HTTP ${res.status}): ${res.text.slice(0, 500)}`);
  }
  return body as ErrorEnvelope;
}
