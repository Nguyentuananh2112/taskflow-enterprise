import { PointerActivationConstraints } from '@dnd-kit/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_DRAG_DISTANCE_PX,
  TOUCH_HOLD_MS,
  cardActivationConstraints,
  preventCardActivation,
} from './card-drag-sensors';

// feat/card-drag-whole: kéo bằng cả thẻ. Kiểm cấu hình sensor + ngưỡng thật của dnd-kit (constraint
// thật, controller giả): bấm tại chỗ ⇒ KHÔNG kéo (click mở drawer), dời ≥ 6 px ⇒ kéo.

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Thẻ giống SortableTaskCard: article > (⠿ handle, tiêu đề, menu "⋯" trong data-no-drag). */
function card() {
  document.body.innerHTML = `
    <article id="card">
      <button id="handle"><span id="dots">⠿</span></button>
      <button id="title">Tiêu đề</button>
      <span data-no-drag=""><button id="menu">⋯</button></span>
      <span id="body">Trung bình</span>
    </article>
    <span data-no-drag=""><button id="outside">x</button></span>`;
  const $ = (id: string) => document.getElementById(id)!;
  return { $, source: { element: $('card'), handle: $('handle') } };
}

const pointer = (type: string, target: Element, init: Partial<PointerEventInit> = {}) => {
  const event = new MouseEvent(type, { clientX: 100, clientY: 100, ...init }) as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

/** Controller giả tối thiểu: constraint đọc `signal` (nghe abort) và gọi `activate` / `abort`. */
function fakeController(activate = vi.fn(), abort = vi.fn()) {
  const ac = new AbortController();
  return {
    signal: ac.signal,
    activate,
    abort: (event?: Event) => {
      abort(event);
      ac.abort();
    },
  };
}

/** Cho constraint chạy qua chuỗi sự kiện; trả true nếu nó kích hoạt kéo. */
function activates(
  constraints: ReturnType<typeof cardActivationConstraints>,
  events: PointerEvent[],
) {
  const activate = vi.fn();
  const fake = fakeController(activate);
  for (const c of constraints ?? []) (c as unknown as { controller: unknown }).controller = fake;
  for (const event of events) for (const c of constraints ?? []) c.onEvent(event);
  return activate.mock.calls.length > 0;
}

describe('cardActivationConstraints', () => {
  it('chuột trên thân thẻ: bấm-thả tại chỗ KHÔNG kéo; dời < 6 px không kéo; dời ≥ 6 px thì kéo', () => {
    const { $, source } = card();
    const down = pointer('pointerdown', $('title'));
    const c = () => cardActivationConstraints(down, source);
    expect(c()).toHaveLength(1);
    expect(c()?.[0]).toBeInstanceOf(PointerActivationConstraints.Distance);
    expect(activates(c(), [down, pointer('pointerup', $('title'))])).toBe(false);
    expect(
      activates(c(), [
        down,
        pointer('pointermove', $('title'), { clientX: 100 + CARD_DRAG_DISTANCE_PX - 2 }),
      ]),
    ).toBe(false);
    expect(
      activates(c(), [
        down,
        pointer('pointermove', $('title'), { clientX: 100 + CARD_DRAG_DISTANCE_PX + 1 }),
      ]),
    ).toBe(true);
  });

  it('chuột trên tay cầm ⠿ (kể cả phần tử con) ⇒ không ràng buộc (kéo ngay như cũ)', () => {
    const { $, source } = card();
    expect(cardActivationConstraints(pointer('pointerdown', $('dots')), source)).toBeUndefined();
  });

  it('bút như chuột (theo khoảng cách)', () => {
    const { $, source } = card();
    const c = cardActivationConstraints(
      pointer('pointerdown', $('body'), { pointerType: 'pen' }),
      source,
    );
    expect(c?.[0]).toBeInstanceOf(PointerActivationConstraints.Distance);
  });

  it('cảm ứng: giữ yên 250 ms mới kéo; vuốt (lệch > 5 px trước 250 ms) ⇒ không kéo (để cuộn)', () => {
    vi.useFakeTimers();
    const { $, source } = card();
    const down = pointer('pointerdown', $('body'), { pointerType: 'touch' });
    const hold = cardActivationConstraints(down, source);
    expect(hold?.[0]).toBeInstanceOf(PointerActivationConstraints.Delay);
    const activate = vi.fn();
    for (const c of hold ?? [])
      (c as unknown as { controller: unknown }).controller = fakeController(activate);
    for (const c of hold ?? []) c.onEvent(down);
    vi.advanceTimersByTime(TOUCH_HOLD_MS - 1);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalled();

    const swipe = cardActivationConstraints(down, source);
    const activate2 = vi.fn();
    const abort2 = vi.fn();
    for (const c of swipe ?? [])
      (c as unknown as { controller: unknown }).controller = fakeController(activate2, abort2);
    for (const c of swipe ?? []) {
      c.onEvent(down);
      c.onEvent(pointer('pointermove', $('body'), { pointerType: 'touch', clientY: 130 }));
    }
    vi.advanceTimersByTime(TOUCH_HOLD_MS * 2);
    expect(activate2).not.toHaveBeenCalled();
  });
});

describe('preventCardActivation', () => {
  it('nút "⋯" (trong data-no-drag của thẻ) KHÔNG khởi động kéo', () => {
    const { $, source } = card();
    expect(preventCardActivation(pointer('pointerdown', $('menu')), source)).toBe(true);
  });

  it('tiêu đề, thân thẻ, tay cầm ⇒ được kéo (khác mặc định dnd-kit vốn chặn mọi nút)', () => {
    const { $, source } = card();
    for (const id of ['title', 'body', 'handle', 'dots', 'card']) {
      expect(preventCardActivation(pointer('pointerdown', $(id)), source)).toBe(false);
    }
  });

  it('data-no-drag NGOÀI thẻ không ảnh hưởng; ô nhập liệu thì chặn', () => {
    const { $, source } = card();
    expect(preventCardActivation(pointer('pointerdown', $('outside')), source)).toBe(false);
    const input = document.createElement('input');
    $('card').append(input);
    expect(preventCardActivation(pointer('pointerdown', input), source)).toBe(true);
  });
});
