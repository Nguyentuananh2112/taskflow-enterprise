import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PayloadTooLargeError, StorageFullError } from '../../errors';
import {
  base32Token,
  isFileKey,
  isFileNamespace,
  relativePathOf,
  type FileKey,
  type FileNamespace,
} from '../domain/file-key';
import { SNIFF_HEAD_BYTES } from '../domain/sniff-type';
import {
  FileExistsError,
  FileMissingError,
  type IFileStore,
  type StagedFile,
  type StoredFile,
} from '../ports';
import {
  defaultFs,
  errCode,
  FREE_SPACE_HEADROOM,
  PLACE_RETRIES,
  PLACE_RETRY_DELAY_MS,
  RETRYABLE_PLACE,
  TMP_DIR,
  prepareStoreRoot,
  walkFiles,
  type FileStoreFs,
  type LocalFileStoreOptions,
} from './local-fs';
import { LocalStagedFile } from './local-staged-file';

export {
  FileStoreConfigError,
  FREE_SPACE_HEADROOM,
  PLACE_RETRIES,
  PLACE_RETRY_DELAY_MS,
  STALE_TEMP_AGE_MS,
  type FileStoreFs,
  type LocalFileStoreOptions,
} from './local-fs';

/**
 * Adapter ổ cục bộ (ADR-141): `<root>/tmp/<khóa>` ⇒ `fsync` ⇒ hard link (không ghi đè) vào `<root>/ab/cd/<khóa>`
 * (hoặc `avatars/<userId>/<version>/<variant>`). Khóa kiểm bằng regex TRƯỚC mọi thao tác đĩa.
 */
export class LocalFileStore implements IFileStore {
  readonly #root: string;
  readonly #tmp: string;
  readonly #fs: FileStoreFs;
  readonly #sleep: (ms: number) => Promise<void>;

  private constructor(root: string, options: LocalFileStoreOptions) {
    this.#root = root;
    this.#tmp = path.join(root, TMP_DIR);
    this.#fs = { ...defaultFs, ...options.fs };
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Kiểm lúc khởi động: tuyệt đối, là thư mục, ghi được, ngoài thư mục cấm. Sai ⇒ ném (từ chối khởi động). */
  /** Kiểm lúc khởi động (`prepareStoreRoot`): tuyệt đối, là thư mục, ghi được, có hard link, ngoài thư mục cấm. */
  static async create(root: string, options: LocalFileStoreOptions = {}): Promise<LocalFileStore> {
    const fs = { ...defaultFs, ...options.fs };
    return new LocalFileStore(await prepareStoreRoot(root, options, fs), options);
  }

  async stage(data: Buffer | Readable, options: { maxBytes: number }): Promise<StagedFile> {
    if (Buffer.isBuffer(data) && data.length > options.maxBytes) throw new PayloadTooLargeError();
    if ((await this.#fs.freeBytes(this.#root)) < options.maxBytes * FREE_SPACE_HEADROOM) {
      throw new StorageFullError();
    }
    const tmpPath = path.join(this.#tmp, base32Token(randomBytes(16)));
    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLen = 0;
    let size = 0;
    const fh = await fsp.open(tmpPath, 'wx', 0o600);
    try {
      const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer | string>) {
          for await (const raw of chunks) {
            const chunk = typeof raw === 'string' ? Buffer.from(raw) : raw;
            size += chunk.length;
            if (size > options.maxBytes) throw new PayloadTooLargeError();
            hash.update(chunk);
            if (headLen < SNIFF_HEAD_BYTES) {
              const take = chunk.subarray(0, SNIFF_HEAD_BYTES - headLen);
              headChunks.push(take);
              headLen += take.length;
            }
            yield chunk;
          }
        },
        // `flush` ⇒ fsync trước khi đóng; `autoClose` ⇒ có sự kiện `close` mà `pipeline` chờ.
        fh.createWriteStream({ flush: true }),
      );
    } catch (err) {
      await fh.close().catch(() => undefined);
      await fsp.unlink(tmpPath).catch(() => undefined); // lỗi / hủy ⇒ xóa tmp NGAY (ADR-141)
      throw err;
    }
    return new LocalStagedFile(tmpPath, size, hash.digest('hex'), Buffer.concat(headChunks), {
      pathOf: (key) => this.#pathOf(key),
      place: (from, to) => this.#placeWithRetry(from, to),
    });
  }

  async put(
    data: Buffer | Readable,
    options: { maxBytes: number; key: FileKey | FileNamespace },
  ): Promise<StoredFile> {
    const staged = await this.stage(data, options);
    try {
      return await staged.commit(options.key);
    } finally {
      await staged.discard();
    }
  }

  async open(key: FileKey): Promise<{ stream: Readable; sizeBytes: number }> {
    const fh = await fsp.open(this.#pathOf(key), 'r').catch((err: unknown) => {
      throw errCode(err) === 'ENOENT' ? new FileMissingError(key) : err;
    });
    try {
      const { size } = await fh.stat();
      return { stream: fh.createReadStream(), sizeBytes: size };
    } catch (err) {
      await fh.close().catch(() => undefined);
      throw err;
    }
  }

