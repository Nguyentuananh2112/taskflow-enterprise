import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';

import { randomFileKey, type FileKey } from '../domain/file-key';
import type { StagedFile, StoredFile } from '../ports';

/** Phần của `LocalFileStore` mà bản tạm cần: kiểm khóa ⇒ đường dẫn, và `rename` có thử lại. */
export interface StagedFileHost {
  /** Ném `RangeError` khi khóa sai — TRƯỚC mọi thao tác đĩa. */
  pathOf(key: FileKey): string;
  rename(from: string, to: string): Promise<void>;
}

/** Bản tạm `<root>/tmp/<khóa>` của một upload — xem `StagedFile` (ports.ts). */
export class LocalStagedFile implements StagedFile {
  #state: 'staged' | 'committed' | 'discarded' = 'staged';

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
    const fh = await fsp.open(this.tmpPath, 'r');
    try {
      const start = Math.max(0, offset);
      const len = Math.max(0, Math.min(length, this.sizeBytes - start));
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  readAll(): Promise<Buffer> {
    return fsp.readFile(this.tmpPath);
  }

  async commit(key?: FileKey): Promise<StoredFile> {
    if (this.#state !== 'staged') throw new Error('bản tạm đã kết thúc');
    const finalKey = key ?? randomFileKey(randomBytes(16));
    try {
      const dest = this.host.pathOf(finalKey); // khóa sai ⇒ ném, tmp vẫn bị xóa bên dưới
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await this.host.rename(this.tmpPath, dest);
    } catch (err) {
      this.#state = 'discarded';
      await fsp.unlink(this.tmpPath).catch(() => undefined);
      throw err;
    }
    this.#state = 'committed';
    return { key: finalKey, sizeBytes: this.sizeBytes, sha256: this.sha256 };
  }

  async discard(): Promise<void> {
    if (this.#state !== 'staged') return;
    this.#state = 'discarded';
    await fsp.unlink(this.tmpPath).catch(() => undefined);
  }
}
