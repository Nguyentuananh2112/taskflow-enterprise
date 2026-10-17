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
import {
  defaultFs,
  errCode,
  FileStoreConfigError,
  FREE_SPACE_HEADROOM,
  isInside,
  PLACE_RETRIES,
  PLACE_RETRY_DELAY_MS,
  real,
  RETRYABLE_PLACE,
  TMP_DIR,
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
    await store.#probeHardLink();
    return store;
  }

  /**
   * `commit` đặt tệp bằng hard link (không ghi đè). FAT/exFAT, một số mount mạng, bind mount của Docker
   * Desktop trả EPERM/ENOTSUP/EXDEV ⇒ phát hiện lúc khởi động thay vì mọi upload chậm rồi lỗi (B L-d).
   */
  async #probeHardLink(): Promise<void> {
    const tag = randomBytes(6).toString('hex');
    const from = path.join(this.#tmp, `.probe-${tag}`);
    const to = path.join(this.#tmp, `.probe-${tag}-link`);
    try {
      await fsp.writeFile(from, '', { flag: 'wx' });
      await this.#fs.link(from, to);
    } catch {
      throw new FileStoreConfigError('hệ thống tệp không hỗ trợ hard link (cần ext4/xfs/NTFS)');
    } finally {
      await fsp.unlink(to).catch(() => undefined);
      await fsp.unlink(from).catch(() => undefined);
    }
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
