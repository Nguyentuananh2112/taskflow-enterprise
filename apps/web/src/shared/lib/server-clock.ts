// Giờ của SERVER cho mọi "bây giờ / hôm nay" trên web (attendance-leave.md §5: không tin giờ máy). Mỗi
// response có envelope mang `meta.timestamp` ⇒ http ghi lại độ lệch; E2E có thể neo giờ API
// (TEST_CLOCK_ANCHOR) mà UI vẫn khớp. Chưa có response nào ⇒ lệch 0 (giờ máy).

let offsetMs = 0;

export const serverClock = {
  /** Ghi nhận giờ server `iso` nhận được lúc `receivedAtMs` (giờ máy). Chuỗi hỏng ⇒ bỏ qua. */
  observe(iso: string, receivedAtMs: number = Date.now()): void {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) offsetMs = t - receivedAtMs;
  },
  /** Bây giờ theo server (ms). */
  now: (): number => Date.now() + offsetMs,
  resetForTest(): void {
    offsetMs = 0;
  },
};
