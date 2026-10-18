import type { MessageDto } from '@taskflow/contracts/chat';
import { describe, expect, it } from 'vitest';

import {
  appendMessages,
  dropMessage,
  flatten,
  newestMessage,
  upsertMessage,
  type MessagesData,
} from './message-cache';

const MIA = { id: '00000000-0000-4000-8000-00000000000a', fullName: 'Mia' };
const VIC = { id: '00000000-0000-4000-8000-00000000000b', fullName: 'Vic' };

let seq = 0;
const msg = (over: Partial<MessageDto> = {}): MessageDto => {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    conversationId: '00000000-0000-4000-8000-0000000000cc',
    sender: MIA,
    clientMsgId: crypto.randomUUID(),
    body: `tin ${seq}`,
    replyTo: null,
    attachments: [],
    createdAt: new Date(Date.UTC(2026, 9, 18, 3, 0, seq)).toISOString(),
    editedAt: null,
    deletedAt: null,
    ...over,
  };
};

const data = (...pages: MessageDto[][]): MessagesData => ({
  pages: pages.map((d) => ({ data: d, page: { hasMore: false } })),
  pageParams: pages.map(() => undefined),
});

describe('message-cache (§7 E6/E8)', () => {
  it('flatten: trang 0 là mới nhất ⇒ hiển thị trang cũ trước, mỗi trang cũ → mới', () => {
    const [a, b, c, d] = [msg(), msg(), msg(), msg()];
    expect(flatten(data([c, d], [a, b])).map((m) => m.body)).toEqual(
      [a, b, c, d].map((m) => m.body),
    );
    expect(newestMessage(data([c, d], [a, b]))?.id).toBe(d.id);
    expect(flatten(undefined)).toEqual([]);
  });

  it('tin lạc quan (id tạm = clientMsgId) ⇒ echo realtime ĐẾN TRƯỚC thay đúng chỗ ⇒ response sau không nhân đôi', () => {
    const old = msg();
    const optimistic = msg({ id: crypto.randomUUID() });
    const server = { ...optimistic, id: crypto.randomUUID(), createdAt: optimistic.createdAt };
    let d = upsertMessage(data([old]), optimistic);
    expect(flatten(d)).toHaveLength(2);
    d = upsertMessage(d, server); // echo
    d = upsertMessage(d, server); // response
    expect(flatten(d).map((m) => m.id)).toEqual([old.id, server.id]);
  });

  it('cùng clientMsgId của NGƯỜI KHÁC không bị coi là cùng tin', () => {
    const mine = msg();
    const theirs = msg({ sender: VIC, clientMsgId: mine.clientMsgId });
    expect(flatten(upsertMessage(data([mine]), theirs))).toHaveLength(2);
  });

  it('sửa / xóa (chat:message:updated) thay tại chỗ, kể cả ở trang cũ', () => {
    const [a, b] = [msg(), msg()];
    const deleted = { ...a, body: null, deletedAt: new Date().toISOString() };
    const d = upsertMessage(data([b], [a]), deleted);
    expect(flatten(d)[0]).toEqual(deleted);
    expect(d?.pages[0]?.data).toEqual([b]);
  });

  it('bù khi nối lại (after): gộp theo id, không trùng', () => {
    const [a, b, c] = [msg(), msg(), msg()];
    const d = appendMessages(data([a, b]), [b, c]);
    expect(flatten(d).map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it('chưa có cache ⇒ để nguyên (không tự tạo luồng); dropMessage bỏ bản lạc quan', () => {
    expect(upsertMessage(undefined, msg())).toBeUndefined();
    const m = msg();
    expect(flatten(dropMessage(data([m]), m.id))).toEqual([]);
  });
});
