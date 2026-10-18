// T-070 — realtime trò chuyện qua gateway thật (ADR-145): event tới `user:{id}` của người nhận hiệu lực (tính lúc phát),
// `chat:read` DIRECT, `conversation:updated` theo góc nhìn từng người, bị bớt ⇒ `removed` + không nhận tin kế tiếp
// (SEC-CH-04), `chat:typing` cache quyền + nhịp 3 s (SEC-CH-19).
import type { AddressInfo } from 'node:net';

import type { ConversationDetailDto, MessageDto } from '@taskflow/contracts';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RealtimeGateway } from '../../src/core/realtime/gateway';
import { createHttpServer, listen } from '../../src/server';
import type { TestApp, TestUser } from '../support/http-app';
import { WEB } from '../support/http-app';
import { connected, emitWithAck, nextEvent, noEvent } from '../support/realtime';
import { SpyLogger } from '../support/spies';
import { SequentialIdGenerator } from '../support/time-and-ids';
import { api, chatApp, dataOf, nextMsgId, type ChatApp } from './chat-app';

let c: ChatApp;
let t: TestApp;
let a: ReturnType<typeof api>;
let url: string;
let close: () => Promise<void>;
const sockets: Socket[] = [];

beforeEach(async () => {
  c = await chatApp();
  t = c.t;
  a = api(t);
  const server = createHttpServer(t.app);
  const gateway = new RealtimeGateway(server, {
    corsOrigins: [WEB],
    trustProxyHops: 0,
    ...t.container.gateway,
    logger: new SpyLogger(),
    clock: t.clock,
    ids: new SequentialIdGenerator(),
  });
  t.container.realtime.bind(gateway);
  await listen(server, 0, '127.0.0.1');
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await close();
  await c.close();
});

/** Kết nối + chờ xác thực lại xong (ack đầu tiên chỉ trả sau `verified`). */
async function online(u: TestUser): Promise<Socket> {
  const socket = io(url, {
    transports: ['websocket'],
    auth: { token: u.token },
    extraHeaders: { origin: WEB },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await connected(socket);
  await emitWithAck(socket, 'project:join', {
    workspaceId: u.workspaceId,
    projectId: u.workspaceId,
  });
  return socket;
}

type Env<T> = { type: string; actorId: string; data: T };
const say = (by: TestUser, conversationId: string, body: string) =>
  a.send(by, 'post', `/chat/conversations/${conversationId}/messages`, {
    clientMsgId: nextMsgId(),
    body,
  });

describe('chat realtime (ADR-145)', () => {
  it('DIRECT: Vic nhận chat:message:new (đúng MessageDto + clientMsgId); người ngoài không; read ⇒ cả hai phía', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const otto = await t.register('Otto');
    const conv = dataOf<ConversationDetailDto>(
      await a.send(mia, 'post', '/chat/direct', { userId: vic.id }),
    );
    const [sMia, sVic, sOtto] = [await online(mia), await online(vic), await online(otto)];

    const got = nextEvent<Env<{ message: MessageDto }>>(sVic, 'chat:message:new');
    const silent = noEvent(sOtto, 'chat:message:new');
    const sent = dataOf<MessageDto>(await say(mia, conv.id, 'Chào Vic'));
    const ev = await got;
    expect([ev.actorId, ev.data.message]).toEqual([mia.id, sent]);
    expect(await silent).toBe(true);

    const read = nextEvent<Env<{ messageId: string; userId: string }>>(sMia, 'chat:read');
    await a.send(vic, 'put', `/chat/conversations/${conv.id}/read`, { messageId: sent.id });
    expect((await read).data).toEqual({
      conversationId: conv.id,
      userId: vic.id,
      messageId: sent.id,
    });
  });

  it('SEC-CH-04: bị bớt khỏi nhóm ⇒ chat:conversation:removed, KHÔNG nhận tin kế tiếp; người còn lại nhận updated theo góc nhìn mình', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const lan = await t.register('Lan');
    const g = dataOf<ConversationDetailDto>(
      await a.send(mia, 'post', '/chat/groups', { title: 'Sao Mai', memberIds: [vic.id, lan.id] }),
    );
    const [sVic, sLan] = [await online(vic), await online(lan)];

    const removed = nextEvent<Env<{ conversationId: string }>>(sLan, 'chat:conversation:removed');
    const updated = nextEvent<
      Env<{ conversation: { id: string; myRole: string; memberCount: number } }>
    >(sVic, 'chat:conversation:updated');
    await a.delete(mia, `/chat/conversations/${g.id}/members/${lan.id}`).expect(200);
    expect((await removed).data).toEqual({ conversationId: g.id });
    expect((await updated).data.conversation).toMatchObject({
      id: g.id,
      myRole: 'MEMBER',
      memberCount: 2,
    });

    const silent = noEvent(sLan, 'chat:message:new');
    const vicGets = nextEvent(sVic, 'chat:message:new');
    await say(mia, g.id, 'sau khi bớt Lan');
    await vicGets;
    expect(await silent).toBe(true);
  });

  it('SEC-CH-19: chat:typing tới người kia (không về mình); người ngoài gõ ⇒ không ai nhận; quá nhịp 3 s ⇒ bỏ', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic');
    const otto = await t.register('Otto');
    const conv = dataOf<ConversationDetailDto>(
      await a.send(mia, 'post', '/chat/direct', { userId: vic.id }),
    );
    const [sMia, sVic, sOtto] = [await online(mia), await online(vic), await online(otto)];

    const typing = nextEvent<Env<{ conversationId: string; userId: string }>>(sVic, 'chat:typing');
    const notSelf = noEvent(sMia, 'chat:typing');
    sMia.emit('chat:typing', { conversationId: conv.id });
    expect((await typing).data).toEqual({ conversationId: conv.id, userId: mia.id });
    expect(await notSelf).toBe(true);

    const throttled = noEvent(sVic, 'chat:typing');
    sMia.emit('chat:typing', { conversationId: conv.id }); // < 3 s (FakeClock đứng yên)
    expect(await throttled).toBe(true);

    const outsider = noEvent(sVic, 'chat:typing', 300);
    const outsiderMia = noEvent(sMia, 'chat:typing', 300);
    sOtto.emit('chat:typing', { conversationId: conv.id });
    sOtto.emit('chat:typing', { conversationId: 'không-phải-uuid' });
    expect([await outsider, await outsiderMia]).toEqual([true, true]);
  });
});
