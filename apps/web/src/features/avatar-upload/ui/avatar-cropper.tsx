'use client';

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  cropForKey,
  moveCrop,
  sourceRect,
  zoomCrop,
  type Crop,
} from '../model/crop';
import { drawCrop, type AvatarSource } from '../model/image';

/** Cạnh khung xem trước (CSS px) — vừa màn 360 trong dialog. */
export const VIEW_PX = 256;

type Props = Readonly<{
  source: AvatarSource;
  crop: Crop;
  onCropChange: (crop: Crop) => void;
}>;

/**
 * Khung cắt vuông tự viết (avatar-chat.md §7 E4): kéo bằng Pointer Events (chuột + cảm ứng), phím mũi tên dịch / `+` `-`
 * phóng to và slider "Thu phóng" — không bắt buộc kéo (WCAG 2.5.7). Vẽ bằng canvas cùng hàm với ảnh xuất ⇒ thấy gì lưu
 * nấy; không dùng thuộc tính `style` (CSP W-CSP-2).
 */
export function AvatarCropper({ source, crop, onCropChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    drawCrop(canvas, source, sourceRect(source, VIEW_PX, crop), Math.round(VIEW_PX * ratio));
  }, [source, crop]);

  /** px trên màn ⇒ px của khung (khung có thể bị co trên màn hẹp). */
  const toView = (canvas: HTMLCanvasElement) => {
    const width = canvas.getBoundingClientRect().width;
    return width > 0 ? VIEW_PX / width : 1;
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const last = drag.current;
    if (last?.id !== e.pointerId) return;
    const k = toView(e.currentTarget);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    onCropChange(
      moveCrop(source, VIEW_PX, crop, (e.clientX - last.x) * k, (e.clientY - last.y) * k),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const next = cropForKey(source, VIEW_PX, crop, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault(); // mũi tên không cuộn dialog
    onCropChange(next);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Vùng cắt ảnh"
        aria-describedby="avatar-crop-help"
        tabIndex={0}
        width={VIEW_PX}
        height={VIEW_PX}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="size-64 max-w-full cursor-grab touch-none rounded-full bg-bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:cursor-grabbing"
      />
      <p id="avatar-crop-help" className="text-center text-xs text-text-muted">
        Kéo ảnh, hoặc chọn khung rồi dùng phím mũi tên để chỉnh vị trí.
      </p>
      <label className="flex w-full items-center gap-3 text-sm">
        <span className="shrink-0">Thu phóng</span>
        <input
          type="range"
          aria-label="Thu phóng"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
          onChange={(e) => onCropChange(zoomCrop(source, VIEW_PX, crop, Number(e.target.value)))}
          className="w-full accent-primary"
        />
      </label>
    </div>
  );
}
