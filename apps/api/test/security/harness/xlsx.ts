import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { expect } from 'vitest';

import type { ApiUnderTest } from './suite';
import { workbookViolations, type Workbook } from './xlsx-read';

/** Bộ đọc .xlsx thuần ở `xlsx-read.ts` (dùng chung với E2E); file này thêm `expect` + tải file cho suite bảo mật. */
export * from './xlsx-read';

export function expectSafeWorkbook(wb: Workbook, what = 'xlsx'): void {
  expect(workbookViolations(wb), what).toEqual([]);
}

// ---------------------------------------------------------------- Tải file

export interface Download {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** Body JSON (lỗi 4xx) hoặc `undefined`. */
  json: unknown;
  /** Kết nối bị server cắt giữa chừng (ADR-130 `socket.destroy()` — XL-06). */
  aborted: boolean;
}

/** GET nhị phân có Bearer (rawRequest đọc body thành utf8 ⇒ hỏng zip). */
export function download(
  api: ApiUnderTest,
  token: string | undefined,
  path: string,
  headers: Record<string, string> = {},
): Promise<Download> {
  const url = new URL(`/api/v1${path}`, api.baseUrl);
  const h: Record<string, string> = { origin: api.webOrigin, ...headers };
  if (token) h['authorization'] = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers: h, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let aborted = false;
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('aborted', () => (aborted = true));
      res.on('error', () => (aborted = true));
      res.on('close', () => {
        const body = Buffer.concat(chunks);
        let json: unknown;
        if (/json/.test(String(res.headers['content-type']))) {
          try {
            json = JSON.parse(body.toString('utf8'));
          } catch {
            json = undefined;
          }
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          json,
          aborted: aborted || !res.complete,
        });
      });
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code ?? '')) {
        resolve({ status: 0, headers: {}, body: Buffer.alloc(0), json: undefined, aborted: true });
      } else reject(err);
    });
    req.end();
  });
}

/** Header bắt buộc của export .xlsx (ADR-130, SEC-HR-52). */
export function expectXlsxHeaders(res: Download, filename: RegExp): void {
  expect(res.status, res.body.toString('utf8').slice(0, 200)).toBe(200);
  expect(res.headers['content-type']).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const cd = String(res.headers['content-disposition']);
  const name = /^attachment; filename="([^"]+)"$/.exec(cd)?.[1];
  expect(name, `Content-Disposition: ${cd}`).toMatch(filename);
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(String(res.headers['access-control-expose-headers'])).toMatch(/Content-Disposition/i);
}
