import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock chat (T-072) khó tính như API thật sẽ làm (avatar-chat.md §4, ADR-141…146; ca SEC-CH-* phía mock).

const BASE = 'http://localhost:4000/api/v1';
const PW = 'cay-tre-xanh-ven-song';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x02,
  0x80, 0, 0, 0x01, 0xe0,
]);

type Json = {
  data: unknown;
  error?: { code: string; details?: { rule?: string } };
  meta: { page?: { hasMore: boolean } };
};

function setup() {
  let now = Date.parse('2026-10-18T03:00:00.000Z');
  const api = createMockApi(BASE, { now: () => now });
  const call = async (
    token: string,
    method: string,
    path: string,
    body?: unknown,
    raw?: { bytes: Uint8Array; name: string },
  ) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (raw) {
      headers['content-type'] = 'application/octet-stream';
      headers['x-upload-name'] = encodeURIComponent(raw.name);
    } else if (method !== 'GET') headers['content-type'] = 'application/json';
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers,
        ...(raw
          ? { body: raw.bytes.slice().buffer }
          : method === 'GET'
            ? {}
            : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('json');
    return {
      status: response.status,
      body: (isJson && text ? JSON.parse(text) : null) as Json,
      response,
    };
  };
  const person = (name: string) => {
    const { user } = api.db.createUser({
      email: `${name}-${crypto.randomUUID()}@example.com`,
      password: PW,
      fullName: name,
    });
    return { id: user.id, token: api.db.issueAccess(user).accessToken, user };
  };
  const mia = person('Mia');
  const vic = person('Vic');
  const otto = person('Otto');
  const ada = person('Ada');
  api.db.company.setAccess(ada.id, 'ADMIN');
  const data = <T>(r: { body: Json }) => r.body.data as T;
  const send = (p: { token: string }, convId: string, body: Record<string, unknown>) =>
    call(p.token, 'POST', `/chat/conversations/${convId}/messages`, {
      clientMsgId: crypto.randomUUID(),
      ...body,
    });
  const direct = async () =>
    data<{ id: string }>(await call(mia.token, 'POST', '/chat/direct', { userId: vic.id })).id;
  return {
    api,
    call,
    person,
    mia,
    vic,
    otto,
    ada,
    data,
    send,
    direct,
    tick: (ms: number) => (now += ms),
  };
}

describe('mock chat — DIRECT + IDOR (SEC-CH-01/03)', () => {
  it('tạo-hoặc-lấy; chính mình ⇒ SELF_DIRECT; người lạ / Admin đọc, gửi, đánh dấu ⇒ 404', async () => {
    const { call, mia, vic, otto, ada, send, direct, data } = setup();
    const id = await direct();
    // Như server T-069: 201 mới / 200 đã có, cả hai là ConversationDetailDto (có members).
    const again = await call(vic.token, 'POST', '/chat/direct', { userId: mia.id });
    expect(again.status).toBe(200);
    expect(data<{ id: string; members: unknown[] }>(again)).toMatchObject({ id });
    expect(data<{ members: Array<{ role: string }> }>(again).members).toEqual([
      expect.objectContaining({ role: 'MEMBER' }),
      expect.objectContaining({ role: 'MEMBER' }),
    ]);
    expect(
      (await call(mia.token, 'POST', '/chat/direct', { userId: mia.id })).body.error?.details?.rule,
    ).toBe('SELF_DIRECT');
    const sent = data<{ id: string }>(await send(mia, id, { body: 'chào Vic' }));
    for (const p of [otto, ada]) {
      expect((await call(p.token, 'GET', `/chat/conversations/${id}/messages`)).status).toBe(404);
      expect((await send(p, id, { body: 'x' })).status).toBe(404);
      expect(
        (await call(p.token, 'PUT', `/chat/conversations/${id}/read`, { messageId: sent.id }))
          .status,
      ).toBe(404);
      expect(
        (await call(p.token, 'PATCH', `/chat/messages/${sent.id}`, { body: 'sửa' })).status,
      ).toBe(404);
    }
  });

  it('chưa đọc: Vic thấy 1, đọc xong 0; tắt tiếng ⇒ bỏ khỏi tổng header', async () => {
    const { call, mia, vic, send, direct, data } = setup();
    const id = await direct();
    const m = data<{ id: string }>(await send(mia, id, { body: 'một' }));
    expect(data<{ total: number }>(await call(vic.token, 'GET', '/chat/unread-count')).total).toBe(
      1,
    );
    await call(vic.token, 'PUT', `/chat/conversations/${id}/mute`, { muted: true });
    expect(data<{ total: number }>(await call(vic.token, 'GET', '/chat/unread-count')).total).toBe(
      0,
    );
    await call(vic.token, 'PUT', `/chat/conversations/${id}/read`, { messageId: m.id });
    const list = data<Array<{ unread: number; muted: boolean }>>(
      await call(vic.token, 'GET', '/chat/conversations'),
    );
    expect(list[0]).toMatchObject({ unread: 0, muted: true });
  });
});

