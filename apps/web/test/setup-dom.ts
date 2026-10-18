import { suppressDailyOnceForTest } from '@/shared/lib/daily-once';
import { suppressSessionOnceForTest } from '@/shared/lib/session-once';

// jsdom không có ResizeObserver; @dnd-kit/dom dùng nó khi có DOM (canUseDOM) ⇒ stub không làm gì.
// Kéo thả thật (layout, va chạm) được kiểm ở E2E Playwright (frontend.md §8.2), không ở jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// Dialog nhắc chấm công (T-045) là modal: tắt mặc định cho mọi bộ test; test/check-in-prompt.test.tsx bật lại.
suppressDailyOnceForTest(true);

// Thông báo quyền riêng tư "lần đầu" (T-075) cũng là modal: tắt mặc định; test/privacy.test.tsx bật lại.
suppressSessionOnceForTest(true);
