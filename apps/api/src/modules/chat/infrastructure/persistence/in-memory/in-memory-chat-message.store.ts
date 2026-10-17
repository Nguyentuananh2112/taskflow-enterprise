import { bodyPreview, compareKeyset } from '../../../domain/chat-message';
import type {
  AttachmentRecord,
  IChatMessageStore,
  IChatReadStateStore,
  MessageRecord,
  NewMessage,
  ReadStateRecord,
} from '../../../application/ports/chat-message.port';
import { attachmentsOf, type InMemoryChatState, type MessageRow } from './in-memory-chat-state';

/** Tin + con trỏ đã đọc trong bộ nhớ (cùng hợp đồng với bản Prisma — T-069a). */
export class InMemoryChatMessageStore implements IChatMessageStore, IChatReadStateStore {
  constructor(private readonly s: InMemoryChatState) {}

  // ---------------------------------------------------------------- tin

  insert(input: NewMessage): Promise<{ created: boolean; message: MessageRecord }> {
    const dup = [...this.s.data.messages.values()].find(
      (m) => m.senderId === input.senderId && m.clientMsgId === input.clientMsgId,
    );
    if (dup) return Promise.resolve({ created: false, message: this.#record(dup) });
    const row: MessageRow = {
      id: input.id,
      conversationId: input.conversationId,
      senderId: input.senderId,
      clientMsgId: input.clientMsgId,
      requestHash: input.requestHash,
      body: input.body,
      replyToId: input.replyToId,
      createdAt: input.at,
      editedAt: null,
      deletedAt: null,
    };
    this.s.data.messages.set(row.id, row);
    for (const id of input.attachmentIds) {
      const a = this.s.data.attachments.get(id);
      if (a) this.s.data.attachments.set(id, { ...a, messageId: row.id });
    }
    const c = this.s.data.conversations.get(input.conversationId);
    if (c) {
      c.lastMessageAt = row.createdAt;
      c.lastMessageId = row.id;
    }
    return Promise.resolve({ created: true, message: this.#record(row) });
  }

  findById(id: string): Promise<MessageRecord | null> {
    const m = this.s.data.messages.get(id);
    return Promise.resolve(m ? this.#record(m) : null);
  }

  findByClientMsgId(senderId: string, clientMsgId: string): Promise<MessageRecord | null> {
    const m = [...this.s.data.messages.values()].find(
      (x) => x.senderId === senderId && x.clientMsgId === clientMsgId,
    );
    return Promise.resolve(m ? this.#record(m) : null);
  }

  lock(): Promise<void> {
    return Promise.resolve();
  }

  page(
    conversationId: string,
    q: { before?: string; after?: string; limit: number },
  ): Promise<{ items: MessageRecord[]; hasMore: boolean }> {
    const all = [...this.s.data.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort(compareKeyset);
    const anchorId = q.before ?? q.after;
    const anchor = anchorId === undefined ? undefined : this.s.data.messages.get(anchorId);
    if (anchorId !== undefined && anchor?.conversationId !== conversationId) {
      return Promise.resolve({ items: [], hasMore: false });
    }
    let items: MessageRow[];
    let hasMore: boolean;
    if (q.after !== undefined) {
      const newer = all.filter((m) => compareKeyset(m, anchor!) > 0);
      items = newer.slice(0, q.limit);
      hasMore = newer.length > q.limit;
    } else {
      const older = anchor ? all.filter((m) => compareKeyset(m, anchor) < 0) : all;
      items = older.slice(-q.limit);
      hasMore = older.length > q.limit;
    }
    return Promise.resolve({ items: items.map((m) => this.#record(m)), hasMore });
  }

  edit(id: string, body: string, at: Date): Promise<void> {
    const m = this.s.data.messages.get(id);
    if (m) Object.assign(m, { body, editedAt: at });
    return Promise.resolve();
  }

  softDelete(id: string, at: Date): Promise<AttachmentRecord[]> {
    const m = this.s.data.messages.get(id);
    if (!m) return Promise.resolve([]);
    Object.assign(m, { body: null, deletedAt: at });
    const removed = attachmentsOf(this.s, id);
    for (const a of removed) this.s.data.attachments.delete(a.id);
    return Promise.resolve(removed);
  }

  // ---------------------------------------------------------------- đã đọc / tắt tiếng

  get(conversationId: string, userId: string): Promise<ReadStateRecord> {
    return Promise.resolve({ ...this.s.read(conversationId, userId) });
  }

  advance(conversationId: string, userId: string, messageId: string): Promise<boolean> {
    const target = this.s.data.messages.get(messageId);
    if (target?.conversationId !== conversationId) return Promise.resolve(false);
    const cur = this.s.read(conversationId, userId);
    const prev =
      cur.lastReadMessageId === null ? undefined : this.s.data.messages.get(cur.lastReadMessageId);
    if (prev && compareKeyset(target, prev) <= 0) return Promise.resolve(false);
    this.s.data.reads.set(this.s.readKey(conversationId, userId), {
      ...cur,
      lastReadMessageId: messageId,
    });
    return Promise.resolve(true);
  }

  setMuted(conversationId: string, userId: string, muted: boolean): Promise<void> {
    const cur = this.s.read(conversationId, userId);
    this.s.data.reads.set(this.s.readKey(conversationId, userId), { ...cur, muted });
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- nội bộ

  #record(m: MessageRow): MessageRecord {
    const r = m.replyToId === null ? undefined : this.s.data.messages.get(m.replyToId);
    return {
      ...m,
      replyTo: r
        ? {
            id: r.id,
            senderId: r.senderId,
            bodyPreview: bodyPreview(r.body),
            deleted: r.deletedAt !== null,
          }
        : null,
      attachments: attachmentsOf(this.s, m.id).map((a) => ({ ...a })),
    };
  }
}
