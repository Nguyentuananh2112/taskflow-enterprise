import type { Readable } from 'node:stream';

import type { FileKey } from './domain/file-key';
import type { RandomAccessSource } from './domain/inspect-zip';

/**
 * Kho tệp (ADR-141). Core không biết module nào (ADR-016); use case chỉ thấy port này ⇒ đổi
 * `LocalFileStore` sang MinIO/S3 tự host không đổi use case.
 *
 * Hai pha cho upload: `stage` ghi vào vùng tạm (đếm byte, SHA-256, giữ phần đầu để sniff) ⇒ kiểm
 * nội dung trên bản tạm ⇒ `commit` (rename vào chỗ) hoặc `discard`. Blob chỉ hiện ra khi đã qua kiểm
 * tra; mọi lỗi / hủy ⇒ vùng tạm bị xóa ngay. `put` = `stage` + `commit` cho dữ liệu đã kiểm (biến thể ảnh).
 */
export interface IFileStore {
  stage(data: Buffer | Readable, options: { maxBytes: number }): Promise<StagedFile>;
  put(data: Buffer | Readable, options: { maxBytes: number; key?: FileKey }): Promise<StoredFile>;
  /** ENOENT ⇒ `FileMissingError` (blob mất trên đĩa — `/media` trả 404 + log, không 500). */
  open(key: FileKey): Promise<{ stream: Readable; sizeBytes: number }>;
  /** Idempotent: không có ⇒ bỏ qua. */
  delete(key: FileKey): Promise<void>;
  exists(key: FileKey): Promise<boolean>;
  /** Lưới an toàn của `files-sweep`: xóa tệp tạm sửa lần cuối trước `before`. Trả số tệp đã xóa. */
  purgeStaleTemp(before: Date): Promise<number>;
}

export interface StoredFile {
  key: FileKey;
  sizeBytes: number;
  /** Hex chữ thường, 64 ký tự. */
  sha256: string;
}

/** Bản tạm của một upload — PHẢI kết thúc bằng `commit` hoặc `discard` (dùng try/finally). */
export interface StagedFile extends RandomAccessSource {
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Tối đa `SNIFF_HEAD_BYTES` byte đầu. `head.length === sizeBytes` ⇔ tệp nằm trọn trong `head`. */
  readonly head: Buffer;
  /** Đọc toàn bộ vào bộ nhớ (ảnh ≤ 20 MB cho worker sharp — ADR-141). */
  readAll(): Promise<Buffer>;
  /** Đưa vào kho với khóa mới (hoặc `key` cho trước). Gọi một lần. */
  commit(key?: FileKey): Promise<StoredFile>;
  /** Xóa bản tạm; idempotent, gọi sau `commit` không làm gì. */
  discard(): Promise<void>;
}

export class FileMissingError extends Error {
  constructor(readonly key: FileKey) {
    super('Blob không còn trên đĩa');
    this.name = 'FileMissingError';
  }
}
