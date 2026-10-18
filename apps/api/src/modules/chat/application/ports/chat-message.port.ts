// Port tin nhắn, con trỏ đã đọc và đính kèm (avatar-chat.md ADR-144/145/147; T-069a). Chạy trong `uow.run` của bên
// gọi. Repo trả KHÓA blob (`fileKey` …), G ký URL ở use case.

export type AttachmentKind = 'IMAGE' | 'FILE';

export interface AttachmentRecord {
  readonly id: string;
  readonly uploaderId: string;
  readonly messageId: string | null;
  readonly kind: AttachmentKind;
  /** Đã qua `sanitizeFileName` (G) — chỉ hiển thị. */
  readonly name: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly fileKey: string;
  readonly previewKey: string | null;
  readonly thumbKey: string | null;
  readonly createdAt: Date;
}

export interface ReplyRecord {
  readonly id: string;
  readonly senderId: string;
  /** ≤ 120 code point; null khi tin gốc đã xóa / chỉ có đính kèm. */
  readonly bodyPreview: string | null;
  readonly deleted: boolean;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMsgId: string;
  readonly requestHash: string;
  /** null khi đã xóa. */
  readonly body: string | null;
  readonly replyTo: ReplyRecord | null;
  /** Theo `created_at, id`; rỗng sau khi xóa (đã tách). */
  readonly attachments: readonly AttachmentRecord[];
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

export interface NewMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMsgId: string;
  /** Domain `requestHash(...)`. */
  readonly requestHash: string;
  /** Đã chuẩn hóa; null khi chỉ có đính kèm. */
  readonly body: string | null;
  readonly replyToId: string | null;
  /** Đã kiểm qua `claimableUploads` trong CÙNG transaction. */
  readonly attachmentIds: readonly string[];
  readonly at: Date;
}

export interface IChatMessageStore {
  /**
   * INSERT … ON CONFLICT (sender_id, client_msg_id) DO NOTHING. Tạo mới ⇒ gắn đính kèm + cập nhật
   * `last_message_at/id` của hội thoại trong cùng transaction. Trùng ⇒ trả tin CŨ (bên gọi so `requestHash`, domain
   * `idempotencyOutcome`) — không ghi gì.
   */
  insert(input: NewMessage): Promise<{ created: boolean; message: MessageRecord }>;
  findById(id: string): Promise<MessageRecord | null>;
  /**
   * Tin của `senderId` với `clientMsgId` (UNIQUE) — G, CC-CH-01: gửi lại có đính kèm phải thấy tin cũ TRƯỚC khi claim
   * upload (upload đã gắn vào tin đầu ⇒ claim thiếu ⇒ nếu không tra trước sẽ 404 sai). Người gửi khác ⇒ null.
   */
  findByClientMsgId(senderId: string, clientMsgId: string): Promise<MessageRecord | null>;
  /** `SELECT … FOR UPDATE` (sửa / xóa đồng thời). */
  lock(id: string): Promise<void>;
  /**
   * Keyset `(created_at, id)`. `before` ⇒ cũ hơn tin đó, trả theo thứ tự TĂNG DẦN, `hasMore` = còn cũ hơn; `after` ⇒
   * mới hơn, tăng dần, `hasMore` = còn mới hơn; không cả hai ⇒ trang mới nhất. Id không thuộc hội thoại ⇒ trang rỗng.
   */
  page(
    conversationId: string,
    q: { before?: string; after?: string; limit: number },
  ): Promise<{ items: MessageRecord[]; hasMore: boolean }>;
  edit(id: string, body: string, at: Date): Promise<void>;
  /**
   * `deleted_at = at`, `body = NULL` và XÓA dòng đính kèm của tin cùng transaction (ảnh 404 ngay — ADR-141) ⇒ trả các
   * dòng đã xóa để bên gọi xóa blob SAU commit (lỡ crash ⇒ files-sweep dọn blob không còn tham chiếu). Không giữ dòng
   * "đã tách" với `message_id NULL` — schema §3 không phân biệt được với upload chưa gắn.
   */
  softDelete(id: string, at: Date): Promise<AttachmentRecord[]>;
}

export interface ReadStateRecord {
  readonly lastReadMessageId: string | null;
  readonly muted: boolean;
}

export interface IChatReadStateStore {
  get(conversationId: string, userId: string): Promise<ReadStateRecord>;
  /** Chỉ TIẾN theo `(created_at, id)` của tin; tin lùi / tin không thuộc hội thoại ⇒ false, không ghi. Tạo lười. */
  advance(conversationId: string, userId: string, messageId: string, at: Date): Promise<boolean>;
  setMuted(conversationId: string, userId: string, muted: boolean, at: Date): Promise<void>;
}

export interface IChatAttachmentStore {
  /** Bản ghi upload (chưa gắn) sau khi G đã ghi blob. */
  createUpload(input: Omit<AttachmentRecord, 'messageId'>): Promise<AttachmentRecord>;
  /**
   * Upload của `uploaderId`, chưa gắn, trong `ids` — khóa `FOR UPDATE` (2 tin đồng thời không gắn cùng upload).
   * Bên gọi so số lượng với `ids` (thiếu ⇒ 404).
   */
  claimableUploads(ids: readonly string[], uploaderId: string): Promise<AttachmentRecord[]>;
  findById(id: string): Promise<AttachmentRecord | null>;
  /** Hội thoại của tin chứa đính kèm (download-url kiểm quyền); chưa gắn / tin đã xóa ⇒ null. */
  conversationOf(attachmentId: string): Promise<string | null>;

  // ---- retention (chat-retention / files-sweep của G) — theo lô, xóa DB trước, bên gọi xóa đĩa SAU commit
  /** Xóa tin `created_at < cutoff` (kèm đính kèm của chúng); trả số tin + mọi khóa blob của đính kèm đã xóa. */
  purgeMessagesBefore(
    cutoff: Date,
    limit: number,
  ): Promise<{ deleted: number; blobKeys: string[] }>;
  /** Xóa upload chưa gắn `created_at < cutoff`; trả khóa blob. */
  purgeOrphanUploadsBefore(cutoff: Date, limit: number): Promise<string[]>;
  /** files-sweep: trong `keys` (đọc từ đĩa), khóa nào còn được một dòng tham chiếu (file / preview / thumb). */
  existingBlobKeys(keys: readonly string[]): Promise<Set<string>>;
}
