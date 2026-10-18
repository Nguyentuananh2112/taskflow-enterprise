import { crc32, deflateSync } from 'node:zlib';

// Ảnh mẫu SINH LÚC CHẠY (test-spec-chat §6 harness: không commit nhị phân). PNG RGB thật — trình duyệt giải mã được
// (createImageBitmap của cropper), server mã hóa lại bằng sharp.

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG `width × height`, nửa trái màu `left`, nửa phải `right` (để thấy ảnh dịch khi cắt). */
export function makePng(
  width: number,
  height: number,
  left: [number, number, number] = [29, 78, 216],
  right: [number, number, number] = [234, 179, 8],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(x < width / 2 ? left : right, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
