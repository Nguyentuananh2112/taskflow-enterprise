import { describe, expect, it } from 'vitest';

import {
  INITIAL_CROP,
  MAX_ZOOM,
  NUDGE_PX,
  clampCrop,
  cropForKey,
  moveCrop,
  sourceRect,
  zoomCrop,
} from './crop';

const VIEW = 256;
const LANDSCAPE = { width: 800, height: 400 }; // cạnh ngắn 400 ⇒ zoom 1: khung = 400×400 của ảnh
const SQUARE = { width: 1000, height: 1000 };

describe('crop — ảnh luôn phủ kín khung vuông', () => {
  it('zoom 1, giữa: vùng nguồn là hình vuông cạnh ngắn, căn giữa', () => {
    expect(sourceRect(LANDSCAPE, VIEW, INITIAL_CROP)).toEqual({ sx: 200, sy: 0, size: 400 });
    expect(sourceRect(SQUARE, VIEW, INITIAL_CROP)).toEqual({ sx: 0, sy: 0, size: 1000 });
  });

  it('zoom 2: vùng nguồn nhỏ một nửa, vẫn căn giữa', () => {
    const rect = sourceRect(SQUARE, VIEW, zoomCrop(SQUARE, VIEW, INITIAL_CROP, 2));
    expect(rect).toEqual({ sx: 250, sy: 250, size: 500 });
  });

  it('kéo quá mép ⇒ kẹp: không bao giờ lộ nền (vùng nguồn nằm trong ảnh)', () => {
    const far = moveCrop(LANDSCAPE, VIEW, INITIAL_CROP, 10_000, 10_000);
    const rect = sourceRect(LANDSCAPE, VIEW, far);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(0);
    const other = sourceRect(LANDSCAPE, VIEW, moveCrop(LANDSCAPE, VIEW, INITIAL_CROP, -10_000, 0));
    expect(other.sx + other.size).toBeCloseTo(LANDSCAPE.width);
  });

  it('ảnh vuông zoom 1 không dịch được (không có phần thừa)', () => {
    expect(moveCrop(SQUARE, VIEW, INITIAL_CROP, 30, -30)).toEqual(INITIAL_CROP);
  });

  it('zoom kẹp trong [1, 4]', () => {
    expect(clampCrop(SQUARE, VIEW, { zoom: 9, x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(clampCrop(SQUARE, VIEW, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
  });

  it('đổi zoom giữ điểm ở tâm khung (độ lệch nhân theo tỉ lệ zoom)', () => {
    const moved = moveCrop(SQUARE, VIEW, zoomCrop(SQUARE, VIEW, INITIAL_CROP, 2), 40, 0);
    const before = sourceRect(SQUARE, VIEW, moved);
    const centreBefore = before.sx + before.size / 2;
    const zoomed = sourceRect(SQUARE, VIEW, zoomCrop(SQUARE, VIEW, moved, 3));
    expect(zoomed.sx + zoomed.size / 2).toBeCloseTo(centreBefore);
  });

  it('thu nhỏ về 1 sau khi dịch ⇒ kẹp lại về giữa với ảnh vuông', () => {
    const moved = moveCrop(SQUARE, VIEW, zoomCrop(SQUARE, VIEW, INITIAL_CROP, 2), 40, 40);
    expect(zoomCrop(SQUARE, VIEW, moved, 1)).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('crop — phím (WCAG 2.5.7)', () => {
  const zoomed = zoomCrop(SQUARE, VIEW, INITIAL_CROP, 2);

  it('mũi tên dịch NUDGE_PX; Shift ×5; "←" đưa phần bên trái vào khung', () => {
    expect(cropForKey(SQUARE, VIEW, zoomed, 'ArrowLeft', false)).toEqual({
      ...zoomed,
      x: NUDGE_PX,
    });
    expect(cropForKey(SQUARE, VIEW, zoomed, 'ArrowUp', true)).toEqual({
      ...zoomed,
      y: NUDGE_PX * 5,
    });
    expect(cropForKey(SQUARE, VIEW, zoomed, 'ArrowRight', false)?.x).toBe(-NUDGE_PX);
    expect(cropForKey(SQUARE, VIEW, zoomed, 'ArrowDown', false)?.y).toBe(-NUDGE_PX);
    const left = sourceRect(SQUARE, VIEW, cropForKey(SQUARE, VIEW, zoomed, 'ArrowLeft', false)!);
    expect(left.sx).toBeLessThan(sourceRect(SQUARE, VIEW, zoomed).sx);
  });

  it('+ / = / - đổi zoom 0.1; phím khác ⇒ null', () => {
    expect(cropForKey(SQUARE, VIEW, zoomed, '+', false)?.zoom).toBeCloseTo(2.1);
    expect(cropForKey(SQUARE, VIEW, zoomed, '=', false)?.zoom).toBeCloseTo(2.1);
    expect(cropForKey(SQUARE, VIEW, zoomed, '-', false)?.zoom).toBeCloseTo(1.9);
    expect(cropForKey(SQUARE, VIEW, zoomed, 'Enter', false)).toBeNull();
  });
});
