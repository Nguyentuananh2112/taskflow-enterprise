/**
 * Tên tệp do người dùng gửi (ADR-141, ADR-144). Tên chỉ để HIỂN THỊ và cho `filename*` — không bao
 * giờ làm tên trên đĩa (khóa do server sinh, `file-key.ts`).
 */

/** Trần byte UTF-8 của tên gốc sau khi giải mã `X-Upload-Name` (F-03c). */
export const UPLOAD_NAME_MAX_BYTES = 255;

/** Tên thay thế khi làm sạch xong không còn ký tự nào. */
export const FALLBACK_FILE_NAME = 'tep';

export type UploadNameResult = { ok: true; name: string } | { ok: false };

/**
 * Giải mã header bắt buộc `X-Upload-Name` (percent-encoded UTF-8 — web dùng `encodeURIComponent`).
 * Thiếu / lặp / rỗng / giải mã hỏng / > 255 byte sau giải mã ⇒ `{ok: false}` (400
 * `INVALID_UPLOAD_NAME`). Tên LẠ (`../`, NUL, U+202E) vẫn hợp lệ ở đây — `sanitizeFileName` làm sạch.
 */
export function decodeUploadName(header: string | readonly string[] | undefined): UploadNameResult {
  if (typeof header !== 'string' || header.length === 0) return { ok: false };
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch {
    return { ok: false }; // %ZZ, chuỗi UTF-8 hỏng, nửa cặp surrogate
  }
  if (name.length === 0 || Buffer.byteLength(name, 'utf8') > UPLOAD_NAME_MAX_BYTES) {
    return { ok: false };
  }
  return { ok: true, name };
}

// C0 + DEL + C1; ký tự cấm của Windows/Unix; bidi embedding/override/isolate (U+202A…202E,
// U+2066…2069) + dấu hướng LRM/RLM/ALM (không nằm trong danh sách ADR nhưng cùng loại "đảo hiển thị").
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u001f\u007f-\u009f/\\:*?"<>|\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g;

/**
 * NFC, bỏ ký tự điều khiển + `/\:*?"<>|` + bidi, gộp khoảng trắng, bỏ dấu chấm / khoảng trắng ở hai
 * đầu (Windows cắt chúng, `..` không còn nghĩa), giữ đuôi. Rỗng ⇒ `FALLBACK_FILE_NAME`.
 */
export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(STRIP, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  return cleaned.length > 0 ? cleaned : FALLBACK_FILE_NAME;
}

/** Đuôi chữ thường (không dấu chấm) — chỉ 1–10 ký tự chữ/số sau dấu chấm cuối; không có ⇒ `''`. */
export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match && match.index > 0 ? (match[1] ?? '').toLowerCase() : '';
}

/** Bản ASCII dự phòng cho `filename="…"`: bỏ dấu tiếng Việt, ký tự khác ⇒ `_`. */
export function asciiFallbackName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]|["\\]/g, '_');
  return ascii.length > 0 ? ascii : FALLBACK_FILE_NAME;
}

/** RFC 5987 `attr-char`: `encodeURIComponent` còn để lại `'()*!` — phải mã hóa nốt. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `Content-Disposition` cho tải xuống (ADR-141): luôn `attachment`, `filename` ASCII dự phòng +
 * `filename*=UTF-8''…` (tên tiếng Việt). Tên vào đây phải là tên ĐÃ làm sạch.
 */
export function attachmentDisposition(name: string): string {
  return `attachment; filename="${asciiFallbackName(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}
