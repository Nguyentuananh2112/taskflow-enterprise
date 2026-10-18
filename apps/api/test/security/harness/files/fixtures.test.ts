import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import * as fx from './fixtures';

// Harness Mốc 6 (test-spec-chat §1.2): tệp mẫu đúng cấu trúc byte. Nếu tìm thấy sharp (phụ thuộc của `next` trong
// node_modules/.pnpm) thì giải mã THẬT bằng sharp — cùng thư viện API dùng (ADR-141). Không thấy ⇒ chỉ kiểm cấu trúc.

type Sharp = (input: Buffer) => {
  metadata(): Promise<Record<string, unknown>>;
  raw(): { toBuffer(): Promise<Buffer> };
};
function findSharp(): Sharp | undefined {
  const pnpmDir = join(__dirname, '..', '..', '..', '..', '..', '..', 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return undefined;
  const dir = readdirSync(pnpmDir).find((d) => /^sharp@\d/.test(d));
  if (!dir) return undefined;
  try {
    return createRequire(__filename)(join(pnpmDir, dir, 'node_modules', 'sharp')) as Sharp;
  } catch {
    return undefined;
  }
}
const sharp = findSharp();

/** Đọc central directory của ZIP (dò EOCD từ cuối). */
function zipNames(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'));
    at += 46 + nameLen + extra + comment;
  }
  return names;
}

