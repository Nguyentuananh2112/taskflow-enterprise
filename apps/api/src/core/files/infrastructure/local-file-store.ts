import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PayloadTooLargeError, StorageFullError } from '../../errors';
import { isFileKey, randomFileKey, relativePathOf, type FileKey } from '../domain/file-key';
import { SNIFF_HEAD_BYTES } from '../domain/sniff-type';
import {
  FileExistsError,
  FileMissingError,
  type IFileStore,
  type StagedFile,
  type StoredFile,
} from '../ports';
import { LocalStagedFile } from './local-staged-file';

/** Thao tác fs có thể thay ở test (CH-14: `link` ném EPERM; ổ trống giả lập). */
export interface FileStoreFs {
  /** Đặt tệp vào chỗ KHÔNG ghi đè (hard link — đích đã có ⇒ EEXIST). */
  link(from: string, to: string): Promise<void>;
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
/** Đặt vào chỗ gặp EPERM/EBUSY/EACCES (Windows + Defender — F-07): thử lại tối đa 5 lần × 50 ms. */
export const PLACE_RETRIES = 5;
export const PLACE_RETRY_DELAY_MS = 50;
const RETRYABLE_PLACE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Tuổi tối thiểu của tệp tạm để `files-sweep` xóa (B M-b): Linux xóa được cả tệp đang mở ⇒ ngưỡng phải
 * ≥ 2 × (trần một request upload 180 s + chờ hàng đợi ảnh + worker sharp 10 s) ≈ 7 phút. Chọn 1 giờ —
 * đường chính xóa tmp ngay khi lỗi/hủy, sweep chỉ là lưới an toàn (ADR-141).
 */
export const STALE_TEMP_AGE_MS = 60 * 60 * 1000;

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
  link: (from, to) => fsp.link(from, to),
  freeBytes: async (dir) => {
    const s = await fsp.statfs(dir);
    return s.bavail * s.bsize;
  },
};

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Đi theo symlink / junction (B L-a); đường dẫn chưa tồn tại ⇒ bản resolve. */
const real = (p: string): Promise<string> => fsp.realpath(p).catch(() => path.resolve(p));

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
  static async create(root: string, options: LocalFileStoreOptions = {}): Promise<LocalFileStore> {
    if (!path.isAbsolute(root)) throw new FileStoreConfigError('phải là đường dẫn tuyệt đối');
    const resolved = await real(root);
    const parents = await Promise.all((options.forbiddenParents ?? []).map(real));
    if (parents.some((p) => isInside(resolved, p))) {
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
      place: (from, to) => this.#placeWithRetry(from, to),
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
