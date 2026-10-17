import type { Readable } from 'node:stream';

import type { FileKey, FileNamespace } from './domain/file-key';
import type { ImageType } from './domain/sniff-type';
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
  /** `key`: khóa cho trước (avatar) hoặc namespace của module ⇒ khóa ngẫu nhiên `<ns>/<26>`. */
  put(
    data: Buffer | Readable,
    options: { maxBytes: number; key: FileKey | FileNamespace },
  ): Promise<StoredFile>;
  /** ENOENT ⇒ `FileMissingError` (blob mất trên đĩa — `/media` trả 404 + log, không 500). */
  open(key: FileKey): Promise<{ stream: Readable; sizeBytes: number }>;
  /** Idempotent: không có ⇒ bỏ qua. */
  delete(key: FileKey): Promise<void>;
  exists(key: FileKey): Promise<boolean>;
  /** Lưới an toàn của `files-sweep`: xóa tệp tạm sửa lần cuối trước `before`. Trả số tệp đã xóa. */
  purgeStaleTemp(before: Date): Promise<number>;
  /** Đặt mốc sửa đổi = `at` (T-068: avatar bị gỡ ⇒ blob giữ 30 ngày TỪ lúc gỡ — D13, B). Không có ⇒ bỏ qua. */
  touch(key: FileKey, at: Date): Promise<void>;
  /**
   * Blob kèm mốc sửa đổi — cho bước sweep của module: `avatars/…` theo tiền tố (T-068); namespace (`chat`) = mọi blob
   * khóa ngẫu nhiên CỦA module đó (T-069). RÀNG BUỘC (B M1): bước dọn của một module chỉ được quét namespace / tiền
   * tố của chính nó — không bao giờ liệt kê cả kho rồi xóa "khóa không có trong bảng của tôi".
   */
  list(
    prefix: `avatars/${string}` | FileNamespace,
  ): AsyncIterable<{ key: FileKey; modifiedAt: Date }>;
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
  /**
   * Đưa vào kho: namespace ⇒ khóa ngẫu nhiên mới `<ns>/<26>`; hoặc khóa cho trước (avatar). Gọi một lần. KHÔNG BAO GIỜ ghi đè: đích đã có ⇒
   * `FileExistsError` (hai upload avatar đua cùng version — B M-a). Bản tạm đã bị sweep xóa ⇒ 503.
   */
  commit(target: FileKey | FileNamespace): Promise<StoredFile>;
  /** Xóa bản tạm; idempotent, gọi sau `commit` không làm gì. */
  discard(): Promise<void>;
}

/**
 * Kiểm DB MỖI lần phục vụ `/media` SAU khi chữ ký đúng (ADR-141, B M4, F-03h): avatar còn đúng `version` và
 * chủ còn thuộc công ty; đính kèm còn gắn tin CHƯA xóa, chưa hết retention. Không còn ⇒ `null` ⇒ 404.
 * Adapter Prisma ở T-068 (avatar) / T-069 (chat).
 */
export interface IMediaResolver {
  resolve(target: {
    kind: 'avatars' | 'chat';
    id: string;
    variant: string;
    version: number;
  }): Promise<ResolvedMedia | null>;
}

export type ResolvedMedia =
  | { key: FileKey; as: 'image' }
  /** Tệp tải xuống — `name` đã làm sạch, dùng cho `Content-Disposition`. */
  | { key: FileKey; as: 'download'; name: string };

export class FileMissingError extends Error {
  constructor(readonly key: FileKey) {
    super('Blob không còn trên đĩa');
    this.name = 'FileMissingError';
  }
}

/** Đích của `commit` đã tồn tại — caller cấp khóa/version mới hoặc trả 409. */
export class FileExistsError extends Error {
  constructor() {
    super('Blob đích đã tồn tại');
    this.name = 'FileExistsError';
  }
}

/** Một biến thể đầu ra: cạnh dài tối đa `size` px; `cover` = cắt vuông (avatar), `inside` = giữ tỉ lệ (chat). */
export interface ImageVariantSpec {
  name: string;
  size: number;
  fit: 'cover' | 'inside';
}

export interface ImageVariant {
  name: string;
  /** WebP mã hóa lại, không metadata. */
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Mã hóa lại ảnh trong worker (ADR-141, B HIGH-2). Lỗi: định dạng ≠ `expected` ⇒ `UnsupportedFileTypeError`
 * (415); ảnh hỏng ⇒ 422 `IMAGE_UNREADABLE`; vượt trần điểm ảnh / quá thời gian ⇒ 422 `IMAGE_TOO_COMPLEX`;
 * hàng đợi đầy ⇒ 503 `IMAGE_PROCESSING_BUSY`; không nạp được ⇒ 503 `IMAGE_PROCESSING_UNAVAILABLE`.
 */
export interface IImagePipeline {
  /** `maxPixels`: trần điểm ảnh THEO MỤC ĐÍCH (avatar thấp hơn chat — T-068, B); worker dùng min(maxPixels, trần chung). */
  transform(
    input: Buffer,
    expected: ImageType,
    variants: readonly ImageVariantSpec[],
    options?: { maxPixels?: number },
  ): Promise<ImageVariant[]>;
  /** Tự kiểm (biến đổi ảnh 1 px) — lúc khởi động và mỗi 5 phút; cập nhật gauge `files_image_worker_up`. */
  selfTest(): Promise<boolean>;
  close(): Promise<void>;
}
