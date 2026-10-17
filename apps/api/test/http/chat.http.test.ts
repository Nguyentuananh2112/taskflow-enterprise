// T-069 — route chat thật (avatar-chat.md §4, ADR-143…146): hội thoại, tin, đọc, quyền 401 / 403 / 404 / 422.
import type { ConversationDetailDto, ConversationDto, MessageDto } from '@taskflow/contracts';
import {
  ChatPersonDto,
  ConversationDetailDto as Detail,
  MessageDto as Msg,
} from '@taskflow/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorOf } from '../support/http';
import type { TestApp, TestUser } from '../support/http-app';
import { api, chatApp, dataOf, nextMsgId, type ChatApp } from './chat-app';

let c: ChatApp;
let t: TestApp;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  c = await chatApp({ editWindowSeconds: 2 });
  t = c.t;
  a = api(t);
});
afterEach(() => c.close());

const direct = async (by: TestUser, to: TestUser) =>
  dataOf<ConversationDetailDto>(await a.send(by, 'post', '/chat/direct', { userId: to.id }));
const say = (by: TestUser, conversationId: string, body: string, clientMsgId = nextMsgId()) =>
  a.send(by, 'post', `/chat/conversations/${conversationId}/messages`, { clientMsgId, body });

describe('DIRECT + tin + đọc', () => {
  it('Mia→Vic: 201 rồi 200 (tạo-hoặc-lấy); gửi 201, gửi lại 200 cùng id; Vic thấy unread 1 → đọc → 0', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const res = await a.send(mia, 'post', '/chat/direct', { userId: vic.id });
    expect(res.status).toBe(201);
    const conv = Detail.strict().parse(dataOf(res));
    expect((await a.send(vic, 'post', '/chat/direct', { userId: mia.id })).status).toBe(200);

    const clientMsgId = nextMsgId();
    const sent = await say(mia, conv.id, '  Chào Vic  ', clientMsgId);
    expect(sent.status).toBe(201);
    const msg = Msg.strict().parse(dataOf(sent));
    expect(msg.body).toBe('Chào Vic');
    const again = await say(mia, conv.id, 'Chào Vic', clientMsgId);
    expect([again.status, dataOf<MessageDto>(again).id]).toEqual([200, msg.id]);
    const reused = await say(mia, conv.id, 'khác', clientMsgId);
    expect([reused.status, errorOf(reused).details]).toEqual([
      422,
      expect.objectContaining({ rule: 'IDEMPOTENCY_KEY_REUSED' }),
    ]);

    expect(dataOf<{ total: number }>(await a.get(vic, '/chat/unread-count')).total).toBe(1);
    const list = dataOf<ConversationDto[]>(await a.get(vic, '/chat/conversations'));
    expect(list[0]).toMatchObject({
      id: conv.id,
      unread: 1,
      peer: { id: mia.id },
      lastMessage: { id: msg.id },
    });
    const read = await a.send(vic, 'put', `/chat/conversations/${conv.id}/read`, {
      messageId: msg.id,
    });
    expect(read.status).toBe(204);
    expect(dataOf<{ total: number }>(await a.get(vic, '/chat/unread-count')).total).toBe(0);
    const page = await a.get(vic, `/chat/conversations/${conv.id}/messages`);
    expect([
      dataOf<MessageDto[]>(page).map((m) => m.id),
      (page.body as { meta: { page: { hasMore: boolean } } }).meta.page.hasMore,
    ]).toEqual([[msg.id], false]);
  });

  it('sửa trong cửa sổ (test 2 s) 200; tin người khác 404; xóa 204 ⇒ thân null', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const conv = await direct(mia, vic);
    const msg = dataOf<MessageDto>(await say(mia, conv.id, 'gốc'));
    const edited = await a.send(mia, 'patch', `/chat/messages/${msg.id}`, { body: 'đã sửa' });
    expect([edited.status, dataOf<MessageDto>(edited).body]).toEqual([200, 'đã sửa']);
    expect((await a.send(vic, 'patch', `/chat/messages/${msg.id}`, { body: 'x' })).status).toBe(
      404,
    );
    expect((await a.delete(vic, `/chat/messages/${msg.id}`)).status).toBe(404);
    expect((await a.delete(mia, `/chat/messages/${msg.id}`)).status).toBe(204);
    const page = dataOf<MessageDto[]>(await a.get(vic, `/chat/conversations/${conv.id}/messages`));
    expect(page[0]).toMatchObject({ body: null, deletedAt: expect.any(String) as string });
  });
});

