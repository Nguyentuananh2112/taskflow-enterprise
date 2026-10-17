import type { SourceRect } from './crop';

// Đọc + vẽ ảnh trong trình duyệt (avatar-chat.md §7 E4/E5). Không có thư viện cropper: createImageBitmap xoay theo
// EXIF (ảnh điện thoại), canvas vẽ cùng `SourceRect` cho khung xem trước và ảnh xuất.

/** MIME cụ thể (không `image/*`, không `capture` — E5): HEIC iPhone được Safari tự đổi sang JPEG khi chọn. */
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';
const ACCEPTED = new Set(AVATAR_ACCEPT.split(','));
/**
 * Trần ẢNH GỐC trước khi giải mã (chặn giải mã ảnh quá lớn làm treo máy yếu). Ảnh gửi lên là bản đã cắt 512 px —
 * luôn nhỏ hơn trần 5 MB của server.
 */
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** Cạnh dài tối đa giữ trong bộ nhớ: đủ nét cho 512 px ở zoom 4. */
const DECODE_MAX_PX = 2048;
export const OUTPUT_PX = 512;
const JPEG_QUALITY = 0.85;

export type AvatarSource = Readonly<{ bitmap: ImageBitmap; width: number; height: number }>;

export class AvatarImageError extends Error {
  constructor(readonly reason: 'type' | 'size' | 'decode') {
    super(reason);
  }
}

/** Kiểm loại + cỡ rồi giải mã; ảnh lớn thu nhỏ còn cạnh dài 2048 (đỡ RAM trên điện thoại). */
export async function decodeAvatar(file: File): Promise<AvatarSource> {
  if (!ACCEPTED.has(file.type)) throw new AvatarImageError('type');
  if (file.size > SOURCE_MAX_BYTES) throw new AvatarImageError('size');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > DECODE_MAX_PX) {
      const ratio = DECODE_MAX_PX / longest;
      const resized = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        resizeWidth: Math.round(bitmap.width * ratio),
        resizeHeight: Math.round(bitmap.height * ratio),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = resized;
    }
  } catch {
    throw new AvatarImageError('decode');
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** Vẽ vùng `rect` của ảnh vào canvas vuông `px`, nền trắng (ảnh PNG trong suốt không thành nền đen ở JPEG). */
export function drawCrop(
  canvas: HTMLCanvasElement,
  src: AvatarSource,
  rect: SourceRect,
  px: number,
) {
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.bitmap, rect.sx, rect.sy, rect.size, rect.size, 0, 0, px, px);
}

/** Ảnh gửi lên: JPEG 512 px chất lượng 0.85, nền trắng. */
export function exportAvatar(src: AvatarSource, rect: SourceRect): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawCrop(canvas, src, rect, OUTPUT_PX);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AvatarImageError('decode'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
