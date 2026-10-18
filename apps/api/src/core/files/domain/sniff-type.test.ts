import { describe, expect, it } from 'vitest';

import { buildZip, odf, ooxml } from '../testing/zip-builder';
import { bufferSource, inspectZip, isActiveContentEntry, ZIP_MAX_ENTRIES } from './inspect-zip';
import { isImageType, matchOfficeType, sniffType } from './sniff-type';
import { detectTextEncoding, isUtf8Text } from './text-encoding';

// CH-03 (test-spec-chat §1.2): sniffType + inspectZip — mỗi hàm sinh mẫu có ít nhất một ca.
const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF\0');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR');
const GIF = bytes('GIF89a', [1, 0, 1, 0]);
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const PDF = bytes('%PDF-1.4\n%\xe2\xe3\n');

const ODT = 'application/vnd.oasis.opendocument.text';
const ODS = 'application/vnd.oasis.opendocument.spreadsheet';

describe('sniffType — ảnh và PDF theo magic (CH-03)', () => {
  it.each([
    ['jpeg', JPEG, 'jpg'],
    ['jpeg', JPEG, 'jpeg'],
    ['png', PNG, 'png'],
    ['gif', GIF, 'gif'],
    ['webp', WEBP, 'webp'],
    ['pdf', PDF, 'pdf'],
  ] as const)('%s với đuôi .%s', (type, head, ext) => {
    expect(sniffType(head, ext)).toEqual({ ok: true, type });
  });

  it('đuôi không khớp nội dung ⇒ 415 (PNG đuôi .exe, EXE đuôi .pdf)', () => {
    expect(sniffType(PNG, 'exe')).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
    expect(sniffType(PNG, 'jpg').ok).toBe(false);
    expect(sniffType(bytes('MZ', [0x90, 0]), 'pdf').ok).toBe(false);
  });

  it('isImageType chỉ cho 4 loại ảnh', () => {
    expect(['jpeg', 'png', 'webp', 'gif'].every((t) => isImageType(t as never))).toBe(true);
    expect(isImageType('pdf')).toBe(false);
    expect(isImageType('txt')).toBe(false);
  });

  it('GIF polyglot (GIF89a + comment JS) vẫn là GIF — vô hại vì sẽ mã hóa lại (SEC-CH-06)', () => {
    const polyglot = bytes('GIF89a/*', [1, 0, 1, 0], '*/=1;alert(1);//');
    expect(sniffType(polyglot, 'gif')).toEqual({ ok: true, type: 'gif' });
  });
});

describe('sniffType — luôn cấm (SEC-CH-06/21)', () => {
  it.each([
    ['exeMz', bytes('MZ', [0x90, 0x00, 0x03])],
    ['elf', bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1])],
    ['machO 64', bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0])],
    ['machO fat', bytes([0xca, 0xfe, 0xba, 0xbe])],
    ['machO BE', bytes([0xfe, 0xed, 0xfa, 0xce])],
    ['shebang', bytes('#!/bin/sh\necho hi\n')],
    ['rar', bytes('Rar!', [0x1a, 0x07, 0x00])],
    ['7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
    ['gzip', bytes([0x1f, 0x8b, 0x08])],
    ['bzip2', bytes('BZh91AY')],
    ['xz', bytes([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])],
    ['OLE .doc', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ['tiffAsJpg LE', bytes([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])],
    ['tiff BE', bytes([0x4d, 0x4d, 0x00, 0x2a])],
    ['HEIC', bytes([0, 0, 0, 0x18], 'ftypheic')],
    ['MP4', bytes([0, 0, 0, 0x20], 'ftypisom')],
    ['AVI', bytes('RIFF', [0, 0, 0, 0], 'AVI LIST')],
    ['WebM', bytes([0x1a, 0x45, 0xdf, 0xa3])],
    ['Ogg', bytes('OggS')],
    ['MP3', bytes('ID3', [4, 0])],
    ['FLAC', bytes('fLaC')],
    ['BMP', bytes('BM6')],
    ['wasm', bytes([0, 0x61, 0x73, 0x6d])],
  ])('%s', (_name, head) => {
    for (const ext of ['jpg', 'pdf', 'txt', 'png', 'docx']) {
      expect(sniffType(head, ext)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
    }
  });

  it('html() / svgScript() / XML / JS: văn bản nhưng đuôi không phải txt/csv ⇒ 415', () => {
    expect(sniffType(bytes('<!doctype html><script>x</script>'), 'html').ok).toBe(false);
    expect(sniffType(bytes('<svg onload="alert(1)"/>'), 'svg').ok).toBe(false);
    expect(sniffType(bytes('<?xml version="1.0"?><a/>'), 'xml').ok).toBe(false);
    expect(sniffType(bytes('alert(1)'), 'js').ok).toBe(false);
  });

  it('SVG đổi tên thành .jpg / magic giả JPEG ngắn ⇒ 415 (SEC-CH-21)', () => {
    expect(sniffType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'jpg').ok).toBe(false);
    expect(sniffType(bytes([0xff, 0xd8]), 'jpg').ok).toBe(false);
  });

  it('TXT chứa HTML vẫn là TXT (phục vụ attachment + octet-stream — SEC-CH-10)', () => {
    expect(sniffType(bytes('<html><script>alert(1)</script></html>'), 'txt')).toEqual({
      ok: true,
      type: 'txt',
      textEncoding: 'utf-8',
    });
  });

  it('không có đuôi ⇒ 415', () => {
    expect(sniffType(PNG, '').ok).toBe(false);
    expect(sniffType(bytes('abc'), '').ok).toBe(false);
  });

  it('ZIP chỉ đi tiếp khi đuôi là Office/ODF; ZIP đuôi .zip ⇒ 415 ngay', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'x' }]);
    expect(sniffType(zip, 'zip').ok).toBe(false);
    expect(sniffType(zip, 'jpg').ok).toBe(false);
    for (const ext of ['docx', 'xlsx', 'pptx', 'odt', 'ods']) {
      expect(sniffType(zip, ext)).toEqual({ ok: true, type: 'zip' });
    }
  });
});

