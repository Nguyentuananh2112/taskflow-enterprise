// T-069a tầng I: bộ ca hợp đồng store chat (y hệt bản InMemory — LSP) trên Postgres thật + CHECK của migration chat +
// tạo-hoặc-lấy DIRECT đồng thời (2 kết nối) ⇒ một dòng.
import { afterAll, describe, expect, it } from 'vitest';

import { directKey } from '../../../src/modules/chat/domain/chat-conversation';
import { describeChatConversationContract } from '../../../src/modules/chat/testing/chat-conversation.contract';
import { HIRED, NOW, U, cid, staff } from '../../../src/modules/chat/testing/chat-fixtures';
import { describeChatMessageContract } from '../../../src/modules/chat/testing/chat-message.contract';
import { PrismaChatConversationStore } from '../../../src/modules/chat/infrastructure/persistence/prisma/prisma-chat-conversation.store';
import { RecordingUnitOfWork, disconnectTestPrisma, testPrisma } from '../support/prisma-test-kit';
import { prismaChatBackend } from './prisma-chat-backend';

afterAll(disconnectTestPrisma);

describeChatConversationContract('Prisma', prismaChatBackend);
describeChatMessageContract('Prisma', prismaChatBackend);

describe('migration chat — CHECK', () => {
  it('loại ⇔ cột, title, direct_key, cặp last_message, thân ≤ 4000, đã xóa ⇒ thân NULL, hash hex, kích thước', async () => {
    const b = await prismaChatBackend();
    await staff(b);
    const p = testPrisma();
    const conv = (data: Record<string, unknown>) =>
      p.chatConversation.create({
        data: { kind: 'GROUP', title: 'x', createdById: U.Mia, ...data } as never,
      });
    for (const [data, chk] of [
      [{ kind: 'DIRECT', title: null }, 'chat_conversations_kind_chk'],
      [{ kind: 'GROUP', title: null }, 'chat_conversations_kind_chk'],
      [{ title: '   ' }, 'chat_conversations_title_chk'],
      [
        { kind: 'DIRECT', title: null, directKey: 'không-phải-uuid' },
        'chat_conversations_direct_key_chk',
      ],
      [{ lastMessageAt: NOW }, 'chat_conversations_last_message_chk'],
      // B M2: đúng hai uuid VÀ thứ tự nhỏ:lớn — "lớn:nhỏ" bị chặn (không sinh DM thứ hai cho cùng cặp).
      [
        { kind: 'DIRECT', title: null, directKey: `${U.Vic}:${U.Mia}` },
        'chat_conversations_direct_key_chk',
      ],
      [
        { kind: 'DIRECT', title: null, directKey: `${U.Mia}:${U.Mia}` },
        'chat_conversations_direct_key_chk',
      ],
    ] as const) {
      await expect(conv(data), chk).rejects.toThrow(new RegExp(chk));
    }
    const g = await conv({ id: cid(90) });
    const msg = (data: Record<string, unknown>) =>
      p.chatMessage.create({
        data: {
          conversationId: g.id,
          senderId: U.Mia,
          clientMsgId: cid(91),
          requestHash: 'a'.repeat(64),
          ...data,
        } as never,
      });
    await expect(msg({ body: 'x'.repeat(4001) })).rejects.toThrow(/chat_messages_body_chk/);
    await expect(msg({ body: 'x', deletedAt: NOW })).rejects.toThrow(
      /chat_messages_deleted_body_chk/,
    );
    await expect(msg({ requestHash: 'Z'.repeat(64) })).rejects.toThrow(
      /chat_messages_request_hash_chk/,
    );
    await expect(msg({ body: '😀'.repeat(4000) })).resolves.toMatchObject({ conversationId: g.id });
    const att = (data: Record<string, unknown>) =>
      p.chatAttachment.create({
        data: {
          uploaderId: U.Mia,
          kind: 'FILE',
          originalName: 'a.pdf',
          mime: 'application/pdf',
          sizeBytes: 1,
          sha256: 'b'.repeat(64),
          fileKey: 'a'.repeat(26),
          ...data,
        } as never,
      });
    await expect(att({ sizeBytes: -1 })).rejects.toThrow(/chat_attachments_size_chk/);
    await expect(att({ sizeBytes: 20 * 1024 * 1024 + 1 })).rejects.toThrow(
      /chat_attachments_size_chk/,
    );
    await expect(att({ fileKey: '../../etc/passwd' })).rejects.toThrow(/chat_attachments_keys_chk/);
    await expect(att({ thumbKey: 'K'.repeat(26) })).rejects.toThrow(/chat_attachments_keys_chk/);
    await att({ id: cid(93) });
    await expect(att({ id: cid(94) })).rejects.toThrow(
      /chat_attachments_file_key_key|Unique constraint/,
    ); // một blob ⇔ một dòng
    await expect(att({ width: 10 })).rejects.toThrow(/chat_attachments_dims_chk/);
    await expect(att({ sha256: 'x' })).rejects.toThrow(/chat_attachments_sha256_chk/);
    await expect(
      p.chatParticipant.create({
        data: { conversationId: g.id, userId: U.Vic, joinedAt: NOW, leftAt: HIRED },
      }),
    ).rejects.toThrow(/chat_participants_left_chk/);
  });
});

describe('đồng thời', () => {
  it('2 kết nối getOrCreateDirect cùng lúc ⇒ một hội thoại, cả hai nhận cùng id', async () => {
    const a = await prismaChatBackend();
    await staff(a);
    // Kết nối thứ hai: UoW + store riêng trên cùng DB.
    const uow2 = new RecordingUnitOfWork();
    const b = {
      conversations: new PrismaChatConversationStore(() => uow2.db()),
      run: <T>(w: () => Promise<T>) => uow2.run(w),
    };
    const key = directKey(U.Mia, U.Vic);
    const [x, y] = await Promise.all([
      a.run(() =>
        a.conversations.getOrCreateDirect({
          id: cid(80),
          directKey: key,
          createdById: U.Mia,
          userIds: [U.Mia, U.Vic],
          at: NOW,
        }),
      ),
      b.run(() =>
        b.conversations.getOrCreateDirect({
          id: cid(81),
          directKey: key,
          createdById: U.Vic,
          userIds: [U.Vic, U.Mia],
          at: NOW,
        }),
      ),
    ]);
    expect(x.conversation.id).toBe(y.conversation.id);
    expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
    expect(await testPrisma().chatConversation.count()).toBe(1);
    expect(await testPrisma().chatParticipant.count()).toBe(2);
  });
});
