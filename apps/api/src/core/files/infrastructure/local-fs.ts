import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';

// Hằng số + tiện ích fs của `LocalFileStore` (tách để file adapter gọn — max-lines).

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
export const RETRYABLE_PLACE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Tuổi tối thiểu của tệp tạm để `files-sweep` xóa (B M-b): Linux xóa được cả tệp đang mở ⇒ ngưỡng phải
 * ≥ 2 × (trần một request upload 180 s + chờ hàng đợi ảnh + worker sharp 10 s) ≈ 7 phút. Chọn 1 giờ —
 * đường chính xóa tmp ngay khi lỗi/hủy, sweep chỉ là lưới an toàn (ADR-141).
 */
export const STALE_TEMP_AGE_MS = 60 * 60 * 1000;

export const TMP_DIR = 'tmp';

export class FileStoreConfigError extends Error {
  constructor(reason: string) {
    super(`FILE_STORE_DIR không dùng được: ${reason}`);
    this.name = 'FileStoreConfigError';
  }
}

export const errCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined;

export const defaultFs: FileStoreFs = {
  link: (from, to) => fsp.link(from, to),
  freeBytes: async (dir) => {
    const s = await fsp.statfs(dir);
    return s.bavail * s.bsize;
  },
};

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Đi theo symlink / junction (B L-a); đường dẫn chưa tồn tại ⇒ bản resolve. */
export const real = (p: string): Promise<string> => fsp.realpath(p).catch(() => path.resolve(p));

/** Tổng byte các tệp trong kho, bỏ `tmp/` — số đo của `StorageQuota` (đối soát mỗi `FILE_STORE_USAGE_CACHE_MS`). */
export async function storeUsageBytes(root: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const dir = path.relative(root, entry.parentPath);
    if (dir === TMP_DIR || dir.startsWith(`${TMP_DIR}${path.sep}`)) continue;
    const stat = await fsp.stat(path.join(entry.parentPath, entry.name)).catch(() => undefined);
    total += stat?.size ?? 0; // vừa bị xóa giữa chừng ⇒ bỏ qua
  }
  return total;
}

/** Mọi tệp dưới `<root>/<sub>` kèm đường dẫn tương đối dùng `/` và mốc sửa đổi (bỏ qua tệp biến mất giữa chừng). */
export async function* walkFiles(
  root: string,
  sub: string,
): AsyncGenerator<{ relative: string; modifiedAt: Date }> {
  const base = path.join(root, sub);
  const entries = await fsp.readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const stat = await fsp.stat(full).catch(() => undefined);
    if (stat)
      yield {
        relative: path.relative(root, full).split(path.sep).join('/'),
        modifiedAt: stat.mtime,
      };
  }
}

/**
 * Kiểm thư mục kho lúc khởi động — sai ⇒ `FileStoreConfigError` (từ chối khởi động). Hard link: `commit` đặt tệp
 * bằng `link` (không ghi đè); FAT/exFAT, mount mạng, bind mount Docker Desktop không có ⇒ phát hiện ngay (B L-d).
 */
export async function prepareStoreRoot(
  root: string,
  options: Pick<LocalFileStoreOptions, 'forbiddenParents'>,
  fs: Pick<FileStoreFs, 'link'>,
): Promise<string> {
  if (!path.isAbsolute(root)) throw new FileStoreConfigError('phải là đường dẫn tuyệt đối');
  const resolved = await real(root);
  const parents = await Promise.all((options.forbiddenParents ?? []).map(real));
  if (parents.some((p) => isInside(resolved, p))) {
    throw new FileStoreConfigError('nằm trong thư mục ứng dụng');
  }
  const stat = await fsp.stat(resolved).catch(() => undefined);
  if (!stat?.isDirectory()) throw new FileStoreConfigError('không tồn tại hoặc không phải thư mục');
  const tmp = path.join(resolved, TMP_DIR);
  const tag = randomBytes(6).toString('hex');
  const probe = path.join(tmp, `.probe-${tag}`);
  try {
    await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(probe, '', { flag: 'wx' });
  } catch {
    throw new FileStoreConfigError('không ghi được');
  }
  try {
    await fs.link(probe, `${probe}-link`);
  } catch {
    throw new FileStoreConfigError('hệ thống tệp không hỗ trợ hard link (cần ext4/xfs/NTFS)');
  } finally {
    await fsp.unlink(`${probe}-link`).catch(() => undefined);
    await fsp.unlink(probe).catch(() => undefined);
  }
  return resolved;
}
