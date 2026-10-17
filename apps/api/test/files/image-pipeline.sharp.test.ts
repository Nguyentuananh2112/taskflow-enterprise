import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BusinessRuleViolationError } from '../../src/core/errors';
import { UnsupportedFileTypeError } from '../../src/core/errors';
import { SharpImagePipeline } from '../../src/core/files/infrastructure/image-pipeline';
import * as fx from '../security/harness/files/fixtures';

/**
 * Worker sharp THẬT (ADR-141, B HIGH-2) — AV-02, SEC-CH-06/07/08/21/33. Ảnh nhỏ, nhanh; không phải job nặng.
 */
let pipeline: SharpImagePipeline;
beforeAll(() => {
  pipeline = new SharpImagePipeline();
});
afterAll(async () => {
  await pipeline.close();
});

const AVATAR = [
  { name: '256', size: 256, fit: 'cover' as const },
  { name: '64', size: 64, fit: 'cover' as const },
];
const CHAT = [
  { name: 'preview', size: 1600, fit: 'inside' as const },
  { name: 'thumb', size: 320, fit: 'inside' as const },
];
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
const ruleOf = (e: unknown) => (e as BusinessRuleViolationError).details?.['rule'];

describe('mã hóa lại (AV-02, SEC-CH-07)', () => {
  it('JPEG có EXIF GPS ⇒ avatar 256/64 WebP vuông, không EXIF / XMP / ICC', async () => {
    const out = await pipeline.transform(fx.jpegWithGps({ w: 300, h: 200 }), 'jpeg', AVATAR);
    expect(out.map((v) => [v.name, v.width, v.height])).toEqual([
      ['256', 256, 256],
      ['64', 64, 64],
    ]);
    for (const v of out) {
      const meta = await sharp(v.data).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(v.data.includes(Buffer.from('GPS'))).toBe(false);
    }
  });

  it('ảnh chat giữ tỉ lệ, không phóng to ảnh nhỏ', async () => {
    const out = await pipeline.transform(fx.png({ w: 400, h: 100 }), 'png', CHAT);
    expect(out.map((v) => [v.name, v.width, v.height])).toEqual([
      ['preview', 400, 100],
      ['thumb', 320, 80],
    ]);
  });

  it.each([
    ['webp', () => fx.webp()],
    ['gif', () => fx.gif()],
  ] as const)('%s ⇒ WebP', async (type, make) => {
    const [v] = await pipeline.transform(make(), type, [{ name: 't', size: 64, fit: 'inside' }]);
    expect((await sharp(v!.data).metadata()).format).toBe('webp');
  });

  it('GIF polyglot (GIF + JS) ⇒ đầu ra không còn payload (SEC-CH-06)', async () => {
    const payload = '*/alert(document.domain)/*';
    const [v] = await pipeline.transform(fx.gifJsPolyglot(payload), 'gif', [
      { name: 't', size: 64, fit: 'inside' },
    ]);
    expect(v!.data.includes(Buffer.from('alert'))).toBe(false);
  });
});

describe('GIF nhiều khung — chỉ giải mã khung đầu (B)', () => {
  it('GIF 120 khung ≈ thời gian GIF 1 khung; đầu ra một khung', async () => {
    const frame = (c: string) =>
      sharp({ create: { width: 400, height: 400, channels: 3, background: c } })
        .png()
        .toBuffer();
    const frames = await Promise.all(
      Array.from({ length: 120 }, (_, i) => frame(i % 2 ? '#f00' : '#00f')),
    );
    const many = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    const one = await sharp(frames[0]).gif().toBuffer();
    expect((await sharp(many).metadata()).pages).toBe(120);
    const spec = [{ name: 't', size: 64, fit: 'inside' as const }];
    await pipeline.transform(one, 'gif', spec); // khởi động worker
    let t = performance.now();
    await pipeline.transform(one, 'gif', spec);
    const oneMs = performance.now() - t;
    t = performance.now();
    const [v] = await pipeline.transform(many, 'gif', spec);
    const manyMs = performance.now() - t;
    expect(manyMs).toBeLessThan(oneMs * 5 + 300);
    expect((await sharp(v!.data).metadata()).pages ?? 1).toBe(1);
  });

  it('GIF khai canvas 60000² với khung 1×1: libvips lấy kích thước khung, không cấp phát canvas', async () => {
    const gif = Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from([0x60, 0xea, 0x60, 0xea, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
      Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b]),
    ]);
    const t = performance.now();
    const [v] = await pipeline.transform(gif, 'gif', [{ name: 't', size: 64, fit: 'inside' }]);
    expect(performance.now() - t).toBeLessThan(2_000);
    expect([v!.width, v!.height]).toEqual([1, 1]);
  });
});

