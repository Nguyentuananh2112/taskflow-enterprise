// Upload đính kèm (ADR-141/144; T-069). Kiểm nội dung + mã hóa lại ảnh nằm ở adapter (composition — kho tệp, sharp);
// use case chỉ thấy kết quả đã ghi vào kho.
import type { StagedFile } from '../../../../core/files/ports';
import type { AttachmentRecord } from './chat-message.port';

export type UploadAs = 'image' | 'file';

/** Đã ghi vào kho (blob đã commit) — chưa có dòng DB. */
export type StoredChatUpload = Omit<
  AttachmentRecord,
  'id' | 'uploaderId' | 'messageId' | 'createdAt'
>;

export interface IChatUploadProcessor {
  /**
   * `image`: sniff ⇒ ảnh JPEG/PNG/WebP/GIF ⇒ worker sharp ⇒ `preview` ≤ 1 600 + `thumb` ≤ 320 (WebP, không metadata,
   * KHÔNG giữ bản gốc); không phải ảnh ⇒ 415. `file`: sniff / `inspectZip` ⇒ lưu NGUYÊN byte (cả ảnh — "gửi dạng tệp").
   * Lỗi ⇒ không còn blob nào của lần này.
   */
  process(input: { name: string; as: UploadAs; staged: StagedFile }): Promise<StoredChatUpload>;
}

/** 200 MB / ngày / người (`CHAT_UPLOAD_DAILY_BYTES` ở test) — vượt ⇒ 429; kho đếm lỗi ⇒ 503 (fail-closed, ADR-141). */
export interface IUploadByteBudget {
  consume(userId: string, bytes: number): Promise<void>;
}
