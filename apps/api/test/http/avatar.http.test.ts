// T-068 — ảnh đại diện qua route thật (ADR-142): PUT / DELETE /me/avatar, /media, gỡ của HR (SEC-CH-17), avatarUrl trong
// UserDto / MemberDto / EmployeeDto, người đã nghỉ ⇒ null (AV-04). Lưu trữ InMemory + kho tệp tạm + sharp THẬT.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EmployeeDto, MeResponse } from '@taskflow/contracts';
import { AvatarUploadResponseDto, MemberDto } from '@taskflow/contracts';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFiles, type FilesBundle } from '../../src/composition/files-setup';
import { loadEnv } from '../../src/config/env';
import type { ILogger } from '../../src/core/logging/logger';
import * as fx from '../security/harness/files/fixtures';
import { envelopeOf, errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';
import { testEnvVars } from '../support';

const noop = () => undefined;
const quiet = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
} as unknown as ILogger;

let dir: string;
let files: FilesBundle;
let t: TestApp;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tf-avatar-http-'));
  const env = loadEnv(testEnvVars({ FILE_STORE_DIR: dir, FILE_URL_SECRET: 'f'.repeat(40) }));
  t = createTestApp({}, { files: await filesFor(env) });
});
afterEach(async () => {
  await files.close();
  await rm(dir, { recursive: true, force: true });
});

async function filesFor(env: ReturnType<typeof loadEnv>) {
  // Đồng hồ của URL ký = giờ thật (TEST app dùng FakeClock cho phiên — URL `exp` chỉ cần nằm trong tương lai).
  files = await createFiles({
    env,
    clock: { now: () => new Date() },
    logger: quiet,
    webOrigin: 'http://w',
  });
  return files;
}

const putAvatar = (by: TestUser, body: Buffer, name = 'Ảnh của tôi.png') =>
  request(t.app)
    .put('/api/v1/me/avatar')
    .set(by.auth)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Upload-Name', encodeURIComponent(name))
    .send(body);
const me = async (by: TestUser) =>
  envelopeOf<MeResponse>(await request(t.app).get('/api/v1/auth/me').set(by.auth)).data;
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
async function blobs(userId: string): Promise<string[]> {
  const out: string[] = [];
  for await (const { key } of files.store.list(`avatars/${userId}/`))
    out.push(key.split('/').slice(2).join('/'));
  return out.sort();
}

describe('PUT /me/avatar (ADR-142)', () => {
  it('AV-01: version 1, 2, 3; chỉ còn blob của version 3; /auth/me có avatarUrl (64) + avatarUrlLarge (256)', async () => {
    const mia = await t.register('Mia');
    let last: AvatarUploadResponseDto | undefined;
    for (const v of [1, 2, 3]) {
      const res = await putAvatar(mia, fx.png({ w: 40, h: 30 }));
      expect(res.status).toBe(200);
      last = AvatarUploadResponseDto.parse(envelopeOf<AvatarUploadResponseDto>(res).data);
      expect(new URL(last.avatarUrl).pathname).toBe(`/api/v1/media/avatars/${mia.id}/64`);
      expect(new URL(last.avatarUrl).searchParams.get('v')).toBe(String(v));
    }
    expect(await blobs(mia.id)).toEqual(['3/256', '3/64']);
    const user = (await me(mia))?.user;
    expect(user?.avatarUrl).toBe(last?.avatarUrl);
    expect(user?.avatarUrlLarge).toBe(last?.avatarUrlLarge);
  });

  it('AV-02: /media trả WebP 64×64 / 256×256, không EXIF / GPS; URL version cũ 404 ngay', async () => {
    const mia = await t.register('Mia');
    const first = envelopeOf<AvatarUploadResponseDto>(
      await putAvatar(mia, fx.jpegWithGps({ w: 300, h: 200 }), 'a.jpg'),
    ).data;
    const res = await request(t.app)
      .get(pathOf(first?.avatarUrl ?? ''))
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['webp', 64, 64, undefined]);
    const large = await request(t.app)
      .get(pathOf(first?.avatarUrlLarge ?? ''))
      .buffer(true);
    expect((await sharp(large.body as Buffer).metadata()).width).toBe(256);
    await putAvatar(mia, fx.png({ w: 10, h: 10 }));
    expect((await request(t.app).get(pathOf(first?.avatarUrl ?? ''))).status).toBe(404);
  });

  it.each([
    ['PDF đổi tên', fx.pdf(), 'a.png', 415, 'UNSUPPORTED_FILE_TYPE'],
    ['SVG', fx.svgScript(), 'a.svg', 415, 'UNSUPPORTED_FILE_TYPE'],
    ['PNG hỏng', fx.pngMagicButCorrupt(), 'a.png', 422, 'BUSINESS_RULE_VIOLATION'],
  ] as const)('%s ⇒ %i %s, không ghi blob', async (_n, body, name, status, code) => {
    const mia = await t.register('Mia');
    const res = await putAvatar(mia, body, name);
    expect([res.status, errorOf(res).code]).toEqual([status, code]);
    expect(await blobs(mia.id)).toEqual([]);
  });

  it('6 MB ⇒ 413 (trần avatar 5 MB); thiếu X-Upload-Name ⇒ 400; không token ⇒ 401', async () => {
    const mia = await t.register('Mia');
    // Vượt trần drain ⇒ server có thể cắt socket trước khi client gửi xong (ECONNRESET) — cả hai đều là từ chối.
    const big = await putAvatar(mia, Buffer.alloc(6 * 1024 * 1024)).then(
      (r) => r.status,
      (e: NodeJS.ErrnoException) => e.code,
    );
    expect([413, 'ECONNRESET', 'EPIPE']).toContain(big);
    expect(await blobs(mia.id)).toEqual([]);
    const noName = await request(t.app)
      .put('/api/v1/me/avatar')
      .set(mia.auth)
      .set('Content-Type', 'application/octet-stream')
      .send(fx.png({ w: 2, h: 2 }));
    expect(errorOf(noName).code).toBe('INVALID_UPLOAD_NAME');
    const anon = await request(t.app)
      .put('/api/v1/me/avatar')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Upload-Name', 'a.png')
      .send(fx.png({ w: 2, h: 2 }));
    expect(anon.status).toBe(401);
  });

  it('không còn thuộc công ty ⇒ 401 SESSION_REVOKED (cổng công ty — ADR-146)', async () => {
    const mia = await t.register('Mia');
    t.companyStore.removeMember(mia.id);
    const res = await putAvatar(mia, fx.png({ w: 2, h: 2 }));
    expect([res.status, errorOf(res).code]).toEqual([401, 'SESSION_REVOKED']);
  });
});

