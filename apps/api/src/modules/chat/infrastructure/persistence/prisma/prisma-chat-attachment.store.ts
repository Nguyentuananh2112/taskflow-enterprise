import type {
  AttachmentRecord,
  IChatAttachmentStore,
} from '../../../application/ports/chat-message.port';
import type { DbProvider } from './chat-db';
import { toAttachment } from './prisma-chat-message.store';

/** Đính kèm + retention trên Postgres (T-069a; ADR-141/147). Xóa DB trước, bên gọi xóa đĩa SAU commit. */
export class PrismaChatAttachmentStore implements IChatAttachmentStore {
  constructor(private readonly db: DbProvider) {}

  async createUpload(input: Omit<AttachmentRecord, 'messageId'>): Promise<AttachmentRecord> {
    const row = await this.db().chatAttachment.create({
      data: {
        id: input.id,
        uploaderId: input.uploaderId,
        kind: input.kind,
        originalName: input.name,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        width: input.width,
        height: input.height,
        fileKey: input.fileKey,
        previewKey: input.previewKey,
        thumbKey: input.thumbKey,
        createdAt: input.createdAt,
      },
    });
    return toAttachment(row);
  }

  /** FOR UPDATE: hai tin đồng thời không gắn cùng upload (tin thứ 2 thấy đã gắn ⇒ thiếu ⇒ 404). */
  async claimableUploads(ids: readonly string[], uploaderId: string): Promise<AttachmentRecord[]> {
    if (ids.length === 0) return [];
    const locked = await this.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM chat_attachments
       WHERE id = ANY(${ids as string[]}::uuid[]) AND uploader_id = ${uploaderId}::uuid AND message_id IS NULL
       ORDER BY id FOR UPDATE`;
    const rows = await this.db().chatAttachment.findMany({
      where: { id: { in: locked.map((r) => r.id) } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toAttachment);
  }

  async findById(id: string): Promise<AttachmentRecord | null> {
    const row = await this.db().chatAttachment.findUnique({ where: { id } });
    return row ? toAttachment(row) : null;
  }

  async conversationOf(attachmentId: string): Promise<string | null> {
    const row = await this.db().chatAttachment.findUnique({
      where: { id: attachmentId },
      select: { message: { select: { conversationId: true, deletedAt: true } } },
    });
    const m = row?.message;
    return m && m.deletedAt === null ? m.conversationId : null;
  }

  /**
   * Theo lô, cũ nhất trước: xóa đính kèm rồi xóa tin. FK làm phần còn lại: `reply_to_id` SetNull. `last_message_*` không
   * có FK ⇒ ghi NULL cả cặp ở hội thoại trỏ tin đã xóa (CHECK cặp).
   */
  async purgeMessagesBefore(
    cutoff: Date,
    limit: number,
  ): Promise<{ deleted: number; blobKeys: string[] }> {
    const victims = await this.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM chat_messages WHERE created_at < ${cutoff}
       ORDER BY created_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (victims.length === 0) return { deleted: 0, blobKeys: [] };
    const ids = victims.map((v) => v.id);
    const atts = await this.db().chatAttachment.findMany({ where: { messageId: { in: ids } } });
    await this.db().chatAttachment.deleteMany({ where: { messageId: { in: ids } } });
    await this.db().chatConversation.updateMany({
      where: { lastMessageId: { in: ids } },
      data: { lastMessageId: null, lastMessageAt: null },
    });
    const { count } = await this.db().chatMessage.deleteMany({ where: { id: { in: ids } } });
    return { deleted: count, blobKeys: atts.flatMap((a) => keys(a)) };
  }

  async purgeOrphanUploadsBefore(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.db().$queryRaw<
      { file_key: string; preview_key: string | null; thumb_key: string | null }[]
    >`
      DELETE FROM chat_attachments WHERE id IN (
        SELECT id FROM chat_attachments WHERE message_id IS NULL AND created_at < ${cutoff}
         ORDER BY created_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING file_key, preview_key, thumb_key`;
    return rows.flatMap((r) =>
      keys({ fileKey: r.file_key, previewKey: r.preview_key, thumbKey: r.thumb_key }),
    );
  }

  async existingBlobKeys(input: readonly string[]): Promise<Set<string>> {
    if (input.length === 0) return new Set();
    const list = input as string[];
    const rows = await this.db().$queryRaw<{ k: string }[]>`
      SELECT k FROM unnest(${list}::text[]) AS x(k)
       WHERE EXISTS (SELECT 1 FROM chat_attachments a
                      WHERE a.file_key = x.k OR a.preview_key = x.k OR a.thumb_key = x.k)`;
    return new Set(rows.map((r) => r.k));
  }
}

const keys = (a: {
  fileKey: string;
  previewKey: string | null;
  thumbKey: string | null;
}): string[] => [a.fileKey, a.previewKey, a.thumbKey].filter((k): k is string => k !== null);