describe('sniffType — TXT/CSV theo mã hóa (F-05, csv(...) / textWithNul)', () => {
  const vi = 'Họ tên,Số tiền\nNguyễn Văn A,1000\n';
  it('utf8', () => {
    expect(sniffType(Buffer.from(vi, 'utf8'), 'csv')).toEqual({
      ok: true,
      type: 'csv',
      textEncoding: 'utf-8',
    });
  });
  it('utf8bom', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(vi, 'utf8')]);
    expect(sniffType(b, 'csv')).toMatchObject({ ok: true, textEncoding: 'utf-8' });
  });
  it('utf16le có BOM', () => {
    const b = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(vi, 'utf16le')]);
    expect(sniffType(b, 'csv')).toMatchObject({ ok: true, textEncoding: 'utf-16le' });
  });
  it('utf16be có BOM', () => {
    const le = Buffer.from(vi, 'utf16le');
    const be = Buffer.from(le).swap16();
    expect(sniffType(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), 'txt')).toMatchObject({
      ok: true,
      textEncoding: 'utf-16be',
    });
  });
  it('win1258: byte cao không phải UTF-8 hợp lệ, không NUL', () => {
    // "Tiếng Việt" kiểu 1258 rút gọn: ê = 0xEA, dấu sắc kết hợp = 0xEC, ệ ⇒ 0xEA + 0xF2 (dấu nặng).
    const b = bytes('Ti', [0xea, 0xec], 'ng Vi', [0xea, 0xf2], 't\r\n');
    expect(sniffType(b, 'txt')).toMatchObject({ ok: true, textEncoding: 'windows-1258' });
  });
  it('byte chưa gán của 1258 (0x81) ⇒ không phải văn bản', () => {
    expect(sniffType(bytes('ab', [0x81], 'c'), 'txt').ok).toBe(false);
  });
  it('textWithNul ⇒ 415', () => {
    expect(sniffType(bytes('abc', [0], 'def'), 'txt').ok).toBe(false);
  });
  it('ký tự điều khiển lạ (0x01, DEL) ⇒ 415; TAB/CR/LF/FF/SUB được', () => {
    expect(sniffType(bytes('a', [0x01], 'b'), 'txt').ok).toBe(false);
    expect(sniffType(bytes('a', [0x7f], 'b'), 'txt').ok).toBe(false);
    expect(sniffType(bytes('a\tb\r\nc', [0x0c, 0x0b, 0x1a]), 'txt').ok).toBe(true);
  });
  it('UTF-16 có BOM nhưng chứa đơn vị điều khiển ⇒ 415', () => {
    expect(sniffType(Buffer.from([0xff, 0xfe, 0x01, 0x00, 0x41, 0x00]), 'txt').ok).toBe(false);
    expect(sniffType(Buffer.from([0xfe, 0xff, 0x00, 0x7f]), 'txt').ok).toBe(false);
  });
  it('UTF-8 BOM nhưng phần sau hỏng ⇒ 415 (không rơi sang 1258)', () => {
    expect(sniffType(bytes([0xef, 0xbb, 0xbf], 'a', [0xc3]), 'txt', true).ok).toBe(false);
  });
  it('tệp rỗng là TXT utf-8', () => {
    expect(sniffType(Buffer.alloc(0), 'txt', true)).toMatchObject({
      ok: true,
      textEncoding: 'utf-8',
    });
  });
});