describe('mock chat — tin nhắn (ADR-144)', () => {
  it('idempotent: cùng clientMsgId + giống ⇒ 200 tin cũ; khác ⇒ 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { mia, send, direct, data } = setup();
    const id = await direct();
    const clientMsgId = crypto.randomUUID();
    const first = await send(mia, id, { clientMsgId, body: 'a' });
    expect(first.status).toBe(201);
    const again = await send(mia, id, { clientMsgId, body: 'a' });
    expect(again.status).toBe(200);
    expect(data<{ id: string }>(again).id).toBe(data<{ id: string }>(first).id);
    expect((await send(mia, id, { clientMsgId, body: 'b' })).body.error?.details?.rule).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('sửa ≤ 15 phút; quá ⇒ EDIT_WINDOW_PASSED; người khác sửa/xóa ⇒ 404 (SEC-CH-16)', async () => {
    const { api, call, mia, vic, send, direct, data, tick } = setup();
    const id = await direct();
    const m = data<{ id: string }>(await send(mia, id, { body: 'gốc' }));
    expect((await call(vic.token, 'DELETE', `/chat/messages/${m.id}`)).status).toBe(404);
    const edited = await call(mia.token, 'PATCH', `/chat/messages/${m.id}`, { body: 'đã sửa' });
    expect(data<{ editedAt: string | null }>(edited).editedAt).not.toBeNull();
    tick(15 * 60_000 + 1);
    const fresh = api.db.issueAccess(mia.user).accessToken; // token cũ đã hết hạn sau 15 phút
    expect(
      (await call(fresh, 'PATCH', `/chat/messages/${m.id}`, { body: 'muộn' })).body.error?.details
        ?.rule,
    ).toBe('EDIT_WINDOW_PASSED');
  });

  it('keyset: trang mới nhất + hasMore; before ⇒ trang cũ hơn; after ⇒ bù khi nối lại', async () => {
    const { call, mia, send, direct, data } = setup();
    const id = await direct();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(data<{ id: string }>(await send(mia, id, { body: `tin ${i}` })).id);
    const latest = await call(mia.token, 'GET', `/chat/conversations/${id}/messages?limit=2`);
    expect(data<Array<{ id: string }>>(latest).map((m) => m.id)).toEqual(ids.slice(3));
    expect(latest.body.meta.page?.hasMore).toBe(true);
    const older = await call(
      mia.token,
      'GET',
      `/chat/conversations/${id}/messages?limit=2&before=${ids[3]}`,
    );
    expect(data<Array<{ id: string }>>(older).map((m) => m.id)).toEqual(ids.slice(1, 3));
    const after = await call(
      mia.token,
      'GET',
      `/chat/conversations/${id}/messages?after=${ids[1]}`,
    );
    expect(data<Array<{ id: string }>>(after).map((m) => m.id)).toEqual(ids.slice(2));
  });

  it('ảnh: upload ⇒ gắn ⇒ URL ký xem được; xóa tin ⇒ URL ảnh 404 ngay (SEC-CH-22); gắn upload người khác ⇒ 404', async () => {
    const { api, call, mia, vic, send, direct, data } = setup();
    const id = await direct();
    const up = data<{ uploadId: string; width: number; height: number }>(
      await call(mia.token, 'POST', '/chat/uploads?as=image', undefined, {
        bytes: PNG,
        name: 'ảnh.png',
      }),
    );
    expect(up).toMatchObject({ width: 640, height: 480 });
    expect((await send(vic, id, { attachmentIds: [up.uploadId] })).status).toBe(404);
    const m = data<{ id: string; attachments: Array<{ previewUrl: string }> }>(
      await send(mia, id, { attachmentIds: [up.uploadId] }),
    );
    const media = m.attachments[0]?.previewUrl.slice(BASE.length) ?? '';
    expect((await call(vic.token, 'GET', media)).status).toBe(200);
    // download-url chỉ cho FILE — ảnh đã có URL ký sẵn ⇒ 404 (T-069).
    expect(
      (await call(vic.token, 'POST', `/chat/attachments/${up.uploadId}/download-url`)).status,
    ).toBe(404);
    await call(mia.token, 'DELETE', `/chat/messages/${m.id}`);
    expect((await call(vic.token, 'GET', media)).status).toBe(404);
    expect(api.chat.messages.uploads.has(up.uploadId)).toBe(false);
  });

  it('tệp: PDF ⇒ download-url 60 s, attachment + filename*; HTML / EXE / ZIP thuần ⇒ 415; .docm ⇒ MACRO', async () => {
    const { call, mia, vic, otto, send, direct, data, tick } = setup();
    const id = await direct();
    const pdf = new TextEncoder().encode('%PDF-1.7 ...');
    const up = data<{ uploadId: string }>(
      await call(mia.token, 'POST', '/chat/uploads?as=file', undefined, {
        bytes: pdf,
        name: 'Báo cáo.pdf',
      }),
    );
    await send(mia, id, { body: 'tệp', attachmentIds: [up.uploadId] });
    expect(
      (await call(otto.token, 'POST', `/chat/attachments/${up.uploadId}/download-url`)).status,
    ).toBe(404);
    const { url } = data<{ url: string }>(
      await call(vic.token, 'POST', `/chat/attachments/${up.uploadId}/download-url`),
    );
    const file = await call(vic.token, 'GET', url.slice(BASE.length));
    expect(file.response.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('Báo cáo.pdf')}`,
    );
    tick(61_000);
    expect((await call(vic.token, 'GET', url.slice(BASE.length))).status).toBe(404);
    const reject = async (bytes: Uint8Array, name: string) =>
      (await call(mia.token, 'POST', '/chat/uploads?as=file', undefined, { bytes, name })).body
        .error?.code;
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(await reject(enc('<!doctype html><script>'), 'a.txt')).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await reject(enc('MZ\x90\x00'), 'a.pdf')).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await reject(enc('PK\x03\x04....'), 'a.zip')).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await reject(enc('PK\x03\x04vbaProject.bin'), 'a.docx')).toBe('MACRO_OR_ACTIVE_CONTENT');
  });

  it('11 đính kèm ⇒ 422 TOO_MANY_ATTACHMENTS (không phải 400)', async () => {
    const { call, mia, send, direct, data } = setup();
    const id = await direct();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      ids.push(
        data<{ uploadId: string }>(
          await call(mia.token, 'POST', '/chat/uploads?as=image', undefined, {
            bytes: PNG,
            name: `${i}.png`,
          }),
        ).uploadId,
      );
    }
    expect((await send(mia, id, { attachmentIds: ids })).body.error?.details?.rule).toBe(
      'TOO_MANY_ATTACHMENTS',
    );
  });
});

describe('mock chat — nhóm, phòng ws, danh bạ (ADR-143)', () => {
  it('nhóm: thành viên thường quản trị ⇒ 403; thêm người chờ kích hoạt ⇒ NOT_ACTIVE_MEMBER; bị bớt ⇒ 404 cả lịch sử', async () => {
    const { api, call, mia, vic, otto, data } = setup();
    const group = data<{ id: string; myRole: string }>(
      await call(mia.token, 'POST', '/chat/groups', {
        title: 'Dự án Sao Mai',
        memberIds: [vic.id, otto.id],
      }),
    );
    expect(group.myRole).toBe('OWNER');
    expect(
      (await call(vic.token, 'PATCH', `/chat/conversations/${group.id}`, { title: 'x' })).status,
    ).toBe(403);
    const { user: pending } = api.db.createUser({
      email: `p-${crypto.randomUUID()}@example.com`,
      password: '',
      fullName: 'Chờ',
    });
    const added = await call(mia.token, 'POST', `/chat/conversations/${group.id}/members`, {
      userIds: [pending.id],
    });
    expect(added.body.error?.details?.rule).toBe('NOT_ACTIVE_MEMBER');
    await call(mia.token, 'DELETE', `/chat/conversations/${group.id}/members/${otto.id}`);
    expect((await call(otto.token, 'GET', `/chat/conversations/${group.id}/messages`)).status).toBe(
      404,
    );
  });

  it('phòng ws: VIEWER gửi được; rời ws ⇒ 404; ws xóa mềm ⇒ 404 với mọi người', async () => {
    const { api, call, mia, vic, send, data } = setup();
    const wsId = api.db.createWorkspace('Kho Bắc', undefined, mia.id);
    const membership = api.db.membershipIn(mia.id, wsId)!;
    api.db.setMembership(vic.id, membership, 'VIEWER');
    const created = await call(vic.token, 'PUT', `/chat/workspaces/${wsId}/conversation`);
    expect(created.status).toBe(201);
    const room = data<{ id: string; title: string; memberCount: number }>(created);
    expect(room).toMatchObject({ title: 'Kho Bắc', memberCount: 2 });
    const reopened = await call(mia.token, 'PUT', `/chat/workspaces/${wsId}/conversation`);
    expect(reopened.status).toBe(200);
    expect(data<{ id: string; members: unknown[] }>(reopened).members).toHaveLength(2);
    expect((await send(vic, room.id, { body: 'viewer nói' })).status).toBe(201);
    api.db.workspaces.removeMember(wsId, vic.id);
    expect((await send(vic, room.id, { body: 'x' })).status).toBe(404);
    api.db.workspaces.softDelete(wsId);
    expect((await call(mia.token, 'GET', `/chat/conversations/${room.id}`)).status).toBe(404);
  });

  it('danh bạ: không email, không người chờ kích hoạt / đã rời (SEC-CH-18)', async () => {
    const { api, call, mia, data } = setup();
    api.db.createUser({
      email: `c-${crypto.randomUUID()}@example.com`,
      password: '',
      fullName: 'Mia Chờ',
    });
    const people = data<Array<Record<string, unknown>>>(
      await call(mia.token, 'GET', '/chat/people?q=mia'),
    );
    expect(people.map((p) => p.fullName)).toEqual(['Mia']);
    expect(Object.keys(people[0] ?? {})).not.toContain('email');
  });

  it('nghỉ việc rồi nhận lại: không thấy nhóm cũ; DIRECT cũ hiện lại (SEC-CH-28)', async () => {
    const { api, call, mia, vic, data, direct } = setup();
    const dm = await direct();
    const group = data<{ id: string }>(
      await call(mia.token, 'POST', '/chat/groups', {
        title: 'Nhóm',
        memberIds: [vic.id, api.db.company.members()[0]![0]],
      }),
    );
    api.db.company.remove(vic.id);
    api.db.company.add(vic.id, new Date(Date.parse('2026-10-18T04:00:00.000Z')).toISOString());
    const ids = data<Array<{ id: string }>>(
      await call(vic.token, 'GET', '/chat/conversations'),
    ).map((c) => c.id);
    expect(ids).toContain(dm);
    expect(ids).not.toContain(group.id);
  });
});
