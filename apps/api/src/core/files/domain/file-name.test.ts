import { describe, expect, it } from 'vitest';

import {
  asciiFallbackName,
  attachmentDisposition,
  decodeUploadName,
  extensionOf,
  FALLBACK_FILE_NAME,
  sanitizeFileName,
  UPLOAD_NAME_MAX_BYTES,
} from './file-name';

describe('decodeUploadName — X-Upload-Name (F-03c, SEC-CH-09)', () => {
  it('giải mã encodeURIComponent tiếng Việt', () => {
    expect(decodeUploadName(encodeURIComponent('Báo cáo tháng 10.pdf'))).toEqual({
      ok: true,
      name: 'Báo cáo tháng 10.pdf',
    });
  });

  it.each([
    ['thiếu', undefined],
    ['rỗng', ''],
    ['lặp header (mảng)', ['a.pdf', 'b.pdf']],
    ['percent hỏng', '%E0%A4%A'],
    ['%ZZ', 'a%ZZ.pdf'],
    ['nửa surrogate', '%ED%A0%80'],
  ])('%s ⇒ không hợp lệ', (_n, header) => {
    expect(decodeUploadName(header as never)).toEqual({ ok: false });
  });

  it(`biên ${UPLOAD_NAME_MAX_BYTES} / ${UPLOAD_NAME_MAX_BYTES + 1} byte sau giải mã`, () => {
    const at = `${'ệ'.repeat(84)}.pd`; // 84 × 3 + 3 = 255 byte
    expect(Buffer.byteLength(at)).toBe(255);
    expect(decodeUploadName(encodeURIComponent(at)).ok).toBe(true);
    expect(decodeUploadName(encodeURIComponent(`${at}f`)).ok).toBe(false);
  });

  it('tên lạ vẫn hợp lệ ở bước giải mã (làm sạch sau)', () => {
    expect(decodeUploadName(encodeURIComponent('../../etc/passwd')).ok).toBe(true);
    expect(decodeUploadName('a%00b.txt').ok).toBe(true);
  });
});

describe('sanitizeFileName (CH-04)', () => {
  it.each([
    ['../../etc/passwd', 'etcpasswd'],
    ['..\\..\\boot.ini', 'boot.ini'],
    ['a\u0000b.txt', 'ab.txt'],
    ['invoice‮fdp.exe', 'invoicefdp.exe'],
    ['x⁦y⁩z.pdf', 'xyz.pdf'],
    ['‎a‏.txt', 'a.txt'],
    ['a:b*c?d"e<f>g|h.txt', 'abcdefgh.txt'],
    ['  nhiều    khoảng \t trắng .pdf', 'nhiều khoảng trắng .pdf'],
    ['...ẩn.txt...', 'ẩn.txt'],
    ['ctrl\u0085c1\u009f.txt', 'ctrlc1.txt'],
  ])('%j ⇒ %j', (raw, clean) => {
    expect(sanitizeFileName(raw)).toBe(clean);
  });

  it('NFC: tổ hợp NFD được chuẩn hóa', () => {
    const nfd = 'Tiếng.txt';
    expect(sanitizeFileName(nfd)).toBe('Tiếng.txt');
    expect(sanitizeFileName(nfd)).toBe(sanitizeFileName(nfd).normalize('NFC'));
  });

  it('làm sạch xong rỗng ⇒ tên dự phòng', () => {
    expect(sanitizeFileName('/\\::..')).toBe(FALLBACK_FILE_NAME);
    expect(sanitizeFileName('‮')).toBe(FALLBACK_FILE_NAME);
  });

  it('kết quả không bao giờ chứa ký tự nguy hiểm', () => {
    const nasty = '\u0000\u001f/\\:*?"<>|‪‫‬‭‮⁦⁧⁨⁩x';
    expect(sanitizeFileName(nasty)).toBe('x');
  });
});

describe('extensionOf', () => {
  it.each([
    ['a.PDF', 'pdf'],
    ['a.tar.gz', 'gz'],
    ['báo cáo.docx', 'docx'],
    ['noext', ''],
    ['.bashrc', ''],
    ['a.', ''],
    ['a.verylongext1', ''],
    ['a.p-f', ''],
  ])('%s ⇒ %j', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});

describe('attachmentDisposition — filename ASCII + filename* (ADR-141)', () => {
  it('tên tiếng Việt', () => {
    expect(attachmentDisposition('Bảng lương đợt 1.xlsx')).toBe(
      `attachment; filename="Bang luong dot 1.xlsx"; filename*=UTF-8''B%E1%BA%A3ng%20l%C6%B0%C6%A1ng%20%C4%91%E1%BB%A3t%201.xlsx`,
    );
  });

  it("mã hóa nốt '()*! trong filename*", () => {
    expect(attachmentDisposition("a'(b)*!.txt")).toContain(
      "filename*=UTF-8''a%27%28b%29%2A%21.txt",
    );
  });

  it('ASCII dự phòng: ký tự ngoài ASCII in được ⇒ _, Đ/đ ⇒ D/d', () => {
    expect(asciiFallbackName('Đơn 日本.pdf')).toBe('Don __.pdf');
    expect(asciiFallbackName('日本')).toBe('__');
  });

  it('ASCII dự phòng rỗng ⇒ tên dự phòng', () => {
    expect(asciiFallbackName('')).toBe(FALLBACK_FILE_NAME);
  });
});
