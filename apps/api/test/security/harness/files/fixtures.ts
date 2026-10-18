import { deflateSync } from 'node:zlib';

/**
 * Tệp mẫu Mốc 6 sinh LÚC CHẠY (test-spec-chat §1.2) — không commit nhị phân, không phụ thuộc sharp (harness dùng được
 * trước khi `apps/api` có sharp). Mỗi hàm trả Buffer; bố cục byte theo đặc tả định dạng (PNG RFC 2083, JPEG T.81 /
 * JFIF, TIFF 6 / Exif 2.3, ZIP APPNOTE 6.3, GIF89a, RIFF WebP).
 */

// ---------------------------------------------------------------- tiện ích

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16be = (n: number) => Buffer.from([(n >>> 8) & 0xff, n & 0xff]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

// ---------------------------------------------------------------- PNG

function pngChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdr(w: number, h: number): Buffer {
  // bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  return pngChunk('IHDR', Buffer.concat([u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0])]));
}

/** PNG RGB hợp lệ kích thước w×h, một màu. */
export function png({
  w = 16,
  h = 16,
  rgb = [200, 40, 40] as [number, number, number],
} = {}): Buffer {
  const row = Buffer.alloc(1 + 3 * w);
  for (let x = 0; x < w; x += 1) row.set(rgb, 1 + 3 * x);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    PNG_SIG,
    ihdr(w, h),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Pixel bomb: IHDR khai w×h khổng lồ, IDAT chỉ một dòng — vài KB (SEC-CH-08). */
export function pixelBombPng(w = 50_000, h = 50_000): Buffer {
  const idat = deflateSync(Buffer.alloc(1 + 3 * w));
  return Buffer.concat([
    PNG_SIG,
    ihdr(w, h),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Chữ ký PNG + IHDR hợp lệ, phần sau là rác (SEC-CH-33 "hỏng giữa chừng"). */
export function pngMagicButCorrupt(): Buffer {
  return Buffer.concat([
    PNG_SIG,
    ihdr(64, 64),
    Buffer.from('rac-khong-phai-chunk-hop-le'.repeat(20)),
  ]);
}

// ---------------------------------------------------------------- JPEG (baseline xám tối thiểu)

/**
 * JPEG baseline 1 kênh xám, mọi khối 8×8 cùng màu 128 (DC = 0 sau dịch mức, AC = 0). Bảng Huffman tối thiểu: DC một ký
 * hiệu (loại 0, mã '0'), AC một ký hiệu (EOB 0x00, mã '0') ⇒ mỗi khối 2 bit '00'. Giải mã được bởi libjpeg / libvips.
 */
export function jpeg({ w = 16, h = 16 } = {}): Buffer {
  const dqt = Buffer.concat([u16be(0xffdb), u16be(67), Buffer.from([0x00]), Buffer.alloc(64, 1)]);
  const sof = Buffer.concat([
    u16be(0xffc0),
    u16be(11),
    Buffer.from([8]),
    u16be(h),
    u16be(w),
    Buffer.from([1, 1, 0x11, 0]),
  ]);
  const dht = (tableClass: number) =>
    Buffer.concat([
      u16be(0xffc4),
      u16be(2 + 1 + 16 + 1),
      Buffer.from([(tableClass << 4) | 0]),
      Buffer.from([1, ...Array.from({ length: 15 }, () => 0)]), // một mã độ dài 1
      Buffer.from([0x00]),
    ]);
  const sos = Buffer.concat([u16be(0xffda), u16be(8), Buffer.from([1, 1, 0x00, 0, 63, 0])]);
  const blocks = Math.ceil(w / 8) * Math.ceil(h / 8);
  const bits = blocks * 2; // '00' mỗi khối
  const bytes = Math.ceil(bits / 8);
  const scan = Buffer.alloc(bytes, 0);
  const pad = bytes * 8 - bits;
  if (pad > 0) scan[bytes - 1] = (1 << pad) - 1; // đệm bằng bit 1
  // Không có 0xFF trong dữ liệu (byte toàn 0 hoặc đệm < 0xFF) ⇒ không cần byte stuffing.
  return Buffer.concat([u16be(0xffd8), jfif(), dqt, sof, dht(0), dht(1), sos, scan, u16be(0xffd9)]);
}

function jfif(): Buffer {
  return Buffer.concat([
    u16be(0xffe0),
    u16be(16),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([1, 1, 0]),
    u16be(1),
    u16be(1),
    Buffer.from([0, 0]),
  ]);
}

/** Rational TIFF (big-endian) từ số thực ≥ 0. */
const rational = (num: number, den: number) => Buffer.concat([u32be(num), u32be(den)]);

/**
 * JPEG có APP1 Exif với GPS IFD (vĩ độ 21°01'42" N, kinh độ 105°51'12" E — Hà Nội, bịa) + Make / Model (SEC-CH-07).
 * TIFF big-endian "MM": IFD0 {Make, Model, GPSInfo→IFD GPS}; IFD GPS {LatRef, Lat, LongRef, Long}.
 */
export function jpegWithGps({ w = 32, h = 32 } = {}): Buffer {
  const base = jpeg({ w, h });
  const make = Buffer.from('TaskFlowCam\0', 'ascii');
  const model = Buffer.from('F-Fixture-GPS\0', 'ascii');
  // Bố cục: header(8) | IFD0 (2 + 3*12 + 4 = 42) | GPS IFD (2 + 4*12 + 4 = 54) | dữ liệu ngoài
  const ifd0Off = 8;
  const gpsOff = ifd0Off + 42;
  let dataOff = gpsOff + 54;
  const extra: Buffer[] = [];
  const place = (b: Buffer) => {
    const at = dataOff;
    extra.push(b);
    dataOff += b.length;
    return at;
  };
  const makeAt = place(make);
  const modelAt = place(model);
  const lat = Buffer.concat([rational(21, 1), rational(1, 1), rational(42, 1)]);
  const lon = Buffer.concat([rational(105, 1), rational(51, 1), rational(12, 1)]);
  const latAt = place(lat);
  const lonAt = place(lon);
  const entry = (tag: number, type: number, count: number, value: Buffer) =>
    Buffer.concat([u16be(tag), u16be(type), u32be(count), value]);
  const inline4 = (s: string) =>
    Buffer.concat([Buffer.from(s, 'ascii'), Buffer.alloc(4 - s.length)]);
  const ifd0 = Buffer.concat([
    u16be(3),
    entry(0x010f, 2, make.length, u32be(makeAt)),
    entry(0x0110, 2, model.length, u32be(modelAt)),
    entry(0x8825, 4, 1, u32be(gpsOff)),
    u32be(0),
  ]);
  const gps = Buffer.concat([
    u16be(4),
    entry(0x0001, 2, 2, inline4('N\0')),
    entry(0x0002, 5, 3, u32be(latAt)),
    entry(0x0003, 2, 2, inline4('E\0')),
    entry(0x0004, 5, 3, u32be(lonAt)),
    u32be(0),
  ]);
  const tiff = Buffer.concat([
    Buffer.from('MM', 'ascii'),
    u16be(42),
    u32be(ifd0Off),
    ifd0,
    gps,
    ...extra,
  ]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const app1 = Buffer.concat([u16be(0xffe1), u16be(exif.length + 2), exif]);
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}

// ---------------------------------------------------------------- WebP / GIF / TIFF

/** WebP lossless 1×1 (VP8L) — hằng số chuẩn 26 byte. */
export function webp(): Buffer {
  return Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
}

/** GIF89a 1×1 trong suốt. */
export function gif(): Buffer {
  return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
}

/** Polyglot GIF + JS: GIF hợp lệ có Comment Extension chứa mã JS (SEC-CH-06). */
export function gifJsPolyglot(payload = '*/alert(document.domain)/*'): Buffer {
  const g = gif();
  const trailer = g.length - 1; // ';'
  const text = Buffer.from(payload, 'ascii');
  const comment = Buffer.concat([
    Buffer.from([0x21, 0xfe, text.length]),
    text,
    Buffer.from([0x00]),
  ]);
  return Buffer.concat([g.subarray(0, trailer), comment, g.subarray(trailer)]);
}

/** TIFF little-endian tối thiểu (đổi tên `.jpg` — SEC-CH-21). */
export function tiff(): Buffer {
  return Buffer.concat([Buffer.from('II*\0', 'binary'), u32le(8), u16le(0), u32le(0)]);
}

// ---------------------------------------------------------------- văn bản / chạy được / web

export const html = () =>
  Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
export const svgScript = () =>
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const xml = () => Buffer.from('<?xml version="1.0"?><a>b</a>');
export const js = () => Buffer.from('fetch("/api/v1/auth/me").then(r=>r.text()).then(alert)');
export const exeMz = () =>
  Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(62), Buffer.from('PE\0\0', 'binary')]);
export const elf = () =>
  Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(57)]);
export const machO = () => Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(28)]);
export const shebang = () => Buffer.from('#!/bin/sh\nrm -rf /\n');
export const rar = () =>
  Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), Buffer.alloc(16)]);
