import { compareKeyset } from '../../../domain/chat-message';
import type {
  AttachmentRecord,
  IChatAttachmentStore,
} from '../../../application/ports/chat-message.port';
import {
  attachmentsOf,
  blobKeysOf as keysOf,
  type InMemoryChatState,
} from './in-memory-chat-state';

/** Đính kèm + retention trong bộ nhớ (cùng hợp đồng với bản Prisma — T-069a). */
export class InMemoryChatAttachmentStore implements IChatAttachmentStore {
  constructor(private readonly s: InMemoryChatState) {}

  createUpload(input: Omit<AttachmentRecord, 'messageId'>): Promise<AttachmentRecord> {
    const row: AttachmentRecord = { ...input, messageId: null };
    this.s.data.attachments.set(row.id, row);
    return Promise.resolve({ ...row });
  }

  claimableUploads(ids: readonly string[], uploaderId: string): Promise<AttachmentRecord[]> {
    const want = new Set(ids);
    const rows = [...this.s.data.attachments.values()].filter(
      (a) => want.has(a.id) && a.uploaderId === uploaderId && a.messageId === null,
    );
    return Promise.resolve(rows.map((a) => ({ ...a })));
  }

  findById(id: string): Promise<AttachmentRecord | null> {
    const a = this.s.data.attachments.get(id);
    return Promise.resolve(a ? { ...a } : null);
  }

  conversationOf(attachmentId: string): Promise<string | null> {
    const a = this.s.data.attachments.get(attachmentId);
    const m = a?.messageId ? this.s.data.messages.get(a.messageId) : undefined;
    return Promise.resolve(m && m.deletedAt === null ? m.conversationId : null);
  }

  purgeMessagesBefore(
    cutoff: Date,
    limit: number,
  ): Promise<{ deleted: number; blobKeys: string[] }> {
    const victims = [...this.s.data.messages.values()]
      .filter((m) => m.createdAt < cutoff)
      .sort(compareKeyset)
      .slice(0, limit);
    const blobKeys: string[] = [];
    for (const m of victims) {
      for (const a of attachmentsOf(this.s, m.id)) {
        blobKeys.push(...keysOf(a));
        this.s.data.attachments.delete(a.id);
      }
      this.s.data.messages.delete(m.id);
    }
    // FK SetNull: trả lời tin đã purge ⇒ reply_to_id NULL; last_message của hội thoại trỏ tin đã purge ⇒ NULL cả cặp.
    const gone = new Set(victims.map((m) => m.id));
    for (const m of this.s.data.messages.values())
      if (m.replyToId && gone.has(m.replyToId)) m.replyToId = null;
    for (const c of this.s.data.conversations.values()) {
      if (c.lastMessageId && gone.has(c.lastMessageId))
        Object.assign(c, { lastMessageId: null, lastMessageAt: null });
    }
    return Promise.resolve({ deleted: victims.length, blobKeys });
  }

  purgeOrphanUploadsBefore(cutoff: Date, limit: number): Promise<string[]> {
    const victims = [...this.s.data.attachments.values()]
      .filter((a) => a.messageId === null && a.createdAt < cutoff)
      .slice(0, limit);
    for (const a of victims) this.s.data.attachments.delete(a.id);
    return Promise.resolve(victims.flatMap(keysOf));
  }

  existingBlobKeys(keys: readonly string[]): Promise<Set<string>> {
    const live = new Set([...this.s.data.attachments.values()].flatMap(keysOf));
    return Promise.resolve(new Set(keys.filter((k) => live.has(k))));
  }
}