describe('DELETE /me/avatar', () => {
  it('204; /auth/me null; URL cũ 404 ngay; blob GIỮ (D13 — 30 ngày); lặp lại vẫn 204', async () => {
    const mia = await t.register('Mia');
    const up = envelopeOf<AvatarUploadResponseDto>(
      await putAvatar(mia, fx.png({ w: 8, h: 8 })),
    ).data;
    expect((await request(t.app).delete('/api/v1/me/avatar').set(mia.auth)).status).toBe(204);
    expect((await me(mia))?.user.avatarUrl).toBeNull();
    expect((await request(t.app).get(pathOf(up?.avatarUrl ?? ''))).status).toBe(404);
    expect(await blobs(mia.id)).toEqual(['1/256', '1/64']);
    expect((await request(t.app).delete('/api/v1/me/avatar').set(mia.auth)).status).toBe(204);
    const again = envelopeOf<AvatarUploadResponseDto>(
      await putAvatar(mia, fx.png({ w: 8, h: 8 })),
    ).data;
    expect(new URL(again?.avatarUrl ?? '').searchParams.get('v')).toBe('2'); // không dùng lại v1 còn blob
  });
});

describe('avatarUrl trong DTO của module khác (ADR-142)', () => {
  it('MemberDto (thành viên ws) có ảnh; người đã nghỉ ⇒ null (AV-04)', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic', undefined, { workspace: false });
    await request(t.app)
      .post(`/api/v1/workspaces/${mia.workspaceId}/members`)
      .set(mia.auth)
      .set('Content-Type', 'application/json')
      .send({ userId: vic.id, role: 'MEMBER' });
    await putAvatar(mia, fx.png({ w: 4, h: 4 }));
    await putAvatar(vic, fx.png({ w: 4, h: 4 }));
    const list = async () =>
      envelopeOf<MemberDto[]>(
        await request(t.app).get(`/api/v1/workspaces/${mia.workspaceId}/members`).set(mia.auth),
      ).data ?? [];
    const before = await list();
    for (const m of before) expect(MemberDto.strict().parse(m)).toEqual(m);
    expect(before.every((m) => typeof m.avatarUrl === 'string')).toBe(true);
    t.companyStore.removeMember(vic.id); // đã nghỉ (không còn dòng company_members)
    expect((await list()).find((m) => m.userId === vic.id)?.avatarUrl).toBeNull();
  });
});

describe('DELETE /hr/employees/:userId/avatar (SEC-CH-17)', () => {
  it('ma trận: nhân viên thường ⇒ 403; HR gỡ Admin / người giữ grant / chính mình ⇒ 403; Admin gỡ HR ⇒ 204 + audit', async () => {
    const ada = await t.register('Ada', undefined, { role: 'ADMIN', workspace: false });
    const hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], workspace: false });
    const kay = await t.register('Kay', undefined, {
      grants: ['PAYROLL_MANAGE'],
      workspace: false,
    });
    const mia = await t.register('Mia', undefined, { workspace: false });
    const vic = await t.register('Vic', undefined, { workspace: false });
    for (const u of [hana, kay, mia, vic]) await putAvatar(u, fx.png({ w: 4, h: 4 }));
    const del = (by: TestUser, target: TestUser) =>
      request(t.app).delete(`/api/v1/hr/employees/${target.id}/avatar`).set(by.auth);
    expect((await del(mia, vic)).status).toBe(403);
    expect((await del(hana, ada)).status).toBe(403);
    expect((await del(hana, kay)).status).toBe(403);
    expect((await del(hana, hana)).status).toBe(403);
    expect((await del(hana, vic)).status).toBe(204);
    expect((await del(ada, hana)).status).toBe(204);
    const employees =
      envelopeOf<EmployeeDto[]>(await request(t.app).get('/api/v1/hr/employees').set(ada.auth))
        .data ?? [];
    const avatarOf = (u: TestUser) => employees.find((e) => e.userId === u.id)?.avatarUrl;
    expect([avatarOf(vic), avatarOf(hana), typeof avatarOf(mia)]).toEqual([null, null, 'string']);
    const audit = await t.persistence.company.hrAudit.list({ limit: 50 });
    const removed = audit.items.filter((a) => a.action === 'AVATAR_REMOVED');
    expect(removed.map((a) => [a.actorId, a.targetUserId])).toEqual(
      expect.arrayContaining([
        [hana.id, vic.id],
        [ada.id, hana.id],
      ]),
    );
    expect(removed).toHaveLength(2);
  });
});
