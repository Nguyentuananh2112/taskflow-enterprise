import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi, type AvatarChange } from './index';

// Mock avatar (T-071) khó tính như API thật sẽ làm (avatar-chat.md ADR-141/142, SEC-CH-09/12/17/34): octet-stream chỉ
// ở đúng method + path, X-Upload-Name bắt buộc, sniff nội dung, 5 MB, gỡ của người khác theo vai trò, /media kiểm
// version + hạn mỗi lần, `user:avatar-changed`.

const BASE = 'http://localhost:4000/api/v1';
const PW = 'cay-tre-xanh-ven-song';
const T0 = Date.parse('2026-10-17T03:00:00.000Z');

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>');

type Json = { data: Record<string, unknown> | null; error?: { code: string } };

function setup() {
  let now = T0;
  const api = createMockApi(BASE, { now: () => now });
  const changes: AvatarChange[] = [];
  api.avatars.onChange((c) => changes.push(c));

  const raw = async (method: string, path: string, init: RequestInit = {}) => {
    const response = await getResponse(api.handlers, new Request(BASE + path, { method, ...init }));
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return response;
  };
  const json = async (response: Response) => {
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const upload = async (token: string, body: Uint8Array, headers: Record<string, string> = {}) =>
    json(
      await raw('PUT', '/me/avatar', {
        headers: {
          ...bearer(token),
          'content-type': 'application/octet-stream',
          'x-upload-name': encodeURIComponent('ảnh.jpg'),
          ...headers,
        },
        body: body.slice().buffer,
      }),
    );
  const call = async (method: string, path: string, token: string) =>
    json(
      await raw(method, path, {
        headers: { ...bearer(token), 'content-type': 'application/json' },
        body: method === 'GET' ? null : '{}',
      }),
    );

  const person = (email: string, fullName: string) => {
    const { user } = api.db.createUser({ email, password: PW, fullName });
    return { user, token: api.db.issueAccess(user).accessToken };
  };
  const mia = person('mia@example.com', 'Mia');
  const vic = person('vic@example.com', 'Vic');
  const hana = person('hana@example.com', 'Hana');
  const ada = person('ada@example.com', 'Ada');
  const kay = person('kay@example.com', 'Kay');
  api.db.company.setAccess(hana.user.id, 'EMPLOYEE', ['HR_MANAGE']);
  api.db.company.setAccess(ada.user.id, 'ADMIN');
  api.db.company.setAccess(kay.user.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
  return {
    api,
    raw,
    json,
    upload,
    call,
    changes,
    mia,
    vic,
    hana,
    ada,
    kay,
    tick: (ms: number) => (now += ms),
  };
}

describe('mock avatar — PUT/DELETE me/avatar', () => {
  it('JPEG/PNG/WebP ⇒ 200 {avatarUrl 64, avatarUrlLarge 256}; /auth/me có cả hai; version tăng; event', async () => {
    const { upload, call, changes, mia } = setup();
    for (const bytes of [JPEG, PNG, WEBP]) {
      const res = await upload(mia.token, bytes);
      expect(res.status).toBe(200);
    }
    const me = await call('GET', '/auth/me', mia.token);
    const user = (me.body.data as { user: Record<string, string> }).user;
    expect(user.avatarUrl).toMatch(
      new RegExp(`/media/avatars/${mia.user.id}/64\\?v=3&exp=\\d+&sig=mock$`),
    );
    expect(user.avatarUrlLarge).toContain(`/media/avatars/${mia.user.id}/256?v=3`);
    expect(changes).toHaveLength(3);
    expect(changes.at(-1)).toEqual({ userId: mia.user.id, avatarUrl: user.avatarUrl });
  });

  it('chưa có ảnh ⇒ /auth/me avatarUrl null (chữ cái)', async () => {
    const { call, mia } = setup();
    const me = await call('GET', '/auth/me', mia.token);
    expect((me.body.data as { user: Record<string, unknown> }).user.avatarUrl).toBeNull();
  });

  it('SEC-CH-34: JSON tới PUT me/avatar ⇒ 415; octet-stream tới route khác ⇒ 415', async () => {
    const { raw, json, mia } = setup();
    const asJson = await json(
      await raw('PUT', '/me/avatar', {
        headers: { authorization: `Bearer ${mia.token}`, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(asJson.status).toBe(415);
    const other = await json(
      await raw('PATCH', '/auth/me', {
        headers: {
          authorization: `Bearer ${mia.token}`,
          'content-type': 'application/octet-stream',
        },
        body: JPEG.slice().buffer,
      }),
    );
    expect(other.status).toBe(415);
  });

  it('SEC-CH-09: X-Upload-Name thiếu / hỏng / > 255 byte ⇒ 400 INVALID_UPLOAD_NAME', async () => {
    const { upload, raw, json, mia } = setup();
    const missing = await json(
      await raw('PUT', '/me/avatar', {
        headers: {
          authorization: `Bearer ${mia.token}`,
          'content-type': 'application/octet-stream',
        },
        body: JPEG.slice().buffer,
      }),
    );
    expect(missing.body.error?.code).toBe('INVALID_UPLOAD_NAME');
    expect((await upload(mia.token, JPEG, { 'x-upload-name': '%E0%A4%A' })).status).toBe(400);
    const long = encodeURIComponent('ả'.repeat(86)); // 86 × 3 byte = 258
    expect((await upload(mia.token, JPEG, { 'x-upload-name': long })).status).toBe(400);
  });

  it('nội dung không phải ảnh (HTML đuôi .jpg) ⇒ 415 UNSUPPORTED_FILE_TYPE; > 5 MB ⇒ 413', async () => {
    const { upload, mia } = setup();
    const html = await upload(mia.token, HTML);
    expect(html.status).toBe(415);
    expect(html.body.error?.code).toBe('UNSUPPORTED_FILE_TYPE');
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect((await upload(mia.token, big)).body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('không Bearer ⇒ 401; 11 lần / giờ ⇒ 429', async () => {
    const { raw, json, upload, mia } = setup();
    const anon = await json(
      await raw('PUT', '/me/avatar', {
        headers: { 'content-type': 'application/octet-stream', 'x-upload-name': 'a' },
        body: JPEG.slice().buffer,
      }),
    );
    expect(anon.status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await upload(mia.token, JPEG)).status).toBe(200);
    expect((await upload(mia.token, JPEG)).status).toBe(429);
  });

  it('DELETE me/avatar ⇒ 204, /auth/me về null, event avatarUrl null', async () => {
    const { upload, call, changes, mia } = setup();
    await upload(mia.token, JPEG);
    expect((await call('DELETE', '/me/avatar', mia.token)).status).toBe(204);
    const me = await call('GET', '/auth/me', mia.token);
    expect((me.body.data as { user: Record<string, unknown> }).user.avatarUrl).toBeNull();
    expect(changes.at(-1)).toEqual({ userId: mia.user.id, avatarUrl: null });
  });
});

describe('mock avatar — gỡ của người khác (SEC-CH-17)', () => {
  it('Mia→Vic 403; Hana→Ada / Kay (grant) / chính mình 403; Hana→Vic 204; Ada→Hana 204', async () => {
    const { upload, call, mia, vic, hana, ada, kay } = setup();
    for (const p of [vic, hana, ada, kay]) await upload(p.token, JPEG);
    const del = (actor: { token: string }, target: { user: { id: string } }) =>
      call('DELETE', `/hr/employees/${target.user.id}/avatar`, actor.token);
    expect((await del(mia, vic)).status).toBe(403);
    expect((await del(hana, ada)).status).toBe(403);
    expect((await del(hana, kay)).status).toBe(403);
    expect((await del(hana, hana)).status).toBe(403);
    expect((await del(hana, vic)).status).toBe(204);
    expect((await del(ada, hana)).status).toBe(204);
  });
});

describe('mock avatar — /media (ADR-141)', () => {
  it('URL đúng ⇒ byte ảnh + nosniff + sandbox; version cũ / hết hạn / sig sai ⇒ 404 HTML', async () => {
    const { api, raw, upload, mia, tick } = setup();
    await upload(mia.token, JPEG);
    const oldUrl = api.avatars.urlOf(mia.user.id, '64') ?? '';
    const path = (u: string) => u.slice(BASE.length);

    const okRes = await raw('GET', path(oldUrl));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('content-type')).toBe('image/jpeg');
    expect(okRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await okRes.arrayBuffer())).toEqual(JPEG);

    const badSig = await raw('GET', path(oldUrl.replace('sig=mock', 'sig=x')));
    expect(badSig.status).toBe(404);
    expect(badSig.headers.get('content-type')).toContain('text/html');

    await upload(mia.token, PNG); // version 2 ⇒ URL cũ chết ngay
    expect((await raw('GET', path(oldUrl))).status).toBe(404);

    const fresh = api.avatars.urlOf(mia.user.id, '256') ?? '';
    tick(49 * 3_600_000); // quá khung 24–48 giờ
    expect((await raw('GET', path(fresh))).status).toBe(404);
  });
});
