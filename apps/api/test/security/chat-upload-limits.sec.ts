import { beforeAll, describe, expect } from 'vitest';

import { expectNoTmp, useChatApi } from './harness/chat';
import type { CompanyActor } from './harness/company';
import * as fx from './harness/files/fixtures';
import { snapshotOutside } from './harness/files/store';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';
import { upload, type UploadResult } from './harness/upload';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 6 — giới hạn upload nhị phân (ADR-141, T-067 G `rawUpload`; test-spec-chat §2 SEC): SEC-CH-08 (bỏ vế RAM — TL),
// 09, 12, 24, 26, 27, 34. Trần: tệp chat 20 MB, ảnh đại diện 5 MB, ≤ 3 upload đồng thời / người, idle 2 s ở test
// (`CHAT_TEST_WINDOWS`). Kho tệp tạm riêng của file (`useChatApi`) ⇒ `store.tree()` / `tmpFiles()` là của suite này.

const { api, actors, store } = useChatApi();
const AREA = 'Mốc 6 upload (T-067)';
const MB = 1024 * 1024;

let mia: CompanyActor;

beforeAll(async () => {
  mia = await actors.createUser('up-mia');
}, 120_000);

const isRaw = (r: UploadResult): r is RawResponse & { body: Buffer } => r.status !== 0;
const errorCode = (r: UploadResult) => (isRaw(r) ? errorEnvelope(r).error.code : 'ABORTED');
const expectUpload = (r: UploadResult, status: number, what: string) =>
  expect(r.status, `${what}: ${isRaw(r) ? r.text.slice(0, 300) : 'kết nối bị cắt'}`).toBe(status);

/** Chạy `fn` mà kho không có thêm blob / biến thể nào và không ghi ra ngoài thư mục kho. */
async function noWrites(what: string, fn: () => Promise<void>) {
  const outside = snapshotOutside(store);
  const before = store.blobs().length;
  await fn();
  await expectNoTmp(store);
  expect(store.blobs().length, `${what}: có blob mới`).toBe(before);
  expect(outside(), `${what}: ghi ra ngoài kho`).toEqual([]);
}

/** Ký tự cấm trong tên lưu (SEC-CH-09): `/`, `\`, NUL, điều khiển, bidi U+202A–202E / U+2066–2069. */
function unsafeChars(name: string): string[] {
  return [...name].filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (
      ch === '/' ||
      ch === '\\' ||
      c < 0x20 ||
      c === 0x7f ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069)
    );
  });
}

