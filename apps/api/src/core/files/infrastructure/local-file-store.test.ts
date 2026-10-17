import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayloadTooLargeError, ServiceUnavailableError, StorageFullError } from '../../errors';
import { avatarFileKey, type FileKey } from '../domain/file-key';
import { SNIFF_HEAD_BYTES } from '../domain/sniff-type';
import { FileExistsError, FileMissingError } from '../ports';
import {
  FileStoreConfigError,
  LocalFileStore,
  PLACE_RETRIES,
  STALE_TEMP_AGE_MS,
  type LocalFileStoreOptions,
} from './local-file-store';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-filestore-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

const tmpEntries = () => fsp.readdir(path.join(root, 'tmp'));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const make = (options: LocalFileStoreOptions = {}) => LocalFileStore.create(root, options);
const errno = (code: string) => Object.assign(new Error(code), { code });

describe('LocalFileStore.create — kiểm lúc khởi động', () => {
  it('đường dẫn tương đối ⇒ từ chối', async () => {
    await expect(LocalFileStore.create('relative/dir')).rejects.toBeInstanceOf(
      FileStoreConfigError,
    );
  });

  it('không tồn tại ⇒ từ chối', async () => {
    await expect(LocalFileStore.create(path.join(root, 'missing'))).rejects.toBeInstanceOf(
      FileStoreConfigError,
    );
  });

  it('là tệp, không phải thư mục ⇒ từ chối', async () => {
    const file = path.join(root, 'f');
    await fsp.writeFile(file, 'x');
    await expect(LocalFileStore.create(file)).rejects.toBeInstanceOf(FileStoreConfigError);
  });

  it('nằm trong thư mục ứng dụng ⇒ từ chối', async () => {
    await expect(make({ forbiddenParents: [path.dirname(root)] })).rejects.toThrow(
      /thư mục ứng dụng/,
    );
  });

  it('đi theo junction/symlink: kho trỏ vào thư mục cấm qua liên kết ⇒ từ chối (B L-a)', async () => {
    const app = path.join(root, 'app');
    const inside = path.join(app, 'files');
    await fsp.mkdir(inside, { recursive: true });
    const link = path.join(root, 'store-link');
    await fsp.symlink(inside, link, 'junction');
    await expect(LocalFileStore.create(link, { forbiddenParents: [app] })).rejects.toThrow(
      /thư mục ứng dụng/,
    );
  });

  it.each(['ENOTSUP', 'EXDEV', 'EPERM'])(
    'FS không hỗ trợ hard link (%s) ⇒ từ chối khởi động, không sót tệp thử (B L-d)',
    async (code) => {
      await expect(make({ fs: { link: () => Promise.reject(errno(code)) } })).rejects.toThrow(
        /hard link/,
      );
      expect(await tmpEntries()).toEqual([]);
    },
  );

  it('EXDEV / ENOTSUP lúc commit không được thử lại', async () => {
    let calls = 0;
    let probed = false;
    const store = await make({
      sleep: () => Promise.resolve(),
      fs: {
        link: (from, to) => {
          if (!probed) return ((probed = true), fsp.link(from, to)); // probe lúc khởi động
          calls += 1;
          return Promise.reject(errno('EXDEV'));
        },
      },
    });
    await expect(store.put(Buffer.from('x'), { maxBytes: 10 })).rejects.toMatchObject({
      code: 'EXDEV',
    });
    expect(calls).toBe(1);
  });

  it('hợp lệ ⇒ tạo tmp/, không để lại tệp thử', async () => {
    await make({ forbiddenParents: [path.join(root, 'other')] });
    expect(await tmpEntries()).toEqual([]);
  });
});