describe('quyền (ADR-146)', () => {
  it('SEC-CH-01/03: Otto, Ada (Admin) với DIRECT Mia↔Vic ⇒ 404 mọi route; DB không đổi', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const ada = await t.register('Ada', undefined, { role: 'ADMIN', workspace: false });
    const otto = await t.register('Otto');
    const conv = await direct(mia, vic);
    const msg = dataOf<MessageDto>(await say(mia, conv.id, 'riêng tư'));
    for (const x of [otto, ada]) {
      const statuses = [
        (await a.get(x, `/chat/conversations/${conv.id}`)).status,
        (await a.get(x, `/chat/conversations/${conv.id}/messages`)).status,
        (await say(x, conv.id, 'chen')).status,
        (await a.send(x, 'put', `/chat/conversations/${conv.id}/read`, { messageId: msg.id }))
          .status,
        (await a.send(x, 'patch', `/chat/messages/${msg.id}`, { body: 'x' })).status,
        (await a.delete(x, `/chat/messages/${msg.id}`)).status,
      ];
      expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
    }
    const page = dataOf<MessageDto[]>(await a.get(mia, `/chat/conversations/${conv.id}/messages`));
    expect(page.map((m) => m.body)).toEqual(['riêng tư']);
  });

  it('không token ⇒ 401; rời công ty ⇒ 401 SESSION_REVOKED; body sai ⇒ 400; tự nhắn mình ⇒ 422 SELF_DIRECT', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    expect((await a.get({ ...mia, auth: {} } as TestUser, '/chat/conversations')).status).toBe(401);
    expect((await a.send(mia, 'post', '/chat/direct', { userId: 'x' })).status).toBe(400);
    const self = await a.send(mia, 'post', '/chat/direct', { userId: mia.id });
    expect([self.status, errorOf(self).details]).toEqual([
      422,
      expect.objectContaining({ rule: 'SELF_DIRECT' }),
    ]);
    t.companyStore.removeMember(vic.id);
    const gone = await a.get(vic, '/chat/conversations');
    expect([gone.status, errorOf(gone).code]).toEqual([401, 'SESSION_REVOKED']);
  });

  it('nhóm: thành viên thường đổi tên ⇒ 403; OWNER đổi tên 200; rời ⇒ 204 rồi 404', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const lan = await t.register('Lan');
    const res = await a.send(mia, 'post', '/chat/groups', {
      title: 'Dự án Sao Mai',
      memberIds: [vic.id, lan.id],
    });
    expect(res.status).toBe(201);
    const g = dataOf<ConversationDetailDto>(res);
    expect(g.members).toHaveLength(3);
    expect((await a.send(vic, 'patch', `/chat/conversations/${g.id}`, { title: 'x' })).status).toBe(
      403,
    );
    expect(
      (await a.send(mia, 'patch', `/chat/conversations/${g.id}`, { title: 'Sao Mai 2' })).status,
    ).toBe(200);
    expect((await a.send(lan, 'post', `/chat/conversations/${g.id}/leave`)).status).toBe(204);
    expect((await a.get(lan, `/chat/conversations/${g.id}`)).status).toBe(404);
  });

  it('SEC-CH-18: chat/people không email, không người chờ kích hoạt / đã rời; phòng ws cho thành viên ws', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const people = dataOf<ChatPersonDto[]>(await a.get(mia, '/chat/people?q=vic'));
    expect(people.map((p) => ChatPersonDto.strict().parse(p))).toEqual([
      { id: vic.id, fullName: 'Vic', avatarUrl: null },
    ]);
    t.companyStore.removeMember(vic.id);
    expect(dataOf<ChatPersonDto[]>(await a.get(mia, '/chat/people?q=vic'))).toEqual([]);
    const ws = await a.send(mia, 'put', `/chat/workspaces/${mia.workspaceId}/conversation`);
    expect([ws.status, dataOf<ConversationDetailDto>(ws).kind]).toEqual([201, 'WORKSPACE']);
    const other = await t.register('Otto');
    expect(
      (await a.send(other, 'put', `/chat/workspaces/${mia.workspaceId}/conversation`)).status,
    ).toBe(404);
  });
});
