import { randomUUID } from 'node:crypto';

import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect } from 'vitest';

import { useChatApi } from './harness/chat';
import { CHAT, ChatClient, type MessageDto } from './harness/chat-api';
import type { CompanyActor } from './harness/company';
import { collect, connected, disconnected, nextEvent, openSocket } from './harness/socket';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 6 — realtime trò chuyện (ADR-145, T-070 G; test-spec-chat §3–§4): SEC-CH-04s (vế socket của SEC-CH-04), 19
// (typing), CC-CH-01s (vế socket của CC-CH-01). Event tới room `user:{id}` của từng người nhận, sau commit. Typing:
// server cache quyền 5 s (CHAT_TYPING_ACCESS_CACHE_MS) ⇒ sau khi mất quyền typing còn tới tối đa 5 s, sau 6 s thì không;
// nhịp 1 typing / 3 s / socket (CHAT_TYPING_INTERVAL_MS).

const { api, actors } = useChatApi();
const chat = new ChatClient(actors);
const AREA = 'Mốc 6 trò chuyện — realtime (T-070)';
const QUIET_MS = 3_000;

interface Envelope<T> {
  type: string;
  data: T;
}

const sockets: Socket[] = [];
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});
async function live(who: CompanyActor): Promise<Socket> {
  const s = openSocket(api, who.accessToken);
  sockets.push(s);
  await connected(s);
  return s;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = () => randomUUID().slice(0, 6);
function day(n: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

describe('mất quyền ⇒ hết event', () => {
  secCase(
    'SEC-CH-04s',
    'socket mở sẵn: bị bớt khỏi nhóm / rời nhóm / bớt khỏi ws ⇒ nhận chat:conversation:removed, tin mới sau đó KHÔNG tới (3 s); typing của họ sau 6 s không tới người khác; nghỉ việc ⇒ socket bị ngắt',
    AREA,
    async () => {
      await flushRateLimitCounters();
      const mia = await actors.createUser(`rt4-mia-${tag()}`);
      const vic = await actors.createUser(`rt4-vic-${tag()}`);
      const otto = await actors.createUser(`rt4-otto-${tag()}`);
      const g = await chat.group(mia, `RT4-G-${tag()}`, [vic.userId, otto.userId]);
      const [miaS, vicS, ottoS] = await Promise.all([live(mia), live(vic), live(otto)]);

      // Trước khi mất quyền: Otto nhận tin của nhóm (đối chứng: kênh hoạt động).
      const firstSeen = nextEvent<Envelope<{ message: MessageDto }>>(ottoS, 'chat:message:new');
      await chat.send(mia, g.id, 'chào nhóm');
      expect((await firstSeen).data.message.conversationId).toBe(g.id);

      // (a) Otto bị bớt ⇒ removed; tin kế tiếp không tới.
      const removed = nextEvent<Envelope<{ conversationId: string }>>(
        ottoS,
        'chat:conversation:removed',
      );
      const r = await chat.call(mia, 'DELETE', CHAT.member(g.id, otto.userId));
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect((await removed).data.conversationId).toBe(g.id);
      const ottoMsgs = collect<Envelope<{ message: MessageDto }>>(ottoS, 'chat:message:new');
      await chat.send(mia, g.id, 'sau khi bớt Otto');
      await sleep(QUIET_MS);
      expect(ottoMsgs().filter((e) => e.data.message.conversationId === g.id)).toEqual([]);

      // Typing của Otto sau khi hết hạn cache quyền (6 s) không tới Mia / Vic.
      await sleep(6_000);
      const miaTyping = collect<Envelope<{ conversationId: string; userId: string }>>(
        miaS,
        'chat:typing',
      );
      const vicTyping = collect<Envelope<{ conversationId: string; userId: string }>>(
        vicS,
        'chat:typing',
      );
      ottoS.emit('chat:typing', { conversationId: g.id });
      await sleep(QUIET_MS);
      const fromOtto = (e: Envelope<{ userId: string }>) => e.data.userId === otto.userId;
      expect(miaTyping().filter(fromOtto)).toEqual([]);
      expect(vicTyping().filter(fromOtto)).toEqual([]);

      // (b) Vic tự rời ⇒ removed; tin kế tiếp không tới.
      const vicRemoved = nextEvent<Envelope<{ conversationId: string }>>(
        vicS,
        'chat:conversation:removed',
      );
      const left = await chat.call(vic, 'POST', CHAT.leave(g.id), {});
      expect(left.status).toBe(204);
      expect((await vicRemoved).data.conversationId).toBe(g.id);
      const vicMsgs = collect<Envelope<{ message: MessageDto }>>(vicS, 'chat:message:new');
      await chat.send(mia, g.id, 'sau khi Vic rời');
      await sleep(QUIET_MS);
      expect(vicMsgs().filter((e) => e.data.message.conversationId === g.id)).toEqual([]);

      // (c) ws: Max bị bớt khỏi ws ⇒ phòng ws removed; tin kế tiếp không tới.
      const max = await actors.createUser(`rt4-max-${tag()}`);
      const ws = await actors.newWorkspace(mia, `RT4-W-${tag()}`);
      await actors.addToWorkspace(mia, ws.id, max.userId, 'MEMBER');
      const room = await chat.wsRoom(mia, ws.id);
      const maxS = await live(max);
      const maxRemoved = nextEvent<Envelope<{ conversationId: string }>>(
        maxS,
        'chat:conversation:removed',
      );
      const out = await chat.call(mia, 'DELETE', `/workspaces/${ws.id}/members/${max.userId}`);
      expect([200, 204]).toContain(out.status);
      expect((await maxRemoved).data.conversationId).toBe(room.id);
      const maxMsgs = collect<Envelope<{ message: MessageDto }>>(maxS, 'chat:message:new');
      await chat.send(mia, room.id, 'sau khi bớt Max khỏi ws');
      await sleep(QUIET_MS);
      expect(maxMsgs().filter((e) => e.data.message.conversationId === room.id)).toEqual([]);

      // (d) nghỉ việc (hoàn tất trong request; lastDay −2 ⇒ access_until đã qua dù chạy trước 06:00) ⇒ socket bị ngắt.
      const hana = await actors.createUser(`rt4-hana-${tag()}`, {
        grants: ['HR_MANAGE'],
        startDate: day(-5),
      });
      const quinn = await actors.createUser(`rt4-quinn-${tag()}`, { startDate: day(-5) });
      const qd = await chat.direct(mia, quinn.userId);
      const quinnS = await live(quinn);
      const dropped = disconnected(quinnS, 10_000);
      await actors.offboard(hana, quinn.userId, day(-2));
      await dropped;
      await chat.sendRaw(mia, qd.id, { body: 'còn đó không?' }); // 422 RECIPIENT_INACTIVE — không cần khẳng định ở đây
    },
    60_000,
  );
});

describe('typing', () => {
  secCase(
    'SEC-CH-19',
    'Otto (người ngoài) phát chat:typing cho DIRECT Mia↔Vic ⇒ Mia, Vic không nhận; Mia phát 10 lần / s trong 3 s ⇒ Vic nhận ≤ 2 (nhịp 1 / 3 s); không về chính người phát',
    AREA,
    async () => {
      const mia = await actors.createUser(`rt19-mia-${tag()}`);
      const vic = await actors.createUser(`rt19-vic-${tag()}`);
      const otto = await actors.createUser(`rt19-otto-${tag()}`);
      const d = await chat.direct(mia, vic.userId);
      const [miaS, vicS, ottoS] = await Promise.all([live(mia), live(vic), live(otto)]);

      const miaSeen = collect<Envelope<{ userId: string }>>(miaS, 'chat:typing');
      const vicSeen = collect<Envelope<{ userId: string }>>(vicS, 'chat:typing');
      ottoS.emit('chat:typing', { conversationId: d.id });
      ottoS.emit('chat:typing', { conversationId: randomUUID() });
      await sleep(QUIET_MS);
      expect(miaSeen(), 'Mia nhận typing của người ngoài').toEqual([]);
      expect(vicSeen(), 'Vic nhận typing của người ngoài').toEqual([]);

      const vicFromMia = collect<Envelope<{ conversationId: string; userId: string }>>(
        vicS,
        'chat:typing',
      );
      const miaSelf = collect<Envelope<{ userId: string }>>(miaS, 'chat:typing');
      for (let i = 0; i < 30; i += 1) {
        miaS.emit('chat:typing', { conversationId: d.id });
        await sleep(100);
      }
      await sleep(500);
      const got = vicFromMia();
      expect(
        got.length,
        `Vic nhận ${String(got.length)} typing trong ~3,5 s`,
      ).toBeGreaterThanOrEqual(1);
      expect(got.length).toBeLessThanOrEqual(2);
      expect(got.every((e) => e.data.userId === mia.userId && e.data.conversationId === d.id)).toBe(
        true,
      );
      expect(miaSelf(), 'typing không về chính người phát').toEqual([]);
    },
    30_000,
  );
});

describe('đua', () => {
  secCase(
    'CC-CH-01s',
    '5 POST cùng clientMsgId song song ⇒ socket người nhận nhận đúng 1 chat:message:new cho clientMsgId đó (×5)',
    AREA,
    async () => {
      const mia = await actors.createUser(`rt1-mia-${tag()}`);
      const vic = await actors.createUser(`rt1-vic-${tag()}`);
      const d = await chat.direct(mia, vic.userId);
      const vicS = await live(vic);
      const red: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await flushRateLimitCounters();
        const clientMsgId = randomUUID();
        const seen = collect<Envelope<{ message: MessageDto }>>(vicS, 'chat:message:new');
        const res = await Promise.all(
          Array.from({ length: 5 }, () =>
            chat.call(mia, 'POST', CHAT.messages(d.id), { clientMsgId, body: `tin ${String(i)}` }),
          ),
        );
        await sleep(1_500);
        const mine = seen().filter((e) => e.data.message.clientMsgId === clientMsgId);
        const statuses = res.map((r) => r.status).sort();
        if (statuses.join(',') !== '200,200,200,200,201')
          red.push(`vòng ${String(i)}: ${statuses.join(',')}`);
        if (mine.length !== 1) red.push(`vòng ${String(i)}: Vic nhận ${String(mine.length)} event`);
      }
      expect(red).toEqual([]);
    },
    60_000,
  );
});