describe('LocalFileStore — ghi', () => {
  it('put Buffer ⇒ khóa 26 ký tự, ab/cd/<khóa>, sha256 + kích thước đúng, không sót tmp', async () => {
    const store = await make();
    const data = Buffer.from('xin chào');
    const stored = await store.put(data, { maxBytes: 100 });
    expect(stored.key).toMatch(/^[a-z2-7]{26}$/);
    expect(stored).toMatchObject({ sizeBytes: data.length, sha256: sha(data) });
    const onDisk = path.join(root, stored.key.slice(0, 2), stored.key.slice(2, 4), stored.key);
    expect(await fsp.readFile(onDisk)).toEqual(data);
    expect(await tmpEntries()).toEqual([]);
  });

  it('put với khóa avatar ⇒ avatars/<userId>/<version>/<variant>; KHÔNG ghi đè (B M-a)', async () => {
    const store = await make();
    const key = avatarFileKey('0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a', 1, '64');
    await store.put(Buffer.from('a'), { maxBytes: 10, key });
    await expect(store.put(Buffer.from('b'), { maxBytes: 10, key })).rejects.toBeInstanceOf(
      FileExistsError,
    );
    expect(await fsp.readFile(path.join(root, ...key.split('/')), 'utf8')).toBe('a');
    expect(await tmpEntries()).toEqual([]);
  });

  it('hai upload đua cùng khóa avatar ⇒ đúng một thắng, blob nguyên vẹn, không sót tmp', async () => {
    const store = await make();
    const key = avatarFileKey('0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a', 2, '256');
    const [a, b] = [Buffer.alloc(4096, 1), Buffer.alloc(4096, 2)];
    const results = await Promise.allSettled([
      store.put(a, { maxBytes: 10_000, key }),
      store.put(b, { maxBytes: 10_000, key }),
    ]);
    const lost = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(FileExistsError);
    const onDisk = await fsp.readFile(path.join(root, ...key.split('/')));
    expect([sha(a), sha(b)]).toContain(sha(onDisk));
    expect(await tmpEntries()).toEqual([]);
  });

  it('bản tạm bị sweep xóa trước commit ⇒ 503 có kiểm soát, không 500 trần (B M-b)', async () => {
    const store = await make();
    const staged = await store.stage(Buffer.from('abc'), { maxBytes: 10 });
    for (const name of await tmpEntries()) await fsp.unlink(path.join(root, 'tmp', name));
    await expect(staged.commit()).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('stream nhiều chunk: head giữ đúng SNIFF_HEAD_BYTES đầu, read/readAll trên bản tạm', async () => {
    const store = await make();
    const big = Buffer.alloc(SNIFF_HEAD_BYTES + 1000, 7);
    big.write('HEAD', 0);
    const chunks = [big.subarray(0, 1000), big.subarray(1000, 50_000), big.subarray(50_000)];
    const staged = await store.stage(Readable.from(chunks), { maxBytes: big.length });
    expect(staged.sizeBytes).toBe(big.length);
    expect(staged.size).toBe(big.length);
    expect(staged.head).toEqual(big.subarray(0, SNIFF_HEAD_BYTES));
    expect(await staged.read(big.length - 4, 100)).toEqual(big.subarray(big.length - 4));
    expect(await staged.read(-5, 4)).toEqual(big.subarray(0, 4));
    expect(await staged.readAll()).toEqual(big);
    expect(await tmpEntries()).toHaveLength(1);
    await staged.discard();
    await staged.discard(); // idempotent
    expect(await tmpEntries()).toEqual([]);
  });

  it('tệp nhỏ: head = toàn bộ tệp', async () => {
    const store = await make();
    const staged = await store.stage(Buffer.from('abc'), { maxBytes: 10 });
    expect(staged.head.length).toBe(staged.sizeBytes);
    await staged.discard();
  });

  it('commit rồi discard không xóa blob; commit lần hai ⇒ ném', async () => {
    const store = await make();
    const staged = await store.stage(Buffer.from('abc'), { maxBytes: 10 });
    const stored = await staged.commit();
    await staged.discard();
    expect(await store.exists(stored.key)).toBe(true);
    await expect(staged.commit()).rejects.toThrow();
  });

  it('Buffer vượt trần ⇒ 413 trước khi mở tmp', async () => {
    const store = await make();
    await expect(store.stage(Buffer.alloc(11), { maxBytes: 10 })).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
    expect(await tmpEntries()).toEqual([]);
  });

  it('stream vượt trần giữa chừng ⇒ 413, tmp bị xóa ngay', async () => {
    const store = await make();
    const source = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    await expect(store.stage(source, { maxBytes: 10 })).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
    expect(await tmpEntries()).toEqual([]);
  });

  it('nguồn lỗi giữa chừng (client hủy) ⇒ ném, tmp bị xóa ngay', async () => {
    const store = await make();
    let reads = 0;
    const source = new Readable({
      read() {
        if (++reads === 1) this.push(Buffer.alloc(100));
        else this.destroy(new Error('aborted')); // hỏng khi đang được đọc (đã có tmp)
      },
    });
    await expect(store.stage(source, { maxBytes: 1_000 })).rejects.toThrow('aborted');
    expect(await tmpEntries()).toEqual([]);
  });

  it('ổ trống < maxBytes + 10 % ⇒ 507 trước khi tạo tmp (SEC-CH-37)', async () => {
    const store = await make({ fs: { freeBytes: () => Promise.resolve(1_099) } });
    await expect(store.stage(Buffer.from('a'), { maxBytes: 1_000 })).rejects.toBeInstanceOf(
      StorageFullError,
    );
    expect(await tmpEntries()).toEqual([]);
    const ok = await make({ fs: { freeBytes: () => Promise.resolve(1_100) } });
    await (await ok.stage(Buffer.from('a'), { maxBytes: 1_000 })).discard();
  });
});

describe('LocalFileStore — đặt vào chỗ thử lại (CH-14, F-07)', () => {
  const realLink = (from: string, to: string) => fsp.link(from, to);
  /** Lần gọi đầu là bước kiểm hard link của `create` (B L-d) ⇒ dùng link thật; sau đó mới là `fake`. */
  const afterProbe = (fake: (from: string, to: string) => Promise<void>) => {
    let probed = false;
    return (from: string, to: string) =>
      probed ? fake(from, to) : ((probed = true), realLink(from, to));
  };

  it('EPERM 4 lần rồi được ⇒ thành công, chờ 4 × 50 ms', async () => {
    let calls = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const store = await make({
      sleep,
      fs: {
        link: afterProbe((from, to) =>
          ++calls <= 4 ? Promise.reject(errno('EPERM')) : realLink(from, to),
        ),
      },
    });
    const stored = await store.put(Buffer.from('x'), { maxBytes: 10 });
    expect(calls).toBe(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledWith(50);
    expect(await store.exists(stored.key)).toBe(true);
  });

  it.each(['EBUSY', 'EACCES'])('%s cũng được thử lại', async (code) => {
    let calls = 0;
    const store = await make({
      sleep: () => Promise.resolve(),
      fs: {
        link: afterProbe((f, t) => (++calls === 1 ? Promise.reject(errno(code)) : realLink(f, t))),
      },
    });
    await store.put(Buffer.from('x'), { maxBytes: 10 });
    expect(calls).toBe(2);
  });

  it(`hết ${PLACE_RETRIES} lần thử lại ⇒ ném, tmp bị xóa`, async () => {
    let calls = 0;
    const store = await make({
      sleep: () => Promise.resolve(),
      fs: { link: afterProbe(() => (++calls, Promise.reject(errno('EPERM')))) },
    });
    await expect(store.put(Buffer.from('x'), { maxBytes: 10 })).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(calls).toBe(PLACE_RETRIES + 1);
    expect(await tmpEntries()).toEqual([]);
  });

  it('lỗi không thử lại được (ENOSPC) ⇒ ném ngay', async () => {
    let calls = 0;
    const store = await make({
      sleep: () => Promise.resolve(),
      fs: { link: afterProbe(() => (++calls, Promise.reject(errno('ENOSPC')))) },
    });
    await expect(store.put(Buffer.from('x'), { maxBytes: 10 })).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(calls).toBe(1);
    expect(await tmpEntries()).toEqual([]);
  });
});

describe('LocalFileStore — đọc / xóa', () => {
  it('open ⇒ stream + kích thước', async () => {
    const store = await make();
    const { key } = await store.put(Buffer.from('nội dung'), { maxBytes: 100 });
    const { stream, sizeBytes } = await store.open(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('nội dung');
    expect(sizeBytes).toBe(Buffer.byteLength('nội dung'));
  });

  it('blob mất ⇒ FileMissingError (F-09)', async () => {
    const store = await make();
    const { key } = await store.put(Buffer.from('x'), { maxBytes: 10 });
    await fsp.unlink(path.join(root, key.slice(0, 2), key.slice(2, 4), key));
    await expect(store.open(key)).rejects.toBeInstanceOf(FileMissingError);
    expect(await store.exists(key)).toBe(false);
  });

  it('delete idempotent', async () => {
    const store = await make();
    const { key } = await store.put(Buffer.from('x'), { maxBytes: 10 });
    await store.delete(key);
    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });

  it.each(['../../etc/passwd', '..\\..\\x', 'tmp/abc', `${'a'.repeat(26)}/../x`, ''])(
    'khóa sai %j ⇒ RangeError trước mọi thao tác đĩa',
    async (bad) => {
      const store = await make();
      const key = bad as FileKey;
      await expect(store.open(key)).rejects.toBeInstanceOf(RangeError);
      await expect(store.delete(key)).rejects.toBeInstanceOf(RangeError);
      await expect(store.exists(key)).rejects.toBeInstanceOf(RangeError);
      const staged = await store.stage(Buffer.from('x'), { maxBytes: 10 });
      await expect(staged.commit(key)).rejects.toBeInstanceOf(RangeError);
      expect(await tmpEntries()).toEqual([]);
    },
  );
});

describe('LocalFileStore.purgeStaleTemp', () => {
  it('ngưỡng tuổi tmp ≥ 2 × (180 s request + 10 s worker) — B M-b', () => {
    expect(STALE_TEMP_AGE_MS).toBeGreaterThanOrEqual(2 * (180_000 + 10_000));
  });

  it('chỉ xóa tmp cũ hơn mốc', async () => {
    const store = await make();
    const tmp = path.join(root, 'tmp');
    await fsp.writeFile(path.join(tmp, 'old'), 'x');
    await fsp.writeFile(path.join(tmp, 'fresh'), 'x');
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await fsp.utimes(path.join(tmp, 'old'), twoHoursAgo, twoHoursAgo);
    expect(await store.purgeStaleTemp(new Date(Date.now() - 3_600_000))).toBe(1);
    expect(await tmpEntries()).toEqual(['fresh']);
  });
});