describe('isUtf8Text — biên RFC 3629', () => {
  it.each([
    ['ASCII', [0x41], true],
    ['2 byte', [0xc3, 0xa9], true],
    ['3 byte', [0xe1, 0xbb, 0x87], true],
    ['4 byte', [0xf0, 0x9f, 0x98, 0x80], true],
    ['U+10FFFF', [0xf4, 0x8f, 0xbf, 0xbf], true],
    ['overlong 2 byte (C0/C1)', [0xc0, 0xaf], false],
    ['overlong 3 byte', [0xe0, 0x80, 0xaf], false],
    ['overlong 4 byte', [0xf0, 0x80, 0x80, 0xaf], false],
    ['surrogate', [0xed, 0xa0, 0x80], false],
    ['> U+10FFFF', [0xf4, 0x90, 0x80, 0x80], false],
    ['F5', [0xf5, 0x80, 0x80, 0x80], false],
    ['byte tiếp nối lẻ', [0x80], false],
    ['tiếp nối sai ở byte 3', [0xe1, 0xbb, 0x41], false],
  ] as const)('%s', (_n, seq, ok) => {
    expect(isUtf8Text(Uint8Array.from(seq), false)).toBe(ok);
  });

  it('chuỗi bị cắt ở CUỐI mẫu: hợp lệ khi truncated, hỏng khi là toàn tệp', () => {
    const cut = Uint8Array.from([0x41, 0xe1, 0xbb]);
    expect(isUtf8Text(cut, true)).toBe(true);
    expect(isUtf8Text(cut, false)).toBe(false);
    expect(detectTextEncoding(cut, false)).toBe('windows-1258'); // không phải UTF-8 hợp lệ, không NUL
  });
});

