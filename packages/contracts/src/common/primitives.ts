import * as z from 'zod';

/** UUID theo RFC 9562 (chấp nhận v4 và v7 — id sai định dạng ⇒ 400, id lạ ⇒ 404). */
export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** Ngày thuần `YYYY-MM-DD` (data-and-api.md D10). */
export const DateOnly = z.iso.date();
export type DateOnly = z.infer<typeof DateOnly>;

/** Thời điểm ISO 8601 dạng UTC (`Z`) — server luôn trả `toISOString()`. */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Version dùng cho optimistic locking (ADR-010): số nguyên ≥ 1. */
export const Version = z.int().min(1);
export type Version = z.infer<typeof Version>;

/** Ký tự điều khiển Unicode (Cc) — cấm trong tên/tiêu đề một dòng. */
const CONTROL_CHARS = /\p{Cc}/u;
/** Ký tự điều khiển trừ xuống dòng và tab (văn bản nhiều dòng). */
const CONTROL_CHARS_EXCEPT_NEWLINE = /[^\P{Cc}\n\r\t]/u;
const NO_CONTROL_CHARS = { error: 'Không được chứa ký tự điều khiển' };

/** Chuỗi một dòng: trim, độ dài [min, max], không chứa ký tự điều khiển. */
export function singleLineText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), NO_CONTROL_CHARS);
}

/** Văn bản nhiều dòng: trim, tối đa `max`; chuỗi rỗng sau trim hoặc `null` ⇒ `null`. */
export function multiLineTextOrNull(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL_CHARS_EXCEPT_NEWLINE.test(s), NO_CONTROL_CHARS)
    .transform((s) => (s === '' ? null : s))
    .nullable();
}

/** Cursor phân trang opaque (base64url) — server tự giải mã và kiểm khóa (data-and-api §3.1). */
export const Cursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export type Cursor = z.infer<typeof Cursor>;

/** `limit` trong query string: ép kiểu số, mặc định `def`, trong [1, max]. */
export function limitQuery(max: number, def: number) {
  return z.coerce.number().int().min(1).max(max).default(def);
}

/** Chuỗi tìm kiếm `q`: trim, tối đa `max`; rỗng sau trim ⇒ không lọc (`undefined`). */
export function searchQuery(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? undefined : s))
    .optional();
}
