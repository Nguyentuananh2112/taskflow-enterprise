/**
 * Mã của worker sharp (ADR-141, B HIGH-2) — chạy bằng `new Worker(source, { eval: true })` để giống nhau ở
 * tsx, Vitest và bản build (không phụ thuộc đường dẫn tệp worker). sharp nạp theo đường dẫn TUYỆT ĐỐI do
 * luồng chính `require.resolve` truyền qua `workerData`.
 *
 * Cấu hình bắt buộc (B): `cache(false)`, `concurrency(1)`; mọi `sharp(...)` dùng cùng options
 * `{ pages: 1, animated: false, limitInputPixels, failOn: 'error' }` ⇒ GIF nhiều khung chỉ giải mã khung đầu;
 * `metadata()` TRƯỚC mọi biến đổi: `format` phải ∈ danh sách cho phép VÀ = loại đã sniff, `width × height` ≤
 * trần; rồi `.rotate()` theo EXIF ⇒ resize ⇒ WebP q82 mới, KHÔNG `withMetadata` (bỏ EXIF/GPS/XMP/ICC).
 *
 * Giao thức: vào `{ id, kind: 'transform', input, expected, variants }` | `{ id, kind: 'selfTest' }`;
 * ra `{ id, ok: true, variants }` | `{ id, ok: false, error: 'FORMAT_MISMATCH' | 'TOO_COMPLEX' | 'UNREADABLE' }`.
 * Thông điệp lỗi libvips KHÔNG gửi ra ngoài (không lộ chi tiết nội bộ — B).
 */
export const IMAGE_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const sharp = require(workerData.sharpPath);
sharp.cache(false);
sharp.concurrency(1);
const ALLOWED = new Set(workerData.allowedFormats);
const LIMIT = workerData.limitInputPixels;
const OPTIONS = { pages: 1, animated: false, limitInputPixels: LIMIT, failOn: 'error' };

async function transform(input, expected, variants) {
  const meta = await sharp(input, OPTIONS).metadata();
  if (!ALLOWED.has(meta.format) || meta.format !== expected) return { ok: false, error: 'FORMAT_MISMATCH' };
  if (!meta.width || !meta.height || meta.width * meta.height > LIMIT) return { ok: false, error: 'TOO_COMPLEX' };
  const out = [];
  for (const v of variants) {
    const resize = v.fit === 'cover'
      ? { width: v.size, height: v.size, fit: 'cover' }
      : { width: v.size, height: v.size, fit: 'inside', withoutEnlargement: true };
    const { data, info } = await sharp(input, OPTIONS)
      .rotate()
      .resize(resize)
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out.push({ name: v.name, data, width: info.width, height: info.height });
  }
  return { ok: true, variants: out };
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.kind === 'selfTest') {
      const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const res = await transform(png, 'png', [{ name: 't', size: 1, fit: 'cover' }]);
      parentPort.postMessage({ id: msg.id, ok: res.ok, variants: [] });
      return;
    }
    const res = await transform(Buffer.from(msg.input), msg.expected, msg.variants);
    if (!res.ok) return parentPort.postMessage({ id: msg.id, ok: false, error: res.error });
    // Không transfer: buffer của sharp là bộ nhớ ngoài V8, không detach được ⇒ structured clone (sao chép).
    parentPort.postMessage({ id: msg.id, ok: true, variants: res.variants });
  } catch (err) {
    const text = String((err && err.message) || '');
    const error = /pixel limit|exceeds|too large/i.test(text) ? 'TOO_COMPLEX' : 'UNREADABLE';
    parentPort.postMessage({ id: msg.id, ok: false, error });
  }
});
parentPort.postMessage({ ready: true });
`;
