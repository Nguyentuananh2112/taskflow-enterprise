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