describe('từ chối (SEC-CH-08/21/33)', () => {
  it('pixel bomb 50 000² ⇒ 422 IMAGE_TOO_COMPLEX trong ≤ 2 s, không giải mã', async () => {
    const t = performance.now();
    const err = await pipeline.transform(fx.pixelBombPng(), 'png', AVATAR).catch((e: unknown) => e);
    expect(ruleOf(err)).toBe('IMAGE_TOO_COMPLEX');
    expect(performance.now() - t).toBeLessThan(2_000);
  });

  it('PNG magic nhưng hỏng ⇒ 422 IMAGE_UNREADABLE', async () => {
    const err = await pipeline
      .transform(fx.pngMagicButCorrupt(), 'png', AVATAR)
      .catch((e: unknown) => e);
    expect(ruleOf(err)).toBe('IMAGE_UNREADABLE');
  });

  it.each([
    ['SVG hợp lệ khai là png', () => Buffer.from(SVG), 'png'],
    ['PNG khai là jpeg', () => fx.png({ w: 4, h: 4 }), 'jpeg'],
    ['JPEG khai là gif', () => fx.jpeg(), 'gif'],
  ] as const)('%s ⇒ 415 ở metadata().format, trước mọi biến đổi', async (_n, make, expected) => {
    const err = await pipeline.transform(make(), expected, AVATAR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedFileTypeError);
  });

  // Lớp thứ hai sau `sniffType` (tầng route đã 415 — sniff-fixtures.test.ts). Tệp mẫu tối giản làm chính
  // `metadata()` lỗi ⇒ không đọc được format ⇒ 422 IMAGE_UNREADABLE; điều bắt buộc: KHÔNG có đầu ra.
  it.each([
    ['tiff() khai là jpeg', () => fx.tiff(), 'jpeg'],
    ['svgScript() khai là png', () => fx.svgScript(), 'png'],
  ] as const)('%s ⇒ bị từ chối (415 hoặc 422), không biến thể nào', async (_n, make, expected) => {
    const err = await pipeline.transform(make(), expected, AVATAR).catch((e: unknown) => e);
    expect(
      err instanceof UnsupportedFileTypeError || ruleOf(err) === 'IMAGE_UNREADABLE',
      String(err),
    ).toBe(true);
  });

  it('trần pixel THEO MỤC ĐÍCH (T-068): min(maxPixels, trần chung)', async () => {
    const img = fx.png({ w: 20, h: 20 }); // 400 điểm
    const spec = [{ name: 't', size: 16, fit: 'cover' as const }];
    const err = await pipeline
      .transform(img, 'png', spec, { maxPixels: 100 })
      .catch((e: unknown) => e);
    expect(ruleOf(err)).toBe('IMAGE_TOO_COMPLEX');
    expect(await pipeline.transform(img, 'png', spec, { maxPixels: 1_000 })).toHaveLength(1);
    // maxPixels lớn hơn trần chung không nới trần chung
    const bomb = await pipeline
      .transform(fx.pixelBombPng(), 'png', spec, { maxPixels: 10e9 })
      .catch((e: unknown) => e);
    expect(ruleOf(bomb)).toBe('IMAGE_TOO_COMPLEX');
  });

  it('selfTest với sharp thật ⇒ true', async () => {
    expect(await pipeline.selfTest()).toBe(true);
  });
});
