import { inflateRawSync } from 'node:zlib';

/**
 * Nhận diện tài liệu Office / OpenDocument theo CENTRAL DIRECTORY của ZIP (ADR-141, F-04, B M6) —
 * không theo thứ tự entry (Word, LibreOffice, Google Docs, WPS xếp khác nhau). Chỉ giải nén
 * `[Content_Types].xml` / `mimetype` / `META-INF/manifest.xml`, mỗi cái ≤ 1 MB.
 */

export type OfficeType = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods';

export type ZipVerdict =
  | { ok: true; type: OfficeType }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' | 'MACRO_OR_ACTIVE_CONTENT' };

/** Đọc ngẫu nhiên — adapter là file handle, test là Buffer. Trả ít byte hơn ⇒ tệp ngắn hơn. */
export interface RandomAccessSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const ZIP_MAX_ENTRIES = 2_000;
export const ZIP_MAX_INFLATED_BYTES = 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_MAX_COMMENT = 0xffff;

const UNSUPPORTED = { ok: false, reason: 'UNSUPPORTED_FILE_TYPE' } as const;
const ACTIVE = { ok: false, reason: 'MACRO_OR_ACTIVE_CONTENT' } as const;

interface Entry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** EOCD: quét ngược phần đuôi (22 byte + comment ≤ 65 535). */
async function readCentralDirectory(src: RandomAccessSource): Promise<Entry[] | 'unsupported'> {
  if (src.size < EOCD_MIN) return 'unsupported';
  const tailLen = Math.min(src.size, EOCD_MIN + EOCD_MAX_COMMENT);
  const tailStart = src.size - tailLen;
  const tail = await src.read(tailStart, tailLen);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return 'unsupported';
  const disk = tv.getUint16(eocd + 4, true);
  const cdDisk = tv.getUint16(eocd + 6, true);
  const totalEntries = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  // Đa đĩa / ZIP64 (0xFFFF…) không có trong tài liệu ≤ 20 MB ⇒ từ chối thay vì đoán.
  if (disk !== 0 || cdDisk !== 0 || totalEntries === 0xffff || cdOffset === 0xffffffff) {
    return 'unsupported';
  }
  if (totalEntries > ZIP_MAX_ENTRIES) return 'unsupported';
  if (cdOffset + cdSize > tailStart + eocd) return 'unsupported';

  const cd = await src.read(cdOffset, cdSize);
  if (cd.length !== cdSize) return 'unsupported';
  const cv = view(cd);
  const entries: Entry[] = [];
  let p = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== CDH_SIG) return 'unsupported';
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    if (p + 46 + nameLen > cd.length) return 'unsupported';
    entries.push({
      flags: cv.getUint16(p + 8, true),
      method: cv.getUint16(p + 10, true),
      compressedSize: cv.getUint32(p + 20, true),
      uncompressedSize: cv.getUint32(p + 24, true),
      localOffset: cv.getUint32(p + 42, true),
      // Tên entry của OOXML/ODF là ASCII; byte lạ (CP437) giải thành U+FFFD — không ảnh hưởng so khớp.
      name: Buffer.from(cd.subarray(p + 46, p + 46 + nameLen)).toString('utf8'),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Giải nén một entry nhỏ (STORED / DEFLATE, ≤ 1 MB); hỏng / vượt trần ⇒ `null`. */
async function readSmallEntry(src: RandomAccessSource, e: Entry): Promise<string | null> {
  if (e.flags & 0x1) return null; // mã hóa
  if (e.uncompressedSize > ZIP_MAX_INFLATED_BYTES || e.compressedSize > ZIP_MAX_INFLATED_BYTES) {
    return null;
  }
  const lfh = await src.read(e.localOffset, 30);
  if (lfh.length !== 30) return null;
  const lv = view(lfh);
  if (lv.getUint32(0, true) !== LFH_SIG) return null;
  const dataStart = e.localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  const data = await src.read(dataStart, e.compressedSize);
  if (data.length !== e.compressedSize) return null;
  try {
    if (e.method === 0) return Buffer.from(data).toString('utf8');
    if (e.method === 8) {
      return inflateRawSync(data, { maxOutputLength: ZIP_MAX_INFLATED_BYTES }).toString('utf8');
    }
  } catch {
    return null; // dữ liệu hỏng hoặc bung > 1 MB (zip bomb)
  }
  return null;
}

/** Tên entry cho thấy nội dung chủ động (macro, liên kết ngoài, OLE, ActiveX). */
export function isActiveContentEntry(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.endsWith('vbaproject.bin') ||
    n.endsWith('vbadata.xml') ||
    n.includes('externallink') ||
    n.includes('oleobject') ||
    n.includes('activex/') ||
    (n.includes('embeddings/') && n.endsWith('.bin')) ||
    n.startsWith('basic/') ||
    n.startsWith('scripts/')
  );
}

const OOXML_MAIN: readonly [string, OfficeType][] = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'pptx'],
];

const ODF_MIME: Readonly<Record<string, OfficeType>> = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
};

export async function inspectZip(src: RandomAccessSource): Promise<ZipVerdict> {
  const entries = await readCentralDirectory(src);
  if (entries === 'unsupported') return UNSUPPORTED;
  if (entries.some((e) => isActiveContentEntry(e.name))) return ACTIVE;
  const byName = new Map(entries.map((e) => [e.name, e]));

  const contentTypes = byName.get('[Content_Types].xml');
  if (contentTypes) {
    const xml = await readSmallEntry(src, contentTypes);
    if (xml === null) return UNSUPPORTED;
    const lower = xml.toLowerCase();
    if (
      lower.includes('macroenabled') ||
      lower.includes('vbaproject') ||
      lower.includes('externallink') ||
      lower.includes('oleobject')
    ) {
      return ACTIVE;
    }
    const match = OOXML_MAIN.find(([ct]) => xml.includes(ct));
    return match ? { ok: true, type: match[1] } : UNSUPPORTED;
  }

  const mimetype = byName.get('mimetype');
  if (mimetype) {
    const mime = await readSmallEntry(src, mimetype);
    const type = mime === null ? undefined : ODF_MIME[mime.trim()];
    if (!type) return UNSUPPORTED;
    const manifestEntry = byName.get('META-INF/manifest.xml');
    if (manifestEntry) {
      const manifest = await readSmallEntry(src, manifestEntry);
      if (manifest === null) return UNSUPPORTED;
      if (/full-path="(Basic|Scripts)\//i.test(manifest)) return ACTIVE;
    }
    return { ok: true, type };
  }

  return UNSUPPORTED; // ZIP thuần — cấm (ADR-141)
}

/** Nguồn đọc ngẫu nhiên trên Buffer (test, và tệp đã nằm trọn trong bộ nhớ). */
export function bufferSource(buf: Uint8Array): RandomAccessSource {
  return {
    size: buf.length,
    read: (offset, length) =>
      Promise.resolve(buf.subarray(Math.max(0, offset), Math.max(0, offset + length))),
  };
}
