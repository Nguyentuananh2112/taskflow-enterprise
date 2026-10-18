import { HttpResponse } from 'msw';

// Nhận diện tệp tải lên của mock theo NỘI DUNG (avatar-chat.md ADR-141) — bản rút gọn của sniffType/inspectZip ở
// server: đủ để UI gặp đúng các nhánh 415. Không tin đuôi / Content-Type.

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** Ảnh cho phép: JPEG, PNG, WebP (+ GIF khi `gif`). Khác ⇒ null. */
export function sniffImage(b: Uint8Array, gif = false): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'image/png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (gif && ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

const OFFICE = /\.(docx|xlsx|pptx|odt|ods)$/i;

/**
 * Tệp đính kèm: ảnh, PDF, Office (ZIP có đuôi Office), TXT/CSV. Cấm HTML/SVG/XML, tệp chạy được, ZIP/RAR/7z/GZ thuần.
 * `macro` ⇒ 415 MACRO_OR_ACTIVE_CONTENT (mock: tên có `.docm`/`.xlsm` hoặc nội dung chứa `vbaProject.bin`).
 */
export function sniffFile(
  b: Uint8Array,
  name: string,
): { mime: string } | { reject: 'type' | 'macro' } {
  const image = sniffImage(b, true);
  if (image) return { mime: image };
  if (ascii(b, 0, 5) === '%PDF-') return { mime: 'application/pdf' };
  const head = ascii(b, 0, 512).toLowerCase();
  if (ascii(b, 0, 2) === 'MZ' || ascii(b, 0, 4) === '\x7fELF' || head.startsWith('#!')) {
    return { reject: 'type' };
  }
  if (ascii(b, 0, 4) === 'PK\x03\x04') {
    if (/\.(docm|xlsm|pptm)$/i.test(name) || ascii(b, 0, b.length).includes('vbaProject.bin')) {
      return { reject: 'macro' };
    }
    return OFFICE.test(name) ? { mime: 'application/octet-stream' } : { reject: 'type' };
  }
  if (/^(rar!|7z\xbc\xaf)/.test(ascii(b, 0, 6)) || (b[0] === 0x1f && b[1] === 0x8b)) {
    return { reject: 'type' };
  }
  if (/<(!doctype|html|svg|\?xml|script)/.test(head)) return { reject: 'type' };
  return /\.(txt|csv)$/i.test(name) ? { mime: 'text/plain' } : { reject: 'type' };
}

/** `X-Upload-Name`: bắt buộc, percent-encoded UTF-8, ≤ 255 byte sau giải mã (F-03c). */
export function uploadName(request: Request): string | null {
  const raw = request.headers.get('x-upload-name');
  if (!raw) return null;
  try {
    const name = decodeURIComponent(raw);
    return name.length > 0 && new TextEncoder().encode(name).length <= 255 ? name : null;
  } catch {
    return null;
  }
}

/** `/media` lỗi ⇒ trang HTML tối giản (người dùng đang điều hướng — E), cùng CSP sandbox. */
export const mediaGone = () =>
  new HttpResponse(
    '<!doctype html><meta charset="utf-8"><title>Không tìm thấy</title><p>Liên kết đã hết hạn hoặc không còn tồn tại.</p><p><a href="/">Quay lại</a></p>',
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    },
  );
