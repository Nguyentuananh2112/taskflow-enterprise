// Toán cắt ảnh vuông (avatar-chat.md §7 E4): hàm thuần, dùng chung cho khung xem trước và ảnh xuất ⇒ thấy gì lưu nấy.
// Ảnh luôn PHỦ kín khung vuông (không viền trống); `x`/`y` = độ lệch tâm ảnh so với tâm khung, đơn vị px của khung.

export type ImageSize = Readonly<{ width: number; height: number }>;
export type Crop = Readonly<{ zoom: number; x: number; y: number }>;
export type SourceRect = Readonly<{ sx: number; sy: number; size: number }>;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;
/** Một lần nhấn phím mũi tên dịch ảnh bao nhiêu px của khung (Shift ⇒ ×5). */
export const NUDGE_PX = 4;
export const INITIAL_CROP: Crop = { zoom: MIN_ZOOM, x: 0, y: 0 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Tỉ lệ để cạnh NGẮN của ảnh vừa khít khung ở zoom 1. */
const coverScale = (img: ImageSize, view: number) => view / Math.min(img.width, img.height);

/** Giữ zoom trong [1, 4] và ảnh phủ kín khung (không kéo lộ nền). */
export function clampCrop(img: ImageSize, view: number, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = coverScale(img, view) * zoom;
  const maxX = (img.width * scale - view) / 2;
  const maxY = (img.height * scale - view) / 2;
  // `+ 0` đổi -0 thành 0 (ảnh không còn chỗ dịch ⇒ độ lệch đúng bằng 0).
  return { zoom, x: clamp(crop.x, -maxX, maxX) + 0, y: clamp(crop.y, -maxY, maxY) + 0 };
}

/** Dịch ảnh (kéo chuột / phím mũi tên) rồi kẹp lại. */
export function moveCrop(img: ImageSize, view: number, crop: Crop, dx: number, dy: number): Crop {
  return clampCrop(img, view, { ...crop, x: crop.x + dx, y: crop.y + dy });
}

/** Đổi zoom, giữ điểm ảnh ở TÂM khung đứng yên. */
export function zoomCrop(img: ImageSize, view: number, crop: Crop, zoom: number): Crop {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / crop.zoom;
  return clampCrop(img, view, { zoom: next, x: crop.x * ratio, y: crop.y * ratio });
}

/** Vùng vuông trên ẢNH GỐC (px ảnh) đang hiện trong khung — dùng cho `drawImage(img, sx, sy, size, size, …)`. */
export function sourceRect(img: ImageSize, view: number, crop: Crop): SourceRect {
  const c = clampCrop(img, view, crop);
  const scale = coverScale(img, view) * c.zoom;
  const left = view / 2 + c.x - (img.width * scale) / 2;
  const top = view / 2 + c.y - (img.height * scale) / 2;
  return { sx: -left / scale + 0, sy: -top / scale + 0, size: view / scale };
}

/** Phím trên khung cắt (WCAG 2.5.7 — thay cho kéo): mũi tên dịch, +/- zoom. Phím khác ⇒ `null`. */
export function cropForKey(
  img: ImageSize,
  view: number,
  crop: Crop,
  key: string,
  shift: boolean,
): Crop | null {
  const step = NUDGE_PX * (shift ? 5 : 1);
  // Mũi tên = hướng nhìn: "←" đưa phần bên trái ảnh vào khung ⇒ ảnh trượt sang phải.
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const move = moves[key];
  if (move) return moveCrop(img, view, crop, move[0], move[1]);
  if (key === '+' || key === '=') return zoomCrop(img, view, crop, crop.zoom + ZOOM_STEP);
  if (key === '-') return zoomCrop(img, view, crop, crop.zoom - ZOOM_STEP);
  return null;
}
