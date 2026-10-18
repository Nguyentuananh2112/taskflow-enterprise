import { StorageFullError } from '../errors';

/**
 * Trần dung lượng kho `FILE_STORE_MAX_BYTES` (ADR-141, người dùng 17/10: 50 GB) ⇒ 507 `STORAGE_FULL`. Số đã
 * dùng = lần đo gần nhất (duyệt cây thư mục kho) + phần cộng NGAY sau mỗi commit; đo lại khi quá `cacheMs`
 * (đối soát — tệp bị sweep / xóa tay). Kiểm TRƯỚC khi ghi bản tạm (rawUpload).
 */
export class StorageQuota {
  #measured = 0;
  #added = 0;
  #measuredAt = Number.NEGATIVE_INFINITY;
  #measuring: Promise<void> | undefined;

  constructor(
    private readonly measure: () => Promise<number>,
    private readonly maxBytes: number,
    private readonly cacheMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async usedBytes(): Promise<number> {
    if (this.now() - this.#measuredAt >= this.cacheMs) {
      this.#measuring ??= this.measure().then(
        (bytes) => {
          this.#measured = bytes;
          this.#added = 0;
          this.#measuredAt = this.now();
          this.#measuring = undefined;
        },
        (err: unknown) => {
          this.#measuring = undefined;
          throw err;
        },
      );
      await this.#measuring;
    }
    return this.#measured + this.#added;
  }

  /** Còn chỗ cho `incomingBytes` nữa không — hết ⇒ `StorageFullError` (507). */
  async ensure(incomingBytes: number): Promise<void> {
    if ((await this.usedBytes()) + incomingBytes > this.maxBytes) throw new StorageFullError();
  }

  /** Sau mỗi commit: cập nhật ngay, không chờ lần đo kế. */
  add(bytes: number): void {
    this.#added += bytes;
  }

  /** Tỉ lệ đã dùng (gauge + cảnh báo ≥ 90 %). */
  async ratio(): Promise<number> {
    return (await this.usedBytes()) / this.maxBytes;
  }
}
