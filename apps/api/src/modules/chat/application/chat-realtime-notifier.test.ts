import { describe, expect, it } from 'vitest';

import { NOW, U } from '../testing/chat-fixtures';
import { chatKit } from '../testing/chat-use-case-kit';
import { ChatRealtimeNotifier, type IChatEventSink } from './chat-realtime-notifier';
import { OpenConversationUseCases } from './open-conversation.use-cases';

type Emitted = Parameters<IChatEventSink['emitChat']>[0];

function setup() {
  const k = chatKit();
  k.staff();
  const emitted: Emitted[] = [];
  const sink: IChatEventSink = { emitChat: (e) => (emitted.push(e), Promise.resolve()) };
  const n = new ChatRealtimeNotifier({ ...k.deps, sink });
  const open = new OpenConversationUseCases(k.deps);
  return { k, n, emitted, open };
}
const sorted = (ids: readonly string[]) => [...ids].sort();

describe('ChatRealtimeNotifier (ADR-145, T-070)', () => {
  it('tin mới tới người nhận hiệu lực TÍNH LÚC PHÁT: hết access_until ⇒ không nhận (SEC-CH-05)', async () => {
    const { k, n, emitted, open } = setup();
    const g = (await open.group({ actorId: U.Mia, title: 'g', memberIds: [U.Vic, U.Lan] }))
      .conversation;
    k.dir.members.set(U.Lan, { createdAt: NOW, offboardAccessUntil: new Date(NOW.getTime() - 1) });
    await n.messageCreated({ conversationId: g.id, message: {} as never, actorId: U.Mia });
    expect(emitted[0]?.type).toBe('chat:message:new');
    expect(sorted(emitted[0]!.userIds)).toEqual(sorted([U.Mia, U.Vic]));
  });

  it('chat:read: DIRECT ⇒ cả hai; GROUP ⇒ chỉ chính người đọc (v1 không lộ ai đã xem)', async () => {
    const { n, emitted, open } = setup();
    const dm = (await open.direct({ actorId: U.Mia, userId: U.Vic })).conversation;
    const g = (await open.group({ actorId: U.Mia, title: 'g', memberIds: [U.Vic, U.Lan] }))
      .conversation;
    await n.read({ conversationId: dm.id, userId: U.Vic, messageId: dm.id });
    await n.read({ conversationId: g.id, userId: U.Vic, messageId: g.id });
    expect(sorted(emitted[0]!.userIds)).toEqual(sorted([U.Mia, U.Vic]));
    expect(emitted[1]!.userIds).toEqual([U.Vic]);
  });

  it('conversation:updated: một lần phát / người, DTO theo góc nhìn người đó (myRole)', async () => {
    const { n, emitted, open } = setup();
    const g = (await open.group({ actorId: U.Mia, title: 'g', memberIds: [U.Vic, U.Lan] }))
      .conversation;
    await n.conversationUpdated({ conversationId: g.id, actorId: U.Mia });
    const byUser = new Map(
      emitted.map((e) => [
        e.userIds[0],
        (e.data as { conversation: { myRole: string } }).conversation.myRole,
      ]),
    );
    expect(emitted.every((e) => e.userIds.length === 1)).toBe(true);
    expect(Object.fromEntries(byUser)).toEqual({
      [U.Mia]: 'OWNER',
      [U.Vic]: 'MEMBER',
      [U.Lan]: 'MEMBER',
    });
  });

  it('typingRecipients: người ngoài ⇒ null; người tham gia ⇒ danh sách hiệu lực', async () => {
    const { n, open } = setup();
    const dm = (await open.direct({ actorId: U.Mia, userId: U.Vic })).conversation;
    expect(await n.typingRecipients(dm.id, U.Lan)).toBeNull();
    expect(sorted((await n.typingRecipients(dm.id, U.Mia)) ?? [])).toEqual(sorted([U.Mia, U.Vic]));
  });
  it('workspaceAccessLost: phòng ws đã mở ⇒ removed tới đúng người mất quyền; chưa mở ⇒ không phát', async () => {
    const { k, n, emitted, open } = setup();
    const WS = '00000000-0000-7000-8000-00000000c0a1';
    await n.workspaceAccessLost({ workspaceId: WS, userIds: [U.Vic], actorId: U.Mia });
    expect(emitted).toEqual([]);
    k.dir.workspaces.set(WS, { name: 'Sao Mai', active: true, memberIds: [U.Mia, U.Vic] });
    const room = (await open.workspace({ actorId: U.Mia, workspaceId: WS })).conversation;
    await n.workspaceAccessLost({ workspaceId: WS, userIds: [U.Vic], actorId: U.Mia });
    expect(emitted).toEqual([
      {
        userIds: [U.Vic],
        type: 'chat:conversation:removed',
        data: { conversationId: room.id },
        meta: { actorId: U.Mia },
      },
    ]);
  });
});
