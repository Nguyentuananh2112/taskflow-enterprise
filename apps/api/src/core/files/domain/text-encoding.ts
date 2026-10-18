/**
 * Nhận diện mã hóa của TXT/CSV (ADR-141, F-05). Lưu NGUYÊN byte — chỉ quyết định "có phải văn bản".
 * UTF-8 (có/không BOM), UTF-16 LE/BE CÓ BOM, Windows-1258 khi không phải UTF-8 hợp lệ và không có NUL.
 */

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1258';

// Byte không được gán trong Windows-1258 (bảng mã của Microsoft): có ⇒ không phải văn bản 1258.
const CP1258_UNDEFINED = new Set([0x81, 0x8a, 0x8d, 0x8e, 0x8f, 0x90, 0x9a, 0x9d, 0x9e]);

/** C0 hợp lệ trong văn bản: TAB, LF, VT, FF, CR, SUB (EOF kiểu DOS). Ký tự điều khiển khác ⇒ nhị phân. */
const isTextControl = (b: number): boolean =>
  b === 0x09 || b === 0x0a || b === 0x0b || b === 0x0c || b === 0x0d || b === 0x1a;

/**
 * Độ dài chuỗi UTF-8 bắt đầu tại `i` nếu hợp lệ (RFC 3629: không overlong, không surrogate, ≤
 * U+10FFFF); `0` nếu hỏng; `-1` nếu bị cắt ở cuối mẫu (`truncatedOk` — mẫu đầu tệp).
 */
function utf8SequenceLength(bytes: Uint8Array, i: number, truncatedOk: boolean): number {
  const b0 = bytes[i] ?? 0;
  let len: number;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) len = 2;
  else if (b0 >= 0xe0 && b0 <= 0xef) {
    len = 3;
    if (b0 === 0xe0) lo = 0xa0; // overlong
    if (b0 === 0xed) hi = 0x9f; // surrogate
  } else if (b0 >= 0xf0 && b0 <= 0xf4) {
    len = 4;
    if (b0 === 0xf0) lo = 0x90; // overlong
    if (b0 === 0xf4) hi = 0x8f; // > U+10FFFF
  } else return 0;
  for (let k = 1; k < len; k++) {
    if (i + k >= bytes.length) return truncatedOk ? -1 : 0;
    const b = bytes[i + k] ?? 0;
    if (b < (k === 1 ? lo : 0x80) || b > (k === 1 ? hi : 0xbf)) return 0;
  }
  return len;
}

/** UTF-8 hợp lệ, không NUL / ký tự điều khiển lạ. `truncated`: mẫu là ĐẦU tệp (chuỗi cuối có thể bị cắt). */
export function isUtf8Text(bytes: Uint8Array, truncated = false): boolean {
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      if (b < 0x20 && !isTextControl(b)) return false;
      if (b === 0x7f) return false;
      i += 1;
      continue;
    }
    const len = utf8SequenceLength(bytes, i, truncated);
    if (len === -1) return true;
    if (len === 0) return false;
    i += len;
  }
  return true;
}

function isCp1258Text(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b < 0x20 && !isTextControl(b)) return false; // gồm NUL
    if (b === 0x7f || CP1258_UNDEFINED.has(b)) return false;
  }
  return true;
}

/** Đếm NUL không đều giữa vị trí chẵn/lẻ — UTF-16 có BOM vẫn phải "trông như" văn bản. */
function isUtf16Text(bytes: Uint8Array, littleEndian: boolean): boolean {
  const end = bytes.length - (bytes.length % 2);
  for (let i = 2; i < end; i += 2) {
    const unit = littleEndian
      ? (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8)
      : ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    if (unit < 0x20 && !isTextControl(unit)) return false;
    if (unit === 0x7f) return false;
  }
  return true;
}

/**
 * Mã hóa văn bản của mẫu `bytes` (đầu tệp nếu `truncated`), hoặc `null` nếu không phải văn bản.
 * Mẫu rỗng ⇒ `utf-8` (tệp TXT rỗng hợp lệ).
 */
export function detectTextEncoding(bytes: Uint8Array, truncated = false): TextEncoding | null {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return isUtf8Text(bytes.subarray(3), truncated) ? 'utf-8' : null;
  }
  if (b0 === 0xff && b1 === 0xfe) return isUtf16Text(bytes, true) ? 'utf-16le' : null;
  if (b0 === 0xfe && b1 === 0xff) return isUtf16Text(bytes, false) ? 'utf-16be' : null;
  if (isUtf8Text(bytes, truncated)) return 'utf-8';
  return isCp1258Text(bytes) ? 'windows-1258' : null;
}
