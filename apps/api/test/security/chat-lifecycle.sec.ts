import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { useChatApi } from './harness/chat';
import { CHAT, ChatClient, dataOf, expectStatus, type ConversationDto } from './harness/chat-api';
import type { CompanyActor } from './harness/company';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';

// Mốc 6 — vòng đời người tham gia (test-spec-chat §3, ADR-143: tham gia hiệu lực khi `joined_at ≥
// company_members.created_at`): SEC-CH-04 (vế REST — vế socket ở chat-realtime.sec.ts, T-070), 28, 39. Mỗi ca tự tạo
// người / hội thoại (§0.2: ca đổi trạng thái không dùng bối cảnh chung).

const { actors } = useChatApi();
const chat = new ChatClient(actors);
const AREA = 'Mốc 6 trò chuyện — vòng đời (T-069)';

let hana: CompanyActor;

beforeAll(async () => {
  hana = await actors.createUser('cl-hana', { grants: ['HR_MANAGE'], startDate: day(-5) });
}, 60_000);

describe('mất quyền ⇒ mất hội thoại', () => {
  secCase(
    'SEC-CH-04',
    'vế REST: bị bớt khỏi ws ⇒ phòng ws 404 (đọc / gửi / PUT phòng); rời nhóm và bị bớt khỏi nhóm ⇒ nhóm 404; nghỉ việc ⇒ 401 mọi route chat — cùng token cũ',
    AREA,
    async () => {
      // (a) ws: Vic là MEMBER, có phòng; bị bớt ⇒ 404.
      const mia = await actors.createUser(`cl4-mia-${tag()}`);
      const vic = await actors.createUser(`cl4-vic-${tag()}`);
      const ws = await actors.newWorkspace(mia, `CL4-${tag()}`);
      await actors.addToWorkspace(mia, ws.id, vic.userId, 'MEMBER');
      const room = await chat.wsRoom(vic, ws.id);
      await chat.send(vic, room.id, 'Vic có mặt');
      const removed = await chat.call(mia, 'DELETE', `/workspaces/${ws.id}/members/${vic.userId}`);
      expect([200, 204], `bớt Vic khỏi ws: ${removed.text.slice(0, 200)}`).toContain(
        removed.status,
      );
      for (const [method, path, body] of [
        ['GET', CHAT.messages(room.id), undefined],
        ['POST', CHAT.messages(room.id), { clientMsgId: randomUUID(), body: 'còn không?' }],
        ['PUT', CHAT.wsRoom(ws.id), {}],
      ] as const) {
        expectStatus(
          await chat.call(vic, method, path, body),
          404,
          `Vic (đã bớt khỏi ws) ${method} ${path}`,
        );
      }
      expect(await chat.conversationIds(vic)).not.toContain(room.id);

      // (b) nhóm: Otto rời, Max bị bớt ⇒ 404 cả hai.
      const otto = await actors.createUser(`cl4-otto-${tag()}`);
      const max = await actors.createUser(`cl4-max-${tag()}`);
      const g = await chat.group(mia, `CL4-G-${tag()}`, [otto.userId, max.userId]);
      expectStatus(await chat.call(otto, 'POST', CHAT.leave(g.id), {}), 204, 'Otto rời nhóm');
      expectStatus(await chat.call(mia, 'DELETE', CHAT.member(g.id, max.userId)), 204, 'bớt Max');
      for (const who of [otto, max]) {
        expectStatus(await chat.call(who, 'GET', CHAT.messages(g.id)), 404, 'đọc nhóm sau khi ra');
        expectStatus(
          await chat.sendRaw(who, g.id, { body: 'xin vào lại' }),
          404,
          'gửi vào nhóm sau khi ra',
        );
        expect(await chat.conversationIds(who)).not.toContain(g.id);
      }

      // (c) nghỉ việc (hoàn tất trong request) ⇒ phiên bị thu hồi ⇒ 401.
      const quinn = await actors.createUser(`cl4-quinn-${tag()}`, { startDate: day(-3) });
      const qd = await chat.direct(quinn, mia.userId);
      await actors.offboard(hana, quinn.userId, day(-1));
      for (const path of [CHAT.conversations, CHAT.messages(qd.id), CHAT.unread]) {
        const r = await chat.call(quinn, 'GET', path);
        expectStatus(r, 401, `Quinn (đã nghỉ) GET ${path}`);
        expect(['UNAUTHORIZED', 'SESSION_REVOKED']).toContain(errorEnvelope(r).error.code);
      }
    },
  );

  secCase(
    'SEC-CH-28',
    'nghỉ việc rồi nhận lại: KHÔNG tự có lại nhóm cũ; DIRECT cũ hiện lại (cùng id, lịch sử còn); OWNER thêm lại vào nhóm ⇒ thấy nhóm + lịch sử',
    AREA,
    async () => {
      const mia = await actors.createUser(`cl28-mia-${tag()}`);
      const quinn = await actors.createUser(`cl28-quinn-${tag()}`, { startDate: day(-3) });
      const vic = await actors.createUser(`cl28-vic-${tag()}`);
      const g = await chat.group(mia, `CL28-G-${tag()}`, [quinn.userId, vic.userId]);
      await chat.send(mia, g.id, 'Tin trong nhóm trước khi Quinn nghỉ');
      const d = await chat.direct(mia, quinn.userId);
      await chat.send(quinn, d.id, 'Tin DIRECT cũ');

      await actors.offboard(hana, quinn.userId, day(-1));
      const rehired = await actors.hire(hana, { email: quinn.email, fullName: `Sec cl28-quinn` });
      expectStatus(rehired, 201, 'nhận lại Quinn');
      const back = await actors.login(quinn);

      const ids = await chat.conversationIds(back);
      expect(ids, 'nhóm cũ không tự có lại').not.toContain(g.id);
      expect(ids, 'DIRECT cũ hiện lại').toContain(d.id);
      expect((await chat.messages(back, d.id)).map((m) => m.body)).toContain('Tin DIRECT cũ');
      expectStatus(await chat.call(back, 'GET', CHAT.messages(g.id)), 404, 'đọc nhóm cũ');

      const again = await chat.direct(back, mia.userId);
      expect(again.id, 'POST chat/direct trả lại DIRECT cũ').toBe(d.id);

      expectStatus(
        await chat.call(mia, 'POST', CHAT.members(g.id), { userIds: [quinn.userId] }),
        204,
        'OWNER thêm lại Quinn',
      );
      expect(await chat.conversationIds(back)).toContain(g.id);
      expect((await chat.messages(back, g.id)).length).toBeGreaterThan(0);
    },
  );

  secCase(
    'SEC-CH-39',
    'phòng ws: VIEWER (vai trò dự án) là thành viên ws ⇒ đọc và GỬI được; người ngoài ws ⇒ 404; Admin không là thành viên ⇒ 404',
    AREA,
    async () => {
      const mia = await actors.createUser(`cl39-mia-${tag()}`);
      const max = await actors.createUser(`cl39-max-${tag()}`);
      const otto = await actors.createUser(`cl39-otto-${tag()}`);
      const ws = await actors.newWorkspace(mia, `CL39-${tag()}`);
      await actors.addToWorkspace(mia, ws.id, max.userId, 'VIEWER');
      const room: ConversationDto = await chat.wsRoom(max, ws.id);
      expect(room).toMatchObject({ kind: 'WORKSPACE', workspaceId: ws.id, canSend: true });
      const sent = await chat.send(max, room.id, 'VIEWER chào cả nhóm');
      expect((await chat.messages(mia, room.id)).map((m) => m.id)).toContain(sent.id);
      for (const who of [otto, actors.ada]) {
        expectStatus(await chat.call(who, 'PUT', CHAT.wsRoom(ws.id), {}), 404, 'ngoài ws mở phòng');
        expectStatus(
          await chat.call(who, 'GET', CHAT.messages(room.id)),
          404,
          'ngoài ws đọc phòng',
        );
      }
      expect(
        dataOf<{ total: number }>(await chat.call(mia, 'GET', CHAT.unread)).total,
      ).toBeGreaterThan(0);
    },
  );
});

function tag(): string {
  return randomUUID().slice(0, 6);
}
function day(n: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}