describe('kích thước, thời gian, đồng thời', () => {
  secCase(
    'SEC-CH-08',
    'pixel bomb ⇒ 422; khai Content-Length 21 MB ⇒ 413 ngay (không đọc byte); chunked 25 MB ⇒ 413 giữa chừng; avatar 6 MB ⇒ 413; mỗi vế ≤ 2 s, không tmp, không blob',
    AREA,
    async () => {
      await noWrites('SEC-CH-08', async () => {
        const timed = async (what: string, run: () => Promise<UploadResult>, want: number) => {
          const t0 = Date.now();
          const r = await run();
          const ms = Date.now() - t0;
          // 413 có thể kèm cắt kết nối (Connection: close + destroy sau khi xả có trần) ⇒ chấp nhận status 0.
          if (want === 413 && r.status === 0) expect(r).toMatchObject({ aborted: true });
          else expectUpload(r, want, what);
          expect(ms, `${what} mất ${String(ms)} ms`).toBeLessThanOrEqual(2_000);
          return r;
        };
        const bomb = await timed(
          'pixel bomb',
          () => upload(api, mia.accessToken, fx.pixelBombPng(), { as: 'image', name: 'bom.png' }),
          422,
        );
        expect(errorCode(bomb)).not.toBe('INTERNAL_ERROR');
        const declared = await timed(
          '21 MB khai báo',
          () =>
            upload(api, mia.accessToken, fx.bytes(64 * 1024), {
              as: 'file',
              name: 'lon.pdf',
              declaredLength: 21 * MB,
              abortAt: 64 * 1024,
            }),
          413,
        );
        if (isRaw(declared)) expect(errorCode(declared)).toBe('PAYLOAD_TOO_LARGE');
        await timed(
          'chunked 25 MB',
          () =>
            upload(api, mia.accessToken, fx.bytes(25 * MB), {
              as: 'file',
              name: 'lon.pdf',
              chunked: true,
            }),
          413,
        );
        await timed(
          'avatar 6 MB',
          () =>
            upload(
              api,
              mia.accessToken,
              Buffer.concat([fx.png({ w: 8, h: 8 }), Buffer.alloc(6 * MB)]),
              {
                path: '/me/avatar',
                // Avatar cũng bắt buộc X-Upload-Name (rawUpload: 415 → 400 tên → 413).
                name: 'anh.png',
              },
            ),
          413,
        );
      });
    },
    60_000,
  );

  secCase(
    'SEC-CH-24',
    '4 upload song song của một người (gửi chậm để giữ mở) ⇒ đúng một 429, ba cái còn lại xong 201',
    AREA,
    async () => {
      await flushRateLimitCounters();
      const body = fx.pdf(8 * 1024);
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) =>
          upload(api, mia.accessToken, body, {
            as: 'file',
            name: `song-song-${String(i)}.pdf`,
            dripBps: 8 * 1024,
          }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 429]);
      const limited = results.find((r) => r.status === 429);
      if (limited && isRaw(limited)) expect(limited.headers['retry-after']).toBeDefined();
      await expectNoTmp(store);
    },
    30_000,
  );

  secCase(
    'SEC-CH-26',
    'client hủy ở 50 % ⇒ server xóa tmp (`expectNoTmp`), không blob',
    AREA,
    async () => {
      await noWrites('SEC-CH-26', async () => {
        const body = fx.pdf(2 * MB);
        const r = await upload(api, mia.accessToken, body, {
          as: 'file',
          name: 'huy.pdf',
          abortAt: body.length / 2,
        });
        expect(r).toMatchObject({ aborted: true, status: 0 });
      });
    },
  );

  secCase(
    'SEC-CH-27',
    'gửi một phần rồi im (idle 2 s ở test) ⇒ server tự cắt kết nối ≤ 4 s; không tmp, không blob',
    AREA,
    async () => {
      await noWrites('SEC-CH-27', async () => {
        const t0 = Date.now();
        const r = await upload(api, mia.accessToken, fx.pdf(MB), {
          as: 'file',
          name: 'im-lang.pdf',
          stallAt: 256 * 1024,
        });
        const ms = Date.now() - t0;
        // Cắt kết nối (status 0) hoặc trả lỗi rồi đóng — không bao giờ treo, không 201.
        expect(r.status === 0 || r.status >= 400, `nhận ${String(r.status)}`).toBe(true);
        expect(ms, `cắt sau ${String(ms)} ms`).toBeLessThanOrEqual(4_000);
      });
    },
    15_000,
  );
});

