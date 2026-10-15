// jsdom không có ResizeObserver; @dnd-kit/dom dùng nó khi có DOM (canUseDOM) ⇒ stub không làm gì.
// Kéo thả thật (layout, va chạm) được kiểm ở E2E Playwright (frontend.md §8.2), không ở jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
