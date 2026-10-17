import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PayloadTooLargeError, StorageFullError } from '../../errors';
import { isFileKey, randomFileKey, relativePathOf, type FileKey } from '../domain/file-key';
import { SNIFF_HEAD_BYTES } from '../domain/sniff-type';
import { FileMissingError, type IFileStore, type StagedFile, type StoredFile } from '../ports';
import { LocalStagedFile } from './local-staged-file';

/** Thao tác fs có thể thay ở test (CH-14: `rename` ném EPERM; ổ trống giả lập). */
export interface FileStoreFs {
  rename(from: string, to: string): Promise<void>;
  /** Byte còn trống cho tiến trình không đặc quyền. */
  freeBytes(dir: string): Promise<number>;
}

export interface LocalFileStoreOptions {
  fs?: Partial<FileStoreFs>;
  sleep?: (ms: number) => Promise<void>;
  /** Thư mục không được chứa kho (mã nguồn app, web root) — kho nằm trong ⇒ từ chối khởi động. */
  forbiddenParents?: readonly string[];
}

/** Ổ phải còn ≥ `maxBytes` + 10 % trước khi mở tệp tạm (B M7). */
export const FREE_SPACE_HEADROOM = 1.1;
/** `rename` gặp EPERM/EBUSY/EACCES (Windows + Defender — F-07): thử lại tối đa 5 lần × 50 ms. */
export const RENAME_RETRIES = 5;
export const RENAME_RETRY_DELAY_MS = 50;
const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);

const TMP_DIR = 'tmp';

export class FileStoreConfigError extends Error {
  constructor(reason: string) {
    super(`FILE_STORE_DIR không dùng được: ${reason}`);
    this.name = 'FileStoreConfigError';
  }
}

const errCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;

const defaultFs: FileStoreFs = {
  rename: (from, to) => fsp.rename(from, to),
  freeBytes: async (dir) => {
    const s = await fsp.statfs(dir);
    return s.bavail * s.bsize;
  },
};

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Adapter ổ cục bộ (ADR-141): `<root>/tmp/<khóa>` ⇒ `fsync` ⇒ `rename` vào `<root>/ab/cd/<khóa>`
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
  static async create(root: string, options: LocalFileStoreOptions = {}): Promise<LocalFileStore> {
    if (!path.isAbsolute(root)) throw new FileStoreConfigError('phải là đường dẫn tuyệt đối');
    const resolved = path.resolve(root);
    if ((options.forbiddenParents ?? []).some((p) => isInside(resolved, p))) {
      throw new FileStoreConfigError('nằm trong thư mục ứng dụng');
    }
    const stat = await fsp.stat(resolved).catch(() => undefined);
    if (!stat?.isDirectory())
      throw new FileStoreConfigError('không tồn tại hoặc không phải thư mục');
    const store = new LocalFileStore(resolved, options);
    try {
      await fsp.mkdir(store.#tmp, { recursive: true });
      const probe = path.join(store.#tmp, `.probe-${randomBytes(6).toString('hex')}`);
      await fsp.writeFile(probe, '', { flag: 'wx' });
      await fsp.unlink(probe);
    } catch {
      throw new FileStoreConfigError('không ghi được');
    }
    return store;
  }

  async stage(data: Buffer | Readable, options: { maxBytes: number }): Promise<StagedFile> {
    if (Buffer.isBuffer(data) && data.length > options.maxBytes) throw new PayloadTooLargeError();
    if ((await this.#fs.freeBytes(this.#root)) < options.maxBytes * FREE_SPACE_HEADROOM) {
      throw new StorageFullError();
    }
    const tmpPath = path.join(this.#tmp, randomFileKey(randomBytes(16)));
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
      rename: (from, to) => this.#renameWithRetry(from, to),
    });
  }

  async put(
    data: Buffer | Readable,
    options: { maxBytes: number; key?: FileKey },
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

  async #renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.#fs.rename(from, to);
        return;
      } catch (err) {
        if (attempt >= RENAME_RETRIES || !RETRYABLE_RENAME.has(errCode(err) ?? '')) throw err;
        await this.#sleep(RENAME_RETRY_DELAY_MS);
      }
    }
  }
}