describe('fixtures — ảnh', () => {
  it('PNG: chữ ký, CRC mọi chunk đúng, IDAT giải nén đủ w×h', async () => {
    const buf = fx.png({ w: 20, h: 10 });
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    let at = 8;
    let idat: Buffer = Buffer.alloc(0);
    while (at < buf.length) {
      const len = buf.readUInt32BE(at);
      const type = buf.subarray(at + 4, at + 8);
      const data = buf.subarray(at + 8, at + 8 + len);
      expect(buf.readUInt32BE(at + 8 + len)).toBe(fx.crc32(Buffer.concat([type, data])));
      if (type.toString() === 'IDAT') idat = data;
      at += 12 + len;
    }
    expect(inflateSync(idat).length).toBe(10 * (1 + 3 * 20));
    if (sharp) {
      expect(await sharp(buf).metadata()).toMatchObject({ format: 'png', width: 20, height: 10 });
      expect(await sharp(buf).raw().toBuffer()).toHaveLength(20 * 10 * 3);
    }
  });

  it('pixel bomb: IHDR khai 50 000², tệp nhỏ', () => {
    const buf = fx.pixelBombPng();
    expect(buf.readUInt32BE(16)).toBe(50_000);
    expect(buf.readUInt32BE(20)).toBe(50_000);
    expect(buf.length).toBeLessThan(50_000);
  });

  it('JPEG: SOI / SOF0 / EOI, kích thước khai đúng; sharp đọc được', async () => {
    const buf = fx.jpeg({ w: 24, h: 16 });
    expect(buf.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(buf.subarray(-2).toString('hex')).toBe('ffd9');
    const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
    expect(buf.readUInt16BE(sof + 5)).toBe(16);
    expect(buf.readUInt16BE(sof + 7)).toBe(24);
    if (sharp) {
      expect(await sharp(buf).metadata()).toMatchObject({ format: 'jpeg', width: 24, height: 16 });
      // Giải mã ĐẦY ĐỦ (không chỉ header): mọi pixel = 128 (DC = 0 sau dịch mức).
      const px = await sharp(buf).raw().toBuffer();
      // libvips có thể xuất xám thành 3 kênh sRGB ⇒ bội số của w×h.
      expect(px.length % (24 * 16)).toBe(0);
      expect(new Set(px)).toEqual(new Set([128]));
    }
  });

  it('JPEG + EXIF GPS: APP1 "Exif", tag GPSInfo 0x8825, vĩ độ / kinh độ có mặt', async () => {
    const buf = fx.jpegWithGps();
    const app1 = buf.indexOf(Buffer.from([0xff, 0xe1]));
    expect(app1).toBe(2);
    expect(buf.subarray(app1 + 4, app1 + 10).toString('binary')).toBe('Exif\0\0');
    expect(buf.includes(Buffer.from([0x88, 0x25, 0x00, 0x04]))).toBe(true);
    expect(buf.includes(Buffer.from('TaskFlowCam'))).toBe(true);
    if (sharp) {
      const meta = await sharp(buf).metadata();
      expect(meta.format).toBe('jpeg');
      expect(Buffer.isBuffer(meta.exif)).toBe(true);
      expect((await sharp(buf).raw().toBuffer()).length % (32 * 32)).toBe(0);
    }
  });

  it('WebP / GIF / polyglot GIF / TIFF: chữ ký đúng; polyglot vẫn là GIF và chứa payload', async () => {
    expect(fx.webp().subarray(0, 4).toString()).toBe('RIFF');
    expect(fx.webp().subarray(8, 12).toString()).toBe('WEBP');
    expect(fx.gif().subarray(0, 6).toString()).toBe('GIF89a');
    const poly = fx.gifJsPolyglot();
    expect(poly.subarray(0, 6).toString()).toBe('GIF89a');
    expect(poly.toString('latin1')).toContain('alert(document.domain)');
    expect(poly.at(-1)).toBe(0x3b);
    expect(fx.tiff().subarray(0, 4).toString('binary')).toBe('II*\0');
    if (sharp) {
      expect(await sharp(fx.webp()).metadata()).toMatchObject({
        format: 'webp',
        width: 1,
        height: 1,
      });
      expect(await sharp(poly).metadata()).toMatchObject({ format: 'gif' });
    }
  });
});

describe('fixtures — ZIP / Office / ODF', () => {
  it('zipStored: central directory liệt kê đúng tên, theo thứ tự', () => {
    expect(
      zipNames(
        fx.zipStored([
          { name: 'a.txt', data: 'x' },
          { name: 'b/c.xml', data: '<c/>' },
        ]),
      ),
    ).toEqual(['a.txt', 'b/c.xml']);
  });

  it('DOCX: [Content_Types].xml đầu (mặc định) hoặc cuối (F-04); macro / externalLink / OLE có entry tương ứng', () => {
    expect(zipNames(fx.ooxml('docx'))[0]).toBe('[Content_Types].xml');
    expect(zipNames(fx.ooxml('docx', { contentTypesLast: true })).at(-1)).toBe(
      '[Content_Types].xml',
    );
    expect(zipNames(fx.ooxml('docx', { vbaProject: true }))).toContain('word/vbaProject.bin');
    expect(zipNames(fx.ooxml('xlsx', { externalLink: true }))).toContain(
      'xl/externalLinks/externalLink1.xml',
    );
    expect(zipNames(fx.ooxml('pptx', { oleObject: true }))).toContain(
      'ppt/embeddings/oleObject1.bin',
    );
    expect(fx.ooxml('docx', { macroEnabledType: true }).toString('utf8')).toContain('macroEnabled');
  });

  it('ODF: mimetype là entry đầu; Basic/ khi có macro; bigOoxml 2 001 entry', () => {
    expect(zipNames(fx.odf('odt'))[0]).toBe('mimetype');
    expect(zipNames(fx.odf('ods', { basic: true }))).toContain('Basic/Standard/Module1.xml');
    expect(zipNames(fx.bigOoxml(2001))).toHaveLength(2001);
  });
});

describe('fixtures — văn bản / cấm', () => {
  it('CSV 5 bảng mã: BOM đúng; win1258 không phải UTF-8 hợp lệ, không NUL', () => {
    expect(fx.csv('utf8bom').subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(fx.csv('utf16le').subarray(0, 2).toString('hex')).toBe('fffe');
    expect(fx.csv('utf16be').subarray(0, 2).toString('hex')).toBe('feff');
    const w = fx.csv('win1258');
    expect(w.includes(0)).toBe(false);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(w)).toThrow();
    expect(new TextDecoder('utf-8', { fatal: true }).decode(fx.csv('utf8'))).toContain('Nguyễn');
  });

  it('chạy được / nén / web: magic đúng; PDF đúng kích thước', () => {
    expect(fx.exeMz().subarray(0, 2).toString()).toBe('MZ');
    expect(fx.elf().subarray(0, 4).toString('hex')).toBe('7f454c46');
    expect(fx.rar().subarray(0, 4).toString()).toBe('Rar!');
    expect(fx.gz().subarray(0, 2).toString('hex')).toBe('1f8b');
    expect(fx.textWithNul().includes(0)).toBe(true);
    expect(fx.pdf(5000)).toHaveLength(5000);
    expect(fx.pdf(5000).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
