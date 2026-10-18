import type { UserRefDto } from '@taskflow/contracts/auth';
import type { AttachmentDto, AttachmentKind, MessageDto } from '@taskflow/contracts/chat';

// Tin nhắn + tệp của mock chat (avatar-chat.md ADR-141/144). Thứ tự (createdAt, id); keyset `before` / `after`;
// idempotent theo (sender, clientMsgId) + request hash; upload chưa gắn ⇒ gắn đúng một tin; xóa tin ⇒ tách tệp.

export type StoredMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  clientMsgId: string;
  requestHash: string;
  body: string | null;
  replyToId: string | null;
  attachmentIds: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

export type Upload = {
  id: string;
  uploaderId: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  messageId: string | null;
  createdAt: string;
};

/** Khung URL ảnh chat 1 giờ (ADR-141: URL sống 1–2 giờ). */
const IMAGE_BUCKET_MS = 3_600_000;

/** Kích thước ảnh từ header PNG (IHDR) / JPEG (SOFn); không đọc được ⇒ 800×600 (đủ để giữ chỗ khi cuộn). */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const u16 = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: u16(18), height: u16(22) };
  for (let i = 2; b[0] === 0xff && i + 9 < b.length;) {
    const marker = b[i + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xc3) return { width: u16(i + 7), height: u16(i + 5) };
    i += 2 + u16(i + 2);
  }
  return { width: 800, height: 600 };
}

export class MockChatMessages {
  private readonly byConv = new Map<string, StoredMessage[]>();
  readonly uploads = new Map<string, Upload>();

  constructor(
    private readonly baseUrl: string,
    private readonly now: () => number,
  ) {}

  of(convId: string): StoredMessage[] {
    return this.byConv.get(convId) ?? [];
  }

  last(convId: string): StoredMessage | undefined {
    return this.of(convId).at(-1);
  }

  find(id: string): StoredMessage | undefined {
    for (const list of this.byConv.values()) {
      const found = list.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }

  findByClient(senderId: string, clientMsgId: string): StoredMessage | undefined {
    for (const list of this.byConv.values()) {
      const found = list.find((m) => m.senderId === senderId && m.clientMsgId === clientMsgId);
      if (found) return found;
    }
    return undefined;
  }

  add(fields: Omit<StoredMessage, 'id' | 'createdAt' | 'editedAt' | 'deletedAt'>): StoredMessage {
    const message: StoredMessage = {
      ...fields,
      id: crypto.randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
      editedAt: null,
      deletedAt: null,
    };
    this.byConv.set(fields.conversationId, [...this.of(fields.conversationId), message]);
    for (const id of fields.attachmentIds) {
      const upload = this.uploads.get(id);
      if (upload) upload.messageId = message.id;
    }
    return message;
  }

  /** Xóa của chính mình: thân NULL, tệp tách khỏi tin cùng lúc ⇒ URL ảnh 404 ngay (ADR-144). */
  remove(message: StoredMessage): void {
    message.body = null;
    message.deletedAt = new Date(this.now()).toISOString();
    for (const id of message.attachmentIds) this.uploads.delete(id);
    message.attachmentIds = [];
  }

  /** Keyset: `before` ⇒ trang cũ hơn; `after` ⇒ bù khi nối lại; không có ⇒ trang mới nhất. */
  page(
    convId: string,
    q: { before?: string | undefined; after?: string | undefined; limit: number },
  ) {
    const list = this.of(convId);
    if (q.after) {
      const from = list.findIndex((m) => m.id === q.after) + 1;
      const data = list.slice(from, from + q.limit);
      return { data, hasMore: from + q.limit < list.length };
    }
    const end = q.before ? list.findIndex((m) => m.id === q.before) : list.length;
    const start = Math.max(0, (end < 0 ? list.length : end) - q.limit);
    return { data: list.slice(start, end < 0 ? list.length : end), hasMore: start > 0 };
  }

  /** URL "ký" giả — mock chỉ kiểm tệp còn gắn tin + hạn (ADR-141 B M4). */
  mediaUrl(attachmentId: string, variant: 'preview' | 'thumb'): string {
    const exp =
      Math.ceil((this.now() + IMAGE_BUCKET_MS) / IMAGE_BUCKET_MS) * (IMAGE_BUCKET_MS / 1000);
    return `${this.baseUrl}/media/chat/${attachmentId}/${variant}?v=1&exp=${exp}&sig=mock`;
  }

  attachmentDto(upload: Upload): AttachmentDto {
    const image = upload.kind === 'IMAGE';
    return {
      id: upload.id,
      kind: upload.kind,
      name: upload.name,
      mime: upload.mime,
      sizeBytes: upload.bytes.length,
      width: upload.width,
      height: upload.height,
      previewUrl: image ? this.mediaUrl(upload.id, 'preview') : null,
      thumbUrl: image ? this.mediaUrl(upload.id, 'thumb') : null,
    };
  }

  toDto(m: StoredMessage, userRef: (id: string) => UserRefDto): MessageDto {
    const reply = m.replyToId ? this.find(m.replyToId) : undefined;
    return {
      id: m.id,
      conversationId: m.conversationId,
      sender: userRef(m.senderId),
      clientMsgId: m.clientMsgId,
      body: m.body,
      replyTo: reply
        ? {
            id: reply.id,
            sender: userRef(reply.senderId),
            bodyPreview: reply.body === null ? null : [...reply.body].slice(0, 120).join(''),
            deleted: reply.deletedAt !== null,
          }
        : null,
      attachments: m.attachmentIds.flatMap((id) => {
        const upload = this.uploads.get(id);
        return upload ? [this.attachmentDto(upload)] : [];
      }),
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
    };
  }
}
