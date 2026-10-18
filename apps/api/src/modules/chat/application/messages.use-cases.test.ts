import { beforeEach, describe, expect, it } from 'vitest';

import type { BusinessRuleViolationError } from '../../../core/errors';
import { ResourceNotFoundError } from '../../../core/errors';
import { NOW, U, aid, cmid, hex } from '../testing/chat-fixtures';
import { chatKit, urlOf, type ChatKit } from '../testing/chat-use-case-kit';
import { ConversationQueries } from './conversation.queries';
import { MessageCommands } from './message-commands.use-cases';
import { MessageQueries } from './message.queries';
import { OpenConversationUseCases } from './open-conversation.use-cases';
import { SendMessageUseCase } from './send-message.use-case';

const rule = (e: unknown) => (e as BusinessRuleViolationError).details?.rule;

let k: ChatKit;
let send: SendMessageUseCase;
let commands: MessageCommands;
let dm: string;
beforeEach(async () => {
  k = chatKit();
  k.staff();
  send = new SendMessageUseCase(k.deps);
  commands = new MessageCommands({ ...k.deps, editWindowSeconds: 900 });
  dm = (await new OpenConversationUseCases(k.deps).direct({ actorId: U.Mia, userId: U.Vic }))
    .conversation.id;
});

async function upload(n: number, uploaderId: string = U.Mia, kind: 'IMAGE' | 'FILE' = 'IMAGE') {
  await k.deps.uow.run(() =>
    k.deps.attachments.createUpload({
      id: aid(n),
      uploaderId,
      kind,
      name: `a${n}.png`,
      mime: 'image/png',
      sizeBytes: 10,
      sha256: hex('a'),
      width: kind === 'IMAGE' ? 4 : null,
      height: kind === 'IMAGE' ? 3 : null,
      fileKey: `f${n}`,
      previewKey: kind === 'IMAGE' ? `p${n}` : null,
      thumbKey: kind === 'IMAGE' ? `t${n}` : null,
      createdAt: NOW,
    }),
  );
}
const say = (
  body: string,
  n = 1,
  extra: Partial<Parameters<SendMessageUseCase['execute']>[0]> = {},
) =>
  send.execute({
    actorId: U.Mia,
    conversationId: dm,
    clientMsgId: cmid(n),
    body,
    attachmentIds: [],
    ...extra,
  });

