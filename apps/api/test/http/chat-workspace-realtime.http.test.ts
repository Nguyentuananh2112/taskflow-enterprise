// T-070 (TL) — mất quyền phòng chat của workspace ⇒ `chat:conversation:removed` tới ĐÚNG người mất quyền, sau commit:
// bị bớt / tự rời ws, ws xóa mềm. Chỉ id hội thoại (không nội dung). Phòng chưa mở ⇒ không phát.
import type { ConversationDetailDto, WorkspaceDto } from '@taskflow/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TestApp, TestUser } from '../support/http-app';
import { nextEvent, noEvent } from '../support/realtime';
import { api, chatApp, chatGateway, dataOf, type ChatApp } from './chat-app';

let c: ChatApp;
let t: TestApp;
let a: ReturnType<typeof api>;
let gw: Awaited<ReturnType<typeof chatGateway>>;
beforeEach(async () => {
  c = await chatApp();
  t = c.t;
  a = api(t);
  gw = await chatGateway(t);
});
afterEach(async () => {
  await gw.close();
  await c.close();
});

type Removed = { data: { conversationId: string } };

async function roomWith(owner: TestUser, ...members: TestUser[]) {
  for (const m of members) {
    await a
      .send(owner, 'post', `/workspaces/${owner.workspaceId}/members`, {
        userId: m.id,
        role: 'MEMBER',
      })
      .expect(201);
  }
  const res = await a.send(owner, 'put', `/chat/workspaces/${owner.workspaceId}/conversation`);
  return dataOf<ConversationDetailDto>(res);
}

describe('chat:conversation:removed khi mất quyền workspace (T-070)', () => {
  it('bị bớt khỏi ws ⇒ người đó nhận removed; người ở lại không nhận', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic', undefined, { workspace: false });
    const lan = await t.register('Lan', undefined, { workspace: false });
    const room = await roomWith(mia, vic, lan);
    const [sVic, sLan] = [await gw.online(vic), await gw.online(lan)];
    const removed = nextEvent<Removed>(sVic, 'chat:conversation:removed');
    const quiet = noEvent(sLan, 'chat:conversation:removed');
    await a.delete(mia, `/workspaces/${mia.workspaceId}/members/${vic.id}`).expect(200);
    expect((await removed).data).toEqual({ conversationId: room.id });
    expect(await quiet).toBe(true);
  });

  it('tự rời ws ⇒ removed tới chính mình', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic', undefined, { workspace: false });
    const room = await roomWith(mia, vic);
    const sVic = await gw.online(vic);
    const removed = nextEvent<Removed>(sVic, 'chat:conversation:removed');
    await a.delete(vic, `/workspaces/${mia.workspaceId}/members/${vic.id}`).expect(200);
    expect((await removed).data).toEqual({ conversationId: room.id });
  });

  it('ws xóa mềm ⇒ mọi thành viên nhận removed; phòng chưa mở ⇒ không phát', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic', undefined, { workspace: false });
    const room = await roomWith(mia, vic);
    const [sMia, sVic] = [await gw.online(mia), await gw.online(vic)];
    const both = Promise.all([
      nextEvent<Removed>(sMia, 'chat:conversation:removed'),
      nextEvent<Removed>(sVic, 'chat:conversation:removed'),
    ]);
    const ws = dataOf<WorkspaceDto>(await a.get(mia, `/workspaces/${mia.workspaceId}`));
    await a
      .delete(mia, `/workspaces/${mia.workspaceId}`)
      .send({ confirmSlug: ws.slug })
      .expect(200);
    expect((await both).map((e) => e.data.conversationId)).toEqual([room.id, room.id]);

    const otto = await t.register('Otto');
    const sOtto = await gw.online(otto);
    const none = noEvent(sOtto, 'chat:conversation:removed');
    const ottoWs = dataOf<WorkspaceDto>(await a.get(otto, `/workspaces/${otto.workspaceId}`));
    await a
      .delete(otto, `/workspaces/${otto.workspaceId}`)
      .send({ confirmSlug: ottoWs.slug })
      .expect(200);
    expect(await none).toBe(true);
  });
});
