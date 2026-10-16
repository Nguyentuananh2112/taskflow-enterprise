import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
  type DragDropManagerInput,
} from '@dnd-kit/dom';

// Kéo bằng CẢ THẺ (yêu cầu người dùng, feat/card-drag-whole) — @dnd-kit/dom 0.5.0:
// - Chuột/bút: phải dời ≥ CARD_DRAG_DISTANCE_PX mới thành kéo ⇒ bấm-thả tại chỗ vẫn là click (mở drawer).
//   Không dùng ràng buộc thời gian (mặc định 200 ms) ⇒ giữ chuột lâu rồi thả vẫn là click.
// - Cảm ứng: giữ yên TOUCH_HOLD_MS (lệch ≤ TOUCH_TOLERANCE_PX) mới kéo ⇒ vuốt vẫn cuộn board/cột.
// - Tay cầm ⠿ (`source.handle`) vẫn là activator BÀN PHÍM + nơi plugin Accessibility gắn tabindex /
//   aria-roledescription ⇒ tab order và trình đọc màn hình không đổi; chuột trên ⠿ kéo ngay như cũ.
// - Vùng đánh dấu `data-no-drag` (menu "⋯") và ô nhập liệu KHÔNG khởi động kéo.

export const CARD_DRAG_DISTANCE_PX = 6;
export const TOUCH_HOLD_MS = 250;
export const TOUCH_TOLERANCE_PX = 5;
export const NO_DRAG_ATTR = 'data-no-drag';

type Source = Readonly<{ element?: Element | undefined; handle?: Element | undefined }>;

const isElement = (target: EventTarget | null): target is Element => target instanceof Element;

export function cardActivationConstraints(event: PointerEvent, source: Source) {
  if (event.pointerType === 'touch') {
    return [
      new PointerActivationConstraints.Delay({
        value: TOUCH_HOLD_MS,
        tolerance: TOUCH_TOLERANCE_PX,
      }),
    ];
  }
  const { target } = event;
  if (isElement(target) && source.handle?.contains(target)) return undefined; // ⠿: kéo ngay
  return [new PointerActivationConstraints.Distance({ value: CARD_DRAG_DISTANCE_PX })];
}

export function preventCardActivation(event: PointerEvent, source: Source): boolean {
  const { target } = event;
  if (!isElement(target)) return false;
  const blocker = target.closest(`[${NO_DRAG_ATTR}]`);
  if (blocker && source.element?.contains(blocker)) return true;
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** Hằng module (tham chiếu ổn định) cho `DragDropProvider sensors`. */
export const BOARD_SENSORS: NonNullable<DragDropManagerInput['sensors']> = [
  PointerSensor.configure({
    // Pointer nghe trên CẢ THẺ (element), không chỉ tay cầm. Thẻ chưa đăng ký ref (VIEWER) ⇒ không có.
    activatorElements: (source) => [source.element],
    activationConstraints: cardActivationConstraints,
    preventActivation: preventCardActivation,
  }),
  KeyboardSensor,
];
