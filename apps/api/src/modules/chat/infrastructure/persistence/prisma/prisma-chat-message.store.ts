import { Prisma } from '../../../../../generated/prisma/client';
import type {
  AttachmentRecord,
  IChatMessageStore,
  IChatReadStateStore,
  MessageRecord,
  NewMessage,
  ReadStateRecord,
} from '../../../application/ports/chat-message.port';
import { bodyPreview } from '../../../domain/chat-message';
import { attachmentUnavailable } from '../../../domain/chat-message';
import type { DbProvider } from './chat-db';

/** Tin + con trỏ đã đọc trên Postgres (T-069a; ADR-144/145). */
export class PrismaChatMessageStore implements IChatMessageStore, IChatReadStateStore {
  constructor(private readonly db: DbProvider) {}

  async insert(input: NewMessage): Promise<{ created: boolean; message: MessageRecord }> {
    const n = await this.db().$executeRaw`
      INSERT INTO chat_messages (id, conversation_id, sender_id, client_msg_id, request_hash, body, reply_to_id, created_at)
      VALUES (${input.id}::uuid, ${input.conversationId}::uuid, ${input.senderId}::uuid, ${input.clientMsgId}::uuid,
              ${input.requestHash}, ${input.body}, ${input.replyToId}::uuid, ${input.at})
      ON CONFLICT (sender_id, client_msg_id) DO NOTHING`;
    if (n === 0) {
      const old = await this.db().chatMessage.findUniqueOrThrow({
        where: {
          senderId_clientMsgId: { senderId: input.senderId, clientMsgId: input.clientMsgId },
        },
        include: INCLUDE,
      });
      return { created: false, message: toMessage(old) };
    }
    if (input.attachmentIds.length > 0) {
      const { count } = await this.db().chatAttachment.updateMany({
        where: {
          id: { in: [...input.attachmentIds] },
          uploaderId: input.senderId,
          messageId: null,
        },
        data: { messageId: input.id },
      });
      // B M1: đính kèm mất giữa claim và gắn (purge mồ côi, không còn của người gửi…) ⇒ rollback cả tin, không lưu tin
      // thiếu tệp một cách âm thầm.
      if (count !== input.attachmentIds.length) throw attachmentUnavailable();
    }
    await this.db().chatConversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: input.at, lastMessageId: input.id, updatedAt: input.at },
    });
    const row = await this.db().chatMessage.findUniqueOrThrow({
      where: { id: input.id },
      include: INCLUDE,
    });
    return { created: true, message: toMessage(row) };
  }

  async findById(id: string): Promise<MessageRecord | null> {
    const row = await this.db().chatMessage.findUnique({ where: { id }, include: INCLUDE });
    return row ? toMessage(row) : null;
  }

  async findByClientMsgId(senderId: string, clientMsgId: string): Promise<MessageRecord | null> {
    const row = await this.db().chatMessage.findUnique({
      where: { senderId_clientMsgId: { senderId, clientMsgId } },
      include: INCLUDE,
    });
    return row ? toMessage(row) : null;
  }

  async lock(id: string): Promise<void> {
    await this.db().$queryRaw`SELECT id FROM chat_messages WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async page(
    conversationId: string,
    q: { before?: string; after?: string; limit: number },
  ): Promise<{ items: MessageRecord[]; hasMore: boolean }> {
    const anchorId = q.before ?? q.after;
    let anchor: { createdAt: Date; id: string } | null = null;
    if (anchorId !== undefined) {
      anchor = await this.db().chatMessage.findFirst({
        where: { id: anchorId, conversationId },
        select: { createdAt: true, id: true },
      });
      if (!anchor) return { items: [], hasMore: false };
    }
    const newer = q.after !== undefined;
    const keyset = anchor
      ? newer
        ? Prisma.sql`AND (m.created_at, m.id) > (${anchor.createdAt}, ${anchor.id}::uuid)`
        : Prisma.sql`AND (m.created_at, m.id) < (${anchor.createdAt}, ${anchor.id}::uuid)`
      : Prisma.empty;
    const order = newer ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const ids = await this.db().$queryRaw<{ id: string }[]>`
      SELECT m.id FROM chat_messages m WHERE m.conversation_id = ${conversationId}::uuid ${keyset}
       ORDER BY m.created_at ${order}, m.id ${order} LIMIT ${q.limit + 1}`;
    const hasMore = ids.length > q.limit;
    const want = ids.slice(0, q.limit).map((r) => r.id);
    const rows = await this.db().chatMessage.findMany({
      where: { id: { in: want } },
      include: INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map(toMessage), hasMore };
  }

  async edit(id: string, body: string, at: Date): Promise<void> {
    await this.db().chatMessage.update({ where: { id }, data: { body, editedAt: at } });
  }

  async softDelete(id: string, at: Date): Promise<AttachmentRecord[]> {
    const removed = await this.db().chatAttachment.findMany({
      where: { messageId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    await this.db().chatAttachment.deleteMany({ where: { messageId: id } });
    await this.db().chatMessage.updateMany({ where: { id }, data: { body: null, deletedAt: at } });
    return removed.map(toAttachment);
  }

  async get(conversationId: string, userId: string): Promise<ReadStateRecord> {
    const r = await this.db().chatReadState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return { lastReadMessageId: r?.lastReadMessageId ?? null, muted: r?.muted ?? false };
  }

  /** Chỉ tiến: UPSERT có điều kiện — con trỏ cũ trỏ tin mới hơn / bằng ⇒ không ghi. */
  async advance(
    conversationId: string,
    userId: string,
    messageId: string,
    at: Date,
  ): Promise<boolean> {
    const n = await this.db().$executeRaw`
      INSERT INTO chat_read_states (conversation_id, user_id, last_read_message_id, updated_at)
      SELECT m.conversation_id, ${userId}::uuid, m.id, ${at} FROM chat_messages m
       WHERE m.id = ${messageId}::uuid AND m.conversation_id = ${conversationId}::uuid
      ON CONFLICT (conversation_id, user_id) DO UPDATE
         SET last_read_message_id = EXCLUDED.last_read_message_id, updated_at = EXCLUDED.updated_at
       WHERE chat_read_states.last_read_message_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM chat_messages p WHERE p.id = chat_read_states.last_read_message_id)
          OR (SELECT (p.created_at, p.id) FROM chat_messages p WHERE p.id = chat_read_states.last_read_message_id)
             < (SELECT (t.created_at, t.id) FROM chat_messages t WHERE t.id = EXCLUDED.last_read_message_id)`;
    return n === 1;
  }

  async setMuted(conversationId: string, userId: string, muted: boolean, at: Date): Promise<void> {
    await this.db().chatReadState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, muted, updatedAt: at },
      update: { muted, updatedAt: at },
    });
  }
}

const INCLUDE = {
  replyTo: { select: { id: true, senderId: true, body: true, deletedAt: true } },
  attachments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ChatMessageInclude;

type AttachmentRow = Omit<AttachmentRecord, 'name'> & { originalName: string };
type MessageRow = Omit<MessageRecord, 'replyTo' | 'attachments'> & {
  replyTo: { id: string; senderId: string; body: string | null; deletedAt: Date | null } | null;
  attachments: AttachmentRow[];
};

export function toAttachment(a: AttachmentRow): AttachmentRecord {
  return {
    id: a.id,
    uploaderId: a.uploaderId,
    messageId: a.messageId,
    kind: a.kind,
    name: a.originalName,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    width: a.width,
    height: a.height,
    fileKey: a.fileKey,
    previewKey: a.previewKey,
    thumbKey: a.thumbKey,
    createdAt: a.createdAt,
  };
}

function toMessage(m: MessageRow): MessageRecord {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    clientMsgId: m.clientMsgId,
    requestHash: m.requestHash,
    body: m.body,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderId: m.replyTo.senderId,
          bodyPreview: bodyPreview(m.replyTo.body),
          deleted: m.replyTo.deletedAt !== null,
        }
      : null,
    attachments: m.attachments.map(toAttachment),
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
  };
}