export const sevenZ = () =>
  Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), Buffer.alloc(26)]);
export const gz = () => Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.alloc(17)]);
export const mp4 = () =>
  Buffer.concat([u32be(24), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(12)]);

/** PDF tối thiểu, kéo dài tới `size` byte bằng comment (SEC-CH-08 / 14). */
export function pdf(size = 1024): Buffer {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n', 'ascii');
  const tail = Buffer.from('\n%%EOF\n', 'ascii');
  const fill = Math.max(0, size - head.length - tail.length);
  return Buffer.concat([head, Buffer.alloc(fill, 0x25), tail]);
}

export const textWithNul = () => Buffer.from('dong 1\n\0dong 2\n', 'binary');

const CSV_TEXT = 'Họ tên,Phòng\nNguyễn Văn An,Kế toán\nTrần Thị Bình,Nhân sự\n';

/** CSV theo bảng mã (SEC-CH-32, F-05). `win1258`: byte ≥ 0x80 không phải UTF-8 hợp lệ, không NUL. */
export function csv(enc: 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'win1258'): Buffer {
  switch (enc) {
    case 'utf8':
      return Buffer.from(CSV_TEXT, 'utf8');
    case 'utf8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CSV_TEXT, 'utf8')]);
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CSV_TEXT, 'utf16le')]);
    case 'utf16be': {
      const le = Buffer.from(CSV_TEXT, 'utf16le');
      const be = Buffer.alloc(le.length);
      for (let i = 0; i < le.length; i += 2) {
        be[i] = le[i + 1] ?? 0;
        be[i + 1] = le[i] ?? 0;
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    }
    case 'win1258':
      // "Họ tên" ≈ H o + dấu nặng (0xF2 = combining dot below) … ; "Đ" = 0xD0. Không phải UTF-8 hợp lệ.
      return Buffer.from([
        ...Buffer.from('Ho', 'ascii'),
        0xf2,
        ...Buffer.from(' te', 'ascii'),
        0xea,
        ...Buffer.from('n,Ph', 'ascii'),
        0xf2,
        ...Buffer.from('ng\n', 'ascii'),
        0xd0,
        ...Buffer.from('inh Van An,Ke toan\n', 'ascii'),
      ]);
  }
}

