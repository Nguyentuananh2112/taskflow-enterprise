import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';

import { ServiceUnavailableError } from '../../errors';
import {
  isFileNamespace,
  randomFileKey,
  type FileKey,
  type FileNamespace,
} from '../domain/file-key';
import type { StagedFile, StoredFile } from '../ports';

/** Phần của `LocalFileStore` mà bản tạm cần: kiểm khóa ⇒ đường dẫn, và đặt vào chỗ (không ghi đè). */
export interface StagedFileHost {
  /** Ném `RangeError` khi khóa sai — TRƯỚC mọi thao tác đĩa. */
  pathOf(key: FileKey): string;
  /** Đích đã có ⇒ `FileExistsError`. */
  place(from: string, to: string): Promise<void>;
}

const isEnoent = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';

/**
 * Bản tạm `<root>/tmp/<khóa>` của một upload — xem `StagedFile` (ports.ts). Giữ MỘT file handle đọc
 * cho tới commit/discard (B L-c: `inspectZip` đọc nhiều lần; mỗi lần mở ⇒ Defender quét lại).
 */
export class LocalStagedFile implements StagedFile {
  #state: 'staged' | 'committed' | 'discarded' = 'staged';
  #reader: Promise<fsp.FileHandle> | undefined;

  constructor(
    private readonly tmpPath: string,
    readonly sizeBytes: number,
    readonly sha256: string,
    readonly head: Buffer,
    private readonly host: StagedFileHost,
  ) {}

  get size(): number {
    return this.sizeBytes;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.#state !== 'staged') throw new Error('bản tạm đã kết thúc');
    this.#reader ??= fsp.open(this.tmpPath, 'r');
    const fh = await this.#reader;
    const start = Math.max(0, offset);
    const len = Math.max(0, Math.min(length, this.sizeBytes - start));
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead);
  }

  readAll(): Promise<Buffer> {
    return fsp.readFile(this.tmpPath);
  }

  async commit(target: FileKey | FileNamespace): Promise<StoredFile> {
    // Đã bị bỏ (client đi khi worker sharp còn chạy ⇒ response đóng ⇒ discard — B) ⇒ 503 có kiểm soát.
    if (this.#state === 'discarded') throw new ServiceUnavailableError();
    if (this.#state === 'committed') throw new Error('bản tạm đã commit');
    this.#state = 'discarded'; // mọi lối ra bên dưới đều kết thúc bản tạm
    await this.#closeReader();
    const finalKey = isFileNamespace(target) ? randomFileKey(target, randomBytes(16)) : target;
    try {
      const dest = this.host.pathOf(finalKey); // khóa sai ⇒ ném, tmp vẫn bị xóa bên dưới
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await this.host.place(this.tmpPath, dest);
    } catch (err) {
      await fsp.unlink(this.tmpPath).catch(() => undefined);
      // Bản tạm đã bị sweep xóa (B M-b) ⇒ lỗi có kiểm soát, không 500 trần.
      if (isEnoent(err)) throw new ServiceUnavailableError(undefined, err);
      throw err;
    }
    this.#state = 'committed';
    return { key: finalKey, sizeBytes: this.sizeBytes, sha256: this.sha256 };
  }

  async discard(): Promise<void> {
    if (this.#state !== 'staged') return;
    this.#state = 'discarded';
    await this.#closeReader();
    await fsp.unlink(this.tmpPath).catch(() => undefined);
  }

  async #closeReader(): Promise<void> {
    const reader = this.#reader;
    this.#reader = undefined;
    await reader?.then((fh) => fh.close()).catch(() => undefined);
  }
}
