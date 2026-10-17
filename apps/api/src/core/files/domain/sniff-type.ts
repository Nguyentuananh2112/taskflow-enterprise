import { detectTextEncoding, type TextEncoding } from './text-encoding';
import type { OfficeType } from './inspect-zip';

/**
 * Loại tệp theo NỘI DUNG (ADR-141) — không tin đuôi, không tin `Content-Type`. Đuôi chỉ phải KHỚP
 * loại đã nhận diện. Danh sách cho phép hẹp; mọi thứ khác ⇒ 415 `UNSUPPORTED_FILE_TYPE`.
 */

export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif';
export type FileType = ImageType | 'pdf' | OfficeType | 'txt' | 'csv';

export type SniffResult =
  | { ok: true; type: FileType; textEncoding?: TextEncoding }
  /** ZIP: phải đọc central directory (`inspectZip`) rồi gọi `matchOfficeType`. */
  | { ok: true; type: 'zip' }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' };

/** Số byte đầu tệp đưa vào `sniffType` (đủ cho magic + mẫu văn bản). */
export const SNIFF_HEAD_BYTES = 64 * 1024;

const IMAGE_TYPES: ReadonlySet<FileType> = new Set<FileType>(['jpeg', 'png', 'webp', 'gif']);

export const isImageType = (type: FileType): type is ImageType => IMAGE_TYPES.has(type);

/** Đuôi hợp lệ cho từng loại. */
const EXTENSIONS: Readonly<Record<FileType, readonly string[]>> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  gif: ['gif'],
  pdf: ['pdf'],
  docx: ['docx'],
  xlsx: ['xlsx'],
  pptx: ['pptx'],
  odt: ['odt'],
  ods: ['ods'],
  txt: ['txt'],
  csv: ['csv'],
};

export const MIME: Readonly<Record<FileType, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];

/** Định dạng nhị phân luôn cấm (chạy được, nén, đa phương tiện, OLE cũ, TIFF…). */
const FORBIDDEN_MAGIC: readonly (readonly number[])[] = [
  ascii('MZ'), // PE / DOS
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O (+ fat / Java class)
  ascii('#!'),
  ascii('Rar!'),
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x1f, 0x8b], // gzip
  ascii('BZh'),
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE CFB (.doc/.xls/.msi)
  [0x49, 0x49, 0x2a, 0x00],
  [0x4d, 0x4d, 0x00, 0x2a], // TIFF
  [0x1a, 0x45, 0xdf, 0xa3], // Matroska / WebM
  ascii('OggS'),
  ascii('ID3'),
  ascii('fLaC'),
  ascii('BM'),
  [0x00, 0x61, 0x73, 0x6d], // wasm
];

/** Nhận diện magic nhị phân; `undefined` = không có magic nào biết ⇒ thử văn bản. */
function magicType(head: Uint8Array): FileType | 'zip' | 'forbidden' | undefined {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, PNG)) return 'png';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'gif';
  if (startsWith(head, ascii('RIFF'))) {
    return startsWith(head, ascii('WEBP'), 8) ? 'webp' : 'forbidden'; // AVI, WAVE…
  }
  if (startsWith(head, ascii('%PDF-'))) return 'pdf';
  if (startsWith(head, ZIP_LOCAL)) return 'zip';
  if (startsWith(head, ascii('ftyp'), 4)) return 'forbidden'; // HEIC/AVIF/MP4/MOV
  if (FORBIDDEN_MAGIC.some((sig) => startsWith(head, sig))) return 'forbidden';
  return undefined;
}

const UNSUPPORTED = { ok: false, reason: 'UNSUPPORTED_FILE_TYPE' } as const;

/**
 * `head` = tối đa `SNIFF_HEAD_BYTES` đầu tệp; `complete` = `head` là TOÀN BỘ tệp. `extension` là
 * đuôi chữ thường của tên đã làm sạch (`extensionOf`). Văn bản chỉ nhận với đuôi `txt`/`csv` ⇒
 * HTML/SVG/XML/JS (đuôi khác) bị chặn dù là văn bản; TXT chứa HTML vẫn là TXT (phục vụ `attachment`).
 */
export function sniffType(head: Uint8Array, extension: string, complete = false): SniffResult {
  const magic = magicType(head);
  if (magic === 'forbidden') return UNSUPPORTED;
  if (magic === 'zip') {
    return ['docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(extension)
      ? { ok: true, type: 'zip' }
      : UNSUPPORTED;
  }
  if (magic !== undefined) {
    return EXTENSIONS[magic].includes(extension) ? { ok: true, type: magic } : UNSUPPORTED;
  }
  if (extension !== 'txt' && extension !== 'csv') return UNSUPPORTED;
  const textEncoding = detectTextEncoding(head, !complete);
  return textEncoding ? { ok: true, type: extension, textEncoding } : UNSUPPORTED;
}

/** Sau `inspectZip`: loại Office đọc được phải khớp đuôi (`.docm` đổi thành `.docx` đã bị chặn trước). */
export function matchOfficeType(type: OfficeType, extension: string): boolean {
  return EXTENSIONS[type].includes(extension);
}