describe('gửi tin (ADR-144)', () => {
  it('tạo tin + DTO đủ (người gửi có ảnh, đính kèm ảnh có URL ký) + event sau commit; người gửi đã đọc tin mình', async () => {
    await upload(1);
    const { created, message } = await say('Chào Vic', 1, { attachmentIds: [aid(1)] });
    expect(created).toBe(true);
    expect(message).toMatchObject({
      body: 'Chào Vic',
      sender: { id: U.Mia, fullName: 'Mia Trần' },
      attachments: [{ id: aid(1), kind: 'IMAGE', previewUrl: urlOf(aid(1), 'preview'), width: 4 }],
    });
    expect(k.notifier.messageCreated).toHaveBeenCalledOnce();
    const list = await new ConversationQueries(k.deps).list({
      userId: U.Vic,
      cursor: null,
      limit: 30,
    });
    expect(list.items[0]).toMatchObject({ unread: 1, lastMessage: { id: message.id } });
    const mine = await new ConversationQueries(k.deps).list({
      userId: U.Mia,
      cursor: null,
      limit: 30,
    });
    expect(mine.items[0]?.unread).toBe(0);
  });

  it('CH-15 / CC-CH-01: gửi lại GIỐNG (cả khi có đính kèm đã gắn) ⇒ tin cũ, không event lần 2; KHÁC ⇒ IDEMPOTENCY_KEY_REUSED', async () => {
    await upload(1);
    const first = await say('a', 1, { attachmentIds: [aid(1)] });
    const again = await say('a', 1, { attachmentIds: [aid(1)] });
    expect([again.created, again.message.id]).toEqual([false, first.message.id]);
    expect(k.notifier.messageCreated).toHaveBeenCalledOnce();
    await expect(say('khác', 1, { attachmentIds: [aid(1)] })).rejects.toSatisfy(
      (e) => rule(e) === 'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('SEC-CH-02: upload của người khác / đã gắn tin khác ⇒ 404, không ghi tin', async () => {
    await upload(2, U.Vic);
    await expect(say('x', 1, { attachmentIds: [aid(2)] })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    await upload(3);
    await say('y', 2, { attachmentIds: [aid(3)] });
    await expect(say('z', 3, { attachmentIds: [aid(3)] })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(k.state.data.messages.size).toBe(1);
  });

  it('11 đính kèm ⇒ TOO_MANY_ATTACHMENTS; trả lời tin hội thoại khác ⇒ REPLY_OTHER_CONVERSATION; người ngoài ⇒ 404', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => aid(100 + i));
    await expect(say('x', 1, { attachmentIds: ids })).rejects.toSatisfy(
      (e) => rule(e) === 'TOO_MANY_ATTACHMENTS',
    );
    const other = (
      await new OpenConversationUseCases(k.deps).direct({ actorId: U.Mia, userId: U.Lan })
    ).conversation.id;
    const there = await send.execute({
      actorId: U.Mia,
      conversationId: other,
      clientMsgId: cmid(9),
      body: 'ở chỗ khác',
      attachmentIds: [],
    });
    await expect(say('re', 2, { replyToId: there.message.id })).rejects.toSatisfy(
      (e) => rule(e) === 'REPLY_OTHER_CONVERSATION',
    );
    await expect(
      send.execute({
        actorId: U.Lan,
        conversationId: dm,
        clientMsgId: cmid(5),
        body: 'x',
        attachmentIds: [],
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('DIRECT: người kia đã nghỉ ⇒ 422 RECIPIENT_INACTIVE (vẫn đọc được lịch sử)', async () => {
    await say('trước khi nghỉ');
    k.dir.members.delete(U.Vic);
    await expect(say('sau', 2)).rejects.toSatisfy((e) => rule(e) === 'RECIPIENT_INACTIVE');
    const page = await new MessageQueries(k.deps).list({
      userId: U.Mia,
      conversationId: dm,
      limit: 50,
    });
    expect(page.items.map((m) => m.body)).toEqual(['trước khi nghỉ']);
  });
});

describe('sửa / xóa / đọc', () => {
  it('sửa trong cửa sổ ⇒ editedAt + event; quá cửa sổ ⇒ EDIT_WINDOW_PASSED; tin người khác ⇒ 404', async () => {
    const { message } = await say('gốc');
    const edited = await commands.edit({ actorId: U.Mia, messageId: message.id, body: 'sửa' });
    expect([edited.body, edited.editedAt]).toEqual(['sửa', NOW.toISOString()]);
    expect(k.notifier.messageUpdated).toHaveBeenCalledOnce();
    await expect(
      commands.edit({ actorId: U.Vic, messageId: message.id, body: 'x' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    k.setNow(new Date(NOW.getTime() + 901_000));
    await expect(
      commands.edit({ actorId: U.Mia, messageId: message.id, body: 'muộn' }),
    ).rejects.toSatisfy((e) => rule(e) === 'EDIT_WINDOW_PASSED');
  });

  it('xóa ⇒ thân null, đính kèm tách, blob xóa SAU commit; xóa lại idempotent; sửa tin đã xóa ⇒ 404', async () => {
    await upload(1);
    const { message } = await say('có ảnh', 1, { attachmentIds: [aid(1)] });
    await commands.delete({ actorId: U.Mia, messageId: message.id });
    expect(k.media.deleteBlobs).toHaveBeenCalledWith(['f1', 'p1', 't1']);
    await commands.delete({ actorId: U.Mia, messageId: message.id });
    expect(k.media.deleteBlobs).toHaveBeenCalledOnce();
    const page = await new MessageQueries(k.deps).list({
      userId: U.Vic,
      conversationId: dm,
      limit: 50,
    });
    expect(page.items[0]).toMatchObject({
      body: null,
      attachments: [],
      deletedAt: NOW.toISOString(),
    });
    await expect(
      commands.edit({ actorId: U.Mia, messageId: message.id, body: 'x' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(commands.delete({ actorId: U.Vic, messageId: message.id })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('CH-06: đọc chỉ tiến (event chỉ khi tiến); tin hội thoại khác ⇒ 404; unread-count bỏ hội thoại tắt tiếng', async () => {
    const m1 = (await say('1', 1)).message;
    k.setNow(new Date(NOW.getTime() + 1000));
    const m2 = (await say('2', 2)).message;
    const q = new ConversationQueries(k.deps);
    expect(await q.unreadCount(U.Vic)).toEqual({ total: 2 });
    await commands.markRead({ actorId: U.Vic, conversationId: dm, messageId: m2.id });
    await commands.markRead({ actorId: U.Vic, conversationId: dm, messageId: m1.id });
    expect(k.notifier.read).toHaveBeenCalledOnce();
    expect(await q.unreadCount(U.Vic)).toEqual({ total: 0 });
    await expect(
      commands.markRead({ actorId: U.Lan, conversationId: dm, messageId: m1.id }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('CH-08: trang tin keyset before / after, tăng dần, hasMore', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      k.setNow(new Date(NOW.getTime() + i * 1000));
      ids.push((await say(`m${i}`, 10 + i)).message.id);
    }
    const q = new MessageQueries(k.deps);
    const latest = await q.list({ userId: U.Vic, conversationId: dm, limit: 2 });
    expect([latest.items.map((m) => m.body), latest.hasMore]).toEqual([['m3', 'm4'], true]);
    const older = await q.list({ userId: U.Vic, conversationId: dm, before: ids[3], limit: 50 });
    expect([older.items.map((m) => m.body), older.hasMore]).toEqual([['m0', 'm1', 'm2'], false]);
    const after = await q.list({ userId: U.Vic, conversationId: dm, after: ids[1], limit: 2 });
    expect([after.items.map((m) => m.body), after.hasMore]).toEqual([['m2', 'm3'], true]);
  });
});