describe('inspectZip — central directory (CH-03, F-04, B M6)', () => {
  const check = (buf: Buffer) => inspectZip(bufferSource(buf));

  it.each(['docx', 'xlsx', 'pptx'] as const)('%s', async (kind) => {
    expect(await check(ooxml(kind))).toEqual({ ok: true, type: kind });
  });

  it('không phụ thuộc thứ tự entry ([Content_Types].xml cuối — order)', async () => {
    expect(await check(ooxml('docx', { contentTypesLast: true }))).toEqual({
      ok: true,
      type: 'docx',
    });
  });

  it('[Content_Types].xml STORED cũng đọc được', async () => {
    expect(await check(ooxml('xlsx', { deflate: false }))).toEqual({ ok: true, type: 'xlsx' });
  });

  it('odt / ods', async () => {
    expect(await check(odf(ODT))).toEqual({ ok: true, type: 'odt' });
    expect(await check(odf(ODS))).toEqual({ ok: true, type: 'ods' });
  });

  it('ODF khác (odp, odg) ⇒ 415', async () => {
    expect(await check(odf('application/vnd.oasis.opendocument.presentation'))).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it.each([
    [
      'docx({macro})',
      ooxml('docx', { extraEntries: [{ name: 'word/vbaProject.bin', data: 'x' }] }),
    ],
    [
      'docx({externalLink})',
      ooxml('xlsx', {
        extraEntries: [{ name: 'xl/externalLinks/externalLink1.xml', data: '<x/>' }],
      }),
    ],
    [
      'docx({oleObject})',
      ooxml('docx', { extraEntries: [{ name: 'word/embeddings/oleObject1.bin', data: 'x' }] }),
    ],
    [
      'embeddings/*.bin',
      ooxml('pptx', { extraEntries: [{ name: 'ppt/embeddings/Microsoft_Word.bin', data: 'x' }] }),
    ],
    [
      'activeX',
      ooxml('docx', { extraEntries: [{ name: 'word/activeX/activeX1.xml', data: '<x/>' }] }),
    ],
    [
      'content-type macroEnabled (.docm đổi .docx)',
      ooxml('docx', {
        ctExtra:
          '<Default Extension="bin" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>',
      }),
    ],
    [
      'content-type externalLink',
      ooxml('xlsx', {
        ctExtra:
          '<Override PartName="/x" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>',
      }),
    ],
    [
      'odt({basic})',
      odf(ODT, { extraEntries: [{ name: 'Basic/Standard/Module1.xml', data: '<x/>' }] }),
    ],
    ['ODF Scripts/', odf(ODS, { extraEntries: [{ name: 'Scripts/python/x.py', data: 'x' }] })],
    [
      'ODF manifest trỏ Basic/',
      odf(ODT, { manifest: '<manifest:file-entry manifest:full-path="Basic/Standard/"/>' }),
    ],
  ])('%s ⇒ MACRO_OR_ACTIVE_CONTENT (SEC-CH-23/36)', async (_n, buf) => {
    expect(await check(buf)).toEqual({ ok: false, reason: 'MACRO_OR_ACTIVE_CONTENT' });
  });

  it('manifest ODF bình thường vẫn qua', async () => {
    const manifest = '<manifest:file-entry manifest:full-path="content.xml"/>';
    expect(await check(odf(ODT, { manifest }))).toEqual({ ok: true, type: 'odt' });
  });

  it(`bigZip(${ZIP_MAX_ENTRIES + 1}) ⇒ 415; đúng ${ZIP_MAX_ENTRIES} entry vẫn đọc`, async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `p/${i}.xml`, data: '' }));
    const atCap = ooxml('docx', { extraEntries: many(ZIP_MAX_ENTRIES - 3) });
    expect(await check(atCap)).toEqual({ ok: true, type: 'docx' });
    const over = ooxml('docx', { extraEntries: many(ZIP_MAX_ENTRIES - 2) });
    expect(await check(over)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('ZIP thuần ⇒ 415', async () => {
    expect(await check(buildZip([{ name: 'a.txt', data: 'x' }]))).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  it('[Content_Types].xml bung > 1 MB (bomb) ⇒ 415', async () => {
    const bomb = buildZip([
      { name: '[Content_Types].xml', data: ' '.repeat(1024 * 1024 + 1), deflate: true },
    ]);
    expect(await check(bomb)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('EOCD sau comment dài vẫn tìm được', async () => {
    const zip = buildZip([{ name: 'mimetype', data: ODT }], { comment: 'c'.repeat(60_000) });
    expect(await check(zip)).toEqual({ ok: true, type: 'odt' });
  });

  it.each([
    ['quá ngắn', Buffer.from('PK\x03\x04')],
    ['không có EOCD', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)])],
    ['central directory cắt cụt', ooxml('docx').subarray(0, -30)],
  ])('ZIP hỏng (%s) ⇒ 415, không ném', async (_n, buf) => {
    expect(await check(buf)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('cd offset trỏ ngoài tệp ⇒ 415', async () => {
    const zip = ooxml('docx');
    zip.writeUInt32LE(zip.length + 10, zip.length - 22 + 16);
    expect(await check(zip)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('ZIP64 / đa đĩa ⇒ 415', async () => {
    const zip64 = ooxml('docx');
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    expect(await check(zip64)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
    const multi = ooxml('docx');
    multi.writeUInt16LE(1, multi.length - 22 + 4);
    expect(await check(multi)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('entry mã hóa ⇒ 415', async () => {
    const zip = ooxml('docx', { contentTypesLast: false });
    // cờ bit 0 trong central directory của entry đầu ([Content_Types].xml)
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(0x0801, cdOffset + 8);
    expect(await check(zip)).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('matchOfficeType: loại đọc được phải khớp đuôi', () => {
    expect(matchOfficeType('docx', 'docx')).toBe(true);
    expect(matchOfficeType('xlsx', 'docx')).toBe(false);
    expect(matchOfficeType('odt', 'ods')).toBe(false);
  });

  it('isActiveContentEntry không chặn tên bình thường', () => {
    expect(isActiveContentEntry('word/document.xml')).toBe(false);
    expect(isActiveContentEntry('word/media/image1.png')).toBe(false);
    expect(isActiveContentEntry('word/embeddings/Sheet1.xlsx')).toBe(false);
  });
});
