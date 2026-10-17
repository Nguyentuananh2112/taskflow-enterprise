import * as z from 'zod';

// Mốc 6 (ADR-141, T-067…T-069): biến kho tệp / URL ký / chat — tách khỏi env.ts (max-lines khi gộp Mốc 5). Kiểm chéo
// (tuyệt đối, khác JWT, bắt buộc ở staging/production) vẫn ở superRefine của env.ts.

/** Khóa HS256 = byte UTF-8 của chuỗi (security.md §2.1: `TextEncoder().encode(secret)`), ≥ 32 byte. */
export const jwtSecret = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'phải ≥ 32 byte');

/** Chuỗi rỗng ⇒ không đặt (giống JWT_ACCESS_TTL_SECONDS). */
const blankAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
/** Số nguyên tùy chọn — dùng cho các cửa sổ CHỈ APP_ENV=test (superRefine chặn môi trường khác). */
const optionalInt = (min: number, max: number) =>
  z.preprocess(blankAsUndefined, z.coerce.number().int().min(min).max(max).optional());
const optionalFlag = z.preprocess(blankAsUndefined, z.stringbool().optional());

/** Mốc 6 (ADR-141): cửa sổ chỉnh được ở test (F-01/F-02). Đặt khi APP_ENV ≠ test ⇒ từ chối khởi động. */
export const FILES_TEST_ONLY_VARS = [
  'MEDIA_URL_AVATAR_BUCKET_SECONDS',
  'MEDIA_URL_IMAGE_BUCKET_SECONDS',
  'MEDIA_URL_DOWNLOAD_TTL_SECONDS',
  'FILES_ORPHAN_TTL_SECONDS',
  'UPLOAD_IDLE_TIMEOUT_MS',
  'FILE_STORE_USAGE_CACHE_MS',
  'FILES_SWEEP_ON_START',
  'FILES_SWEEP_INTERVAL_MS',
  'FILES_IMAGE_PIPELINE_DISABLED',
  // T-069: cửa sổ / hạn mức chat (ADR-141 F-01)
  'CHAT_EDIT_WINDOW_SECONDS',
  'CHAT_UPLOAD_DAILY_BYTES',
  'CHAT_SEND_HOURLY',
] as const;

export const FILES_ENV_SHAPE = {
  // ---- Mốc 6 — kho tệp (ADR-141) ----
  // Thư mục kho (tuyệt đối, ngoài thư mục app; Docker: volume `filestore`). Bắt buộc ở staging/production;
  // local/test không đặt ⇒ `<os tmpdir>/taskflow-files`. Không tồn tại / không ghi được ⇒ từ chối khởi động.
  FILE_STORE_DIR: z.preprocess(blankAsUndefined, z.string().optional()),
  // Khóa HMAC ký URL `/media` (≥ 32 byte, KHÁC JWT). Bắt buộc ở staging/production; local/test không đặt ⇒
  // khóa ngẫu nhiên mỗi lần khởi động (URL cũ hết hiệu lực khi restart).
  FILE_URL_SECRET: z.preprocess(blankAsUndefined, jwtSecret.optional()),
  // Khóa cũ trong lúc xoay — CHỈ để kiểm, không để ký (B M3).
  FILE_URL_SECRET_PREVIOUS: z.preprocess(blankAsUndefined, jwtSecret.optional()),
  // Trần dung lượng kho (byte) ⇒ 507 STORAGE_FULL. Mặc định 50 GiB (người dùng 17/10).
  FILE_STORE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_000_000)
    .default(50 * 1024 ** 3),
  // CORP của `/media` (B M2): web + API chung eTLD+1 ⇒ same-site; khác ⇒ cross-origin có chủ ý.
  MEDIA_CORP: z.enum(['same-site', 'cross-origin']).default('same-site'),
  // Origin công khai của API cho URL ký tuyệt đối (TL 18/10). staging/production bắt buộc https.
  MEDIA_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .refine((u) => new URL(u).origin === u, 'chỉ origin, không path')
    .default('http://localhost:4000'),
  MEDIA_URL_AVATAR_BUCKET_SECONDS: optionalInt(1, 86_400),
  MEDIA_URL_IMAGE_BUCKET_SECONDS: optionalInt(1, 3_600),
  MEDIA_URL_DOWNLOAD_TTL_SECONDS: optionalInt(1, 60),
  FILES_ORPHAN_TTL_SECONDS: optionalInt(1, 86_400),
  UPLOAD_IDLE_TIMEOUT_MS: optionalInt(100, 15_000),
  FILE_STORE_USAGE_CACHE_MS: optionalInt(0, 60_000),
  FILES_SWEEP_ON_START: optionalFlag,
  FILES_SWEEP_INTERVAL_MS: optionalInt(1_000, 3_600_000),
  FILES_IMAGE_PIPELINE_DISABLED: optionalFlag,
  CHAT_EDIT_WINDOW_SECONDS: optionalInt(1, 900),
  CHAT_UPLOAD_DAILY_BYTES: optionalInt(1_000, 200 * 1024 * 1024),
  CHAT_SEND_HOURLY: optionalInt(1, 600),
};