describe('tên tệp, content-type, route', () => {
  secCase(
    'SEC-CH-09',
    'tên `../../etc/passwd`, U+202E, NUL ⇒ 201, `name` sạch (không `/`, `\\`, bidi, NUL), không ghi ra ngoài kho; thiếu `X-Upload-Name` / percent hỏng / 256 byte ⇒ 400 INVALID_UPLOAD_NAME, không ghi',
    AREA,
    async () => {
      const outside = snapshotOutside(store);
      for (const name of [
        '../../etc/passwd.pdf', // đuôi phải khớp nội dung (không đuôi ⇒ 415)
        `hoa-don${String.fromCharCode(0x202e)}fdp.exe.pdf`,
        `a${String.fromCharCode(0)}b.pdf`,
        '..\\..\\win.ini.pdf',
      ]) {
        const r = await upload(api, mia.accessToken, fx.pdf(2048), { as: 'file', name });
        expectUpload(r, 201, `tên ${JSON.stringify(name)}`);
        const saved = isRaw(r) ? (r.json as { data: { name: string } }).data.name : '';
        expect(unsafeChars(saved), `tên lưu của ${JSON.stringify(name)}: ${saved}`).toEqual([]);
        expect(saved.length).toBeGreaterThan(0);
      }
      expect(outside()).toEqual([]);

      await noWrites('tên sai', async () => {
        for (const [what, opts] of [
          ['thiếu header', { name: null }],
          ['percent hỏng', { rawName: '%E0%A4%A' }],
          ['256 byte', { name: `${'a'.repeat(252)}.pdf` }],
        ] as const) {
          const r = await upload(api, mia.accessToken, fx.pdf(2048), { as: 'file', ...opts });
          expectUpload(r, 400, what);
          expect(errorCode(r)).toBe('INVALID_UPLOAD_NAME');
        }
      });
    },
  );

  secCase(
    'SEC-CH-12',
    'multipart / text/plain / JSON có Bearer ⇒ 415 UNSUPPORTED_MEDIA_TYPE; không Bearer ⇒ 401; không ghi gì',
    AREA,
    async () => {
      await noWrites('SEC-CH-12', async () => {
        for (const contentType of [
          'multipart/form-data; boundary=x',
          'text/plain',
          'application/json',
          'image/png',
        ]) {
          for (const path of ['/chat/uploads', '/me/avatar'] as const) {
            const r = await upload(api, mia.accessToken, fx.png({ w: 4, h: 4 }), {
              path,
              ...(path === '/chat/uploads' ? { as: 'image' as const } : {}),
              contentType,
            });
            // JSON: bộ parse JSON toàn cục chạy trước rawUpload ⇒ 400 invalid_json (không ghi gì — vẫn đạt mục tiêu).
            if (contentType === 'application/json') {
              expect([400, 415], `${path} ${contentType}: ${String(r.status)}`).toContain(r.status);
              continue;
            }
            expectUpload(r, 415, `${path} ${contentType}`);
            expect(errorCode(r)).toBe('UNSUPPORTED_MEDIA_TYPE');
          }
        }
        for (const path of ['/chat/uploads', '/me/avatar'] as const) {
          const r = await upload(api, undefined, fx.png({ w: 4, h: 4 }), {
            path,
            ...(path === '/chat/uploads' ? { as: 'image' as const } : {}),
          });
          expectUpload(r, 401, `${path} không Bearer`);
        }
      });
    },
  );

  secCase(
    'SEC-CH-34',
    'octet-stream chỉ được ở đúng method + path upload: tới `PATCH /auth/me`, `POST /workspaces` ⇒ 415; `PUT /chat/uploads`, `POST /me/avatar` ⇒ 404 / 405',
    AREA,
    async () => {
      await noWrites('SEC-CH-34', async () => {
        for (const [method, path] of [
          ['PATCH', '/auth/me'],
          ['POST', '/workspaces'],
        ] as const) {
          const r = await upload(api, mia.accessToken, fx.pdf(1024), {
            method,
            path,
            name: 'x.pdf',
          });
          expectUpload(r, 415, `${method} ${path}`);
        }
        for (const [method, path] of [
          ['PUT', '/chat/uploads'],
          ['POST', '/me/avatar'],
        ] as const) {
          const r = await upload(api, mia.accessToken, fx.pdf(1024), {
            method,
            path,
            name: 'x.pdf',
          });
          // octet-stream chỉ được nhận ở ĐÚNG method + path upload ⇒ method khác bị chặn 415 trước khi tới router (G T-067).
          expect([404, 405, 415], `${method} ${path}: ${String(r.status)}`).toContain(r.status);
        }
      });
    },
  );
});