  async delete(key: FileKey): Promise<void> {
    await fsp.unlink(this.#pathOf(key)).catch((err: unknown) => {
      if (errCode(err) !== 'ENOENT') throw err;
    });
  }

  async exists(key: FileKey): Promise<boolean> {
    const p = this.#pathOf(key);
    return fsp.access(p).then(
      () => true,
      (err: unknown) => {
        if (errCode(err) === 'ENOENT') return false;
        throw err;
      },
    );
  }

  async touch(key: FileKey, at: Date): Promise<void> {
    await fsp.utimes(this.#pathOf(key), at, at).catch((err: unknown) => {
      if (errCode(err) !== 'ENOENT') throw err;
    });
  }

  async *list(
    prefix: `avatars/${string}` | FileNamespace,
  ): AsyncIterable<{ key: FileKey; modifiedAt: Date }> {
    if (isFileNamespace(prefix)) {
      // CHỈ namespace được hỏi: `<ns>/ab/cd/<26>` đúng vị trí của khóa (tệp lạ bị bỏ qua).
      for await (const f of walkFiles(this.#root, prefix)) {
        const token = /^[a-z2-7]{2}\/[a-z2-7]{2}\/([a-z2-7]{26})$/.exec(
          f.relative.slice(prefix.length + 1),
        )?.[1];
        const key = `${prefix}/${token ?? ''}`;
        if (token && isFileKey(key) && relativePathOf(key) === f.relative) {
          yield { key, modifiedAt: f.modifiedAt };
        }
      }
      return;
    }
    // Chỉ tiền tố an toàn: `avatars/` hoặc `avatars/<uuid>/` (không `..`, không ký tự lạ) — trước mọi thao tác đĩa.
    if (!/^avatars\/(?:[0-9a-f-]{36}\/)?$/.test(prefix))
      throw new RangeError('tiền tố không hợp lệ');
    for await (const f of walkFiles(this.#root, prefix.replace(/\/$/, ''))) {
      if (isFileKey(f.relative)) yield { key: f.relative, modifiedAt: f.modifiedAt };
    }
  }

  async purgeStaleTemp(before: Date): Promise<number> {
    let removed = 0;
    for (const name of await fsp.readdir(this.#tmp)) {
      const p = path.join(this.#tmp, name);
      const stat = await fsp.stat(p).catch(() => undefined);
      if (stat?.isFile() && stat.mtime < before) {
        await fsp.unlink(p).then(
          () => (removed += 1),
          () => undefined, // đang bị upload khác giữ / đã bị xóa — lượt sau
        );
      }
    }
    return removed;
  }

  /** Kiểm khóa TRƯỚC mọi thao tác đĩa (ranh giới path traversal). */
  #pathOf(key: string): string {
    if (!isFileKey(key)) throw new RangeError('khóa tệp không hợp lệ');
    return path.join(this.#root, ...relativePathOf(key).split('/'));
  }

  /** Hard link rồi bỏ tmp: KHÔNG ghi đè (B M-a) — đích đã có ⇒ `FileExistsError`, không thử lại. */
  async #placeWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.#fs.link(from, to);
        break;
      } catch (err) {
        const code = errCode(err) ?? '';
        if (code === 'EEXIST') throw new FileExistsError();
        if (attempt >= PLACE_RETRIES || !RETRYABLE_PLACE.has(code)) throw err;
        await this.#sleep(PLACE_RETRY_DELAY_MS);
      }
    }
    await fsp.unlink(from).catch(() => undefined); // còn sót ⇒ `purgeStaleTemp`
  }
}