// ---------------------------------------------------------------- ZIP STORED + Office / ODF

export interface ZipEntry {
  name: string;
  data: Buffer | string;
}

/** ZIP không nén (method 0) hợp lệ: local headers + central directory + EOCD. */
export function zipStored(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data;
    const crc = crc32(data);
    const local = Buffer.concat([
      u32le(0x04034b50),
      u16le(20),
      u16le(0x0800),
      u16le(0),
      u16le(0),
      u16le(0x21),
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(name.length),
      u16le(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      u32le(0x02014b50),
      u16le(20),
      u16le(20),
      u16le(0x0800),
      u16le(0),
      u16le(0),
      u16le(0x21),
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(name.length),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(0),
      u32le(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(entries.length),
    u16le(entries.length),
    u32le(cd.length),
    u32le(offset),
    u16le(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

const OOXML_MAIN: Record<
  'docx' | 'xlsx' | 'pptx',
  { part: string; type: string; macroType: string }
> = {
  docx: {
    part: '/word/document.xml',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    macroType: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  },
  xlsx: {
    part: '/xl/workbook.xml',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    macroType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  },
  pptx: {
    part: '/ppt/presentation.xml',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    macroType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  },
};

export interface OoxmlOptions {
  /** Khai content-type macroEnabled (đổi đuôi `.docm` → `.docx`). */
  macroEnabledType?: boolean;
  /** Có `vbaProject.bin`. */
  vbaProject?: boolean;
  externalLink?: boolean;
  oleObject?: boolean;
  /** `[Content_Types].xml` KHÔNG ở entry đầu (F-04: công cụ khác Word). */
  contentTypesLast?: boolean;
}

/** DOCX / XLSX / PPTX tối thiểu (SEC-CH-23 / 32 / 36). */
export function ooxml(kind: 'docx' | 'xlsx' | 'pptx', opts: OoxmlOptions = {}): Buffer {
  const main = OOXML_MAIN[kind];
  const ct =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="${main.part}" ContentType="${opts.macroEnabledType ? main.macroType : main.type}"/>` +
    (opts.vbaProject
      ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'
      : '') +
    '</Types>';
  const dir = main.part.split('/')[1] ?? 'word';
  const parts: ZipEntry[] = [
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: main.part.slice(1), data: '<root/>' },
  ];
  if (opts.vbaProject)
    parts.push({ name: `${dir}/vbaProject.bin`, data: Buffer.from('VBA-PROJECT') });
  if (opts.externalLink)
    parts.push({ name: `${dir}/externalLinks/externalLink1.xml`, data: '<externalLink/>' });
  if (opts.oleObject)
    parts.push({ name: `${dir}/embeddings/oleObject1.bin`, data: Buffer.from('OLE') });
  const types = { name: '[Content_Types].xml', data: ct };
  return zipStored(opts.contentTypesLast ? [...parts, types] : [types, ...parts]);
}

/** ODT / ODS tối thiểu: `mimetype` (STORED, entry đầu) + manifest. `basic` ⇒ có thư mục `Basic/` (macro). */
export function odf(kind: 'odt' | 'ods', { basic = false, scripts = false } = {}): Buffer {
  const mime =
    kind === 'odt'
      ? 'application/vnd.oasis.opendocument.text'
      : 'application/vnd.oasis.opendocument.spreadsheet';
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: mime },
    { name: 'META-INF/manifest.xml', data: '<manifest:manifest/>' },
    { name: 'content.xml', data: '<office:document-content/>' },
  ];
  if (basic) entries.push({ name: 'Basic/Standard/Module1.xml', data: '<script:module/>' });
  if (scripts) entries.push({ name: 'Scripts/python/x.py', data: 'print(1)' });
  return zipStored(entries);
}

/** ZIP thuần (không Office) — cấm (SEC-CH-06). */
export const plainZip = () => zipStored([{ name: 'a.txt', data: 'xin chao' }]);

/** ZIP Office có `count` entry (> 2 000 ⇒ 415 — SEC-CH-36). */
export function bigOoxml(count = 2001): Buffer {
  const base: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: `<Types><Override PartName="/word/document.xml" ContentType="${OOXML_MAIN.docx.type}"/></Types>`,
    },
    { name: 'word/document.xml', data: '<root/>' },
  ];
  const filler = Array.from({ length: Math.max(0, count - base.length) }, (_, i) => ({
    name: `word/media/f${String(i)}.xml`,
    data: 'x',
  }));
  return zipStored([...base, ...filler]);
}

/** Tệp kích thước tùy ý (PDF hợp lệ) — ca dung lượng. */
export const bytes = (n: number) => pdf(n);
