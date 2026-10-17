import { describe, expect, it } from 'vitest';

import { requestHash } from '../domain/chat-message';
import type { ChatBackend } from './chat-backend';
import { G, U, aid, at, cid, cmid, group, mid, send, staff, upload } from './chat-fixtures';

// Bộ ca HỢP ĐỒNG IChatMessageStore / IChatReadStateStore / IChatAttachmentStore (T-069a; ADR-144/145/147).

export function describeChatMessageContract(name: string, make: () => Promise<ChatBackend>) {
  describe(`${name}: tin nhắn`, () => {
    it('insert: tạo + gắn đính kèm + last_message; trùng (sender, clientMsgId) ⇒ trả tin CŨ, không ghi', async () => {
      const b = await make();
      await group(b);
      await upload(b, 1, U.Mia);
      const first = await send(b, 1, U.Mia, 'chào', { attachmentIds: [aid(1)] });
      expect(first).toMatchObject({
        created: true,
        message: { body: 'chào', attachments: [{ id: aid(1), messageId: mid(1) }] },
      });
      const dup = await send(b, 2, U.Mia, 'khác', { clientN: 1 });
      expect(dup).toMatchObject({ created: false, message: { id: mid(1), body: 'chào' } });
      expect(dup.message.requestHash).not.toBe(
        requestHash({ conversationId: G, body: 'khác', attachmentIds: [] }),
      );
      expect(await b.run(() => b.conversations.findById(G))).toMatchObject({
        lastMessageId: mid(1),
        lastMessageAt: at(1),
      });
      // Cùng clientMsgId, người gửi KHÁC ⇒ tin mới.
      expect((await send(b, 3, U.Vic, 'x', { clientN: 1 })).created).toBe(true);
      // findByClientMsgId (G, CC-CH-01): có ⇒ tin cũ kèm đính kèm; người gửi khác / mã lạ ⇒ null.
      expect(await b.run(() => b.messages.findByClientMsgId(U.Mia, cmid(1)))).toMatchObject({
        id: mid(1),
        attachments: [{ id: aid(1) }],
      });
      expect((await b.run(() => b.messages.findByClientMsgId(U.Vic, cmid(1))))?.id).toBe(mid(3));
      expect(await b.run(() => b.messages.findByClientMsgId(U.Lan, cmid(1)))).toBeNull();
      expect(await b.run(() => b.messages.findByClientMsgId(U.Mia, cmid(9)))).toBeNull();
    });

    it('page keyset: mới nhất / before / after, tăng dần, hasMore; id lạ ⇒ rỗng', async () => {
      const b = await make();
      await group(b);
      for (let n = 1; n <= 5; n++) await send(b, n, U.Mia, `m${String(n)}`);
      const ids = (r: { items: { id: string }[]; hasMore: boolean }) => [
        r.items.map((m) => m.id),
        r.hasMore,
      ];
      expect(ids(await b.run(() => b.messages.page(G, { limit: 2 })))).toEqual([
        [mid(4), mid(5)],
        true,
      ]);
      expect(ids(await b.run(() => b.messages.page(G, { before: mid(4), limit: 2 })))).toEqual([
        [mid(2), mid(3)],
        true,
      ]);
      expect(ids(await b.run(() => b.messages.page(G, { before: mid(2), limit: 2 })))).toEqual([
        [mid(1)],
        false,
      ]);
      expect(ids(await b.run(() => b.messages.page(G, { after: mid(2), limit: 2 })))).toEqual([
        [mid(3), mid(4)],
        true,
      ]);
      expect(ids(await b.run(() => b.messages.page(G, { after: mid(4), limit: 2 })))).toEqual([
        [mid(5)],
        false,
      ]);
      expect(ids(await b.run(() => b.messages.page(G, { after: cid(99), limit: 2 })))).toEqual([
        [],
        false,
      ]);
    });

    it('sửa; xóa mềm ⇒ body NULL + XÓA dòng đính kèm (trả về); trả lời thấy "đã xóa"', async () => {
      const b = await make();
      await group(b);
      await upload(b, 2, U.Mia);
      await send(b, 1, U.Mia, 'gốc dài '.repeat(30), { attachmentIds: [aid(2)] });
      await send(b, 2, U.Vic, 'trả lời', { replyToId: mid(1) });
      expect((await b.run(() => b.messages.findById(mid(2))))?.replyTo).toMatchObject({
        id: mid(1),
        senderId: U.Mia,
        deleted: false,
      });
      await b.run(() => b.messages.edit(mid(1), 'đã sửa', at(3)));
      expect(await b.run(() => b.messages.findById(mid(1)))).toMatchObject({
        body: 'đã sửa',
        editedAt: at(3),
      });
      const removed = await b.run(() => b.messages.softDelete(mid(1), at(4)));
      expect(removed.map((a) => a.fileKey)).toEqual(['k2f']);
      expect(await b.run(() => b.messages.findById(mid(1)))).toMatchObject({
        body: null,
        deletedAt: at(4),
        attachments: [],
      });
      expect(await b.run(() => b.attachments.findById(aid(2)))).toBeNull();
      expect((await b.run(() => b.messages.findById(mid(2))))?.replyTo).toEqual({
        id: mid(1),
        senderId: U.Mia,
        bodyPreview: null,
        deleted: true,
      });
    });

    it('đã đọc chỉ tiến; unread bỏ tin của mình + tin đã xóa; tổng header bỏ hội thoại tắt tiếng', async () => {
      const b = await make();
      await group(b);
      for (let n = 1; n <= 4; n++) await send(b, n, n === 2 ? U.Vic : U.Mia, `m${String(n)}`);
      await b.run(() => b.messages.softDelete(mid(4), at(5)));
      expect((await b.run(() => b.conversations.summaryFor(G, U.Vic, at(6))))?.unread).toBe(2); // m1, m3
      expect(await b.run(() => b.messages.advance(G, U.Vic, mid(3), at(6)))).toBe(true);
      expect(await b.run(() => b.messages.advance(G, U.Vic, mid(1), at(6)))).toBe(false);
      expect(await b.run(() => b.messages.advance(G, U.Vic, cid(99), at(6)))).toBe(false);
      expect(await b.run(() => b.messages.get(G, U.Vic))).toEqual({
        lastReadMessageId: mid(3),
        muted: false,
      });
      expect((await b.run(() => b.conversations.summaryFor(G, U.Vic, at(7))))?.unread).toBe(0);
      expect(await b.run(() => b.conversations.unreadTotal(U.Lan, at(7)))).toBe(3);
      await b.run(() => b.messages.setMuted(G, U.Lan, true, at(7)));
      expect(await b.run(() => b.conversations.unreadTotal(U.Lan, at(7)))).toBe(0);
    });

    it('đính kèm: chỉ upload của chính mình, chưa gắn; conversationOf; purge theo hạn (reply SetNull) + mồ côi; existingBlobKeys', async () => {
      const b = await make();
      await group(b);
      await upload(b, 3, U.Mia);
      await upload(b, 4, U.Vic);
      expect(
        (await b.run(() => b.attachments.claimableUploads([aid(3), aid(4)], U.Mia))).map(
          (a) => a.id,
        ),
      ).toEqual([aid(3)]);
      expect(await b.run(() => b.attachments.conversationOf(aid(3)))).toBeNull();
      await send(b, 1, U.Mia, null, { attachmentIds: [aid(3)] });
      expect(await b.run(() => b.attachments.claimableUploads([aid(3)], U.Mia))).toEqual([]);
      expect(await b.run(() => b.attachments.conversationOf(aid(3)))).toBe(G);
      await send(b, 2, U.Vic, 'trả lời', { replyToId: mid(1) });

      const purged = await b.run(() => b.attachments.purgeMessagesBefore(at(2), 100));
      expect({ ...purged, blobKeys: [...purged.blobKeys].sort() }).toEqual({
        deleted: 1,
        blobKeys: ['k3f', 'k3p', 'k3t'],
      });
      expect((await b.run(() => b.messages.findById(mid(2))))?.replyTo).toBeNull();
      expect(await b.run(() => b.attachments.purgeOrphanUploadsBefore(at(1), 100))).toEqual(
        expect.arrayContaining(['k4f', 'k4p', 'k4t']),
      );
      await upload(b, 5, U.Mia, 30);
      expect(await b.run(() => b.attachments.existingBlobKeys(['k5f', 'k3f', 'k4t']))).toEqual(
        new Set(['k5f']),
      );
    });

    it('danh sách: COALESCE(last_message_at, created_at) DESC, id DESC + con trỏ; markLeftForNonMembers', async () => {
      const b = await make();
      await staff(b);
      for (const [n, min] of [
        [7, 1],
        [8, 2],
        [9, 3],
      ] as const) {
        await b.run(() =>
          b.conversations.createGroup({
            id: cid(n),
            title: `G${String(n)}`,
            createdById: U.Mia,
            memberIds: [U.Vic, U.Lan],
            at: at(min),
          }),
        );
      }
      const p1 = await b.run(() =>
        b.conversations.listForUser(U.Mia, at(10), { cursor: null, limit: 2 }),
      );
      expect(p1.items.map((s) => s.conversation.id)).toEqual([cid(9), cid(8)]);
      const p2 = await b.run(() =>
        b.conversations.listForUser(U.Mia, at(10), { cursor: p1.next, limit: 2 }),
      );
      expect([p2.items.map((s) => s.conversation.id), p2.next]).toEqual([[cid(7)], null]);

      await b.offboard(U.Lan);
      expect(await b.run(() => b.conversations.markLeftForNonMembers(at(20), 2))).toBe(2);
      expect(await b.run(() => b.conversations.markLeftForNonMembers(at(20), 10))).toBe(1);
      expect(await b.run(() => b.conversations.markLeftForNonMembers(at(20), 10))).toBe(0);
    });
  });
}
