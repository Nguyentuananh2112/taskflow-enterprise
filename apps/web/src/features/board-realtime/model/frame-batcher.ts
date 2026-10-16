/** Hẹn chạy `run` một lần; trả hàm hủy. */
export type Schedule = (run: () => void) => () => void;

/** Tab ẩn: trình duyệt dừng rAF ⇒ timeout đảm bảo hàng đợi vẫn được xả (bị throttle, không kẹt). */
export const HIDDEN_TAB_FALLBACK_MS = 100;

/**
 * Frame kế tiếp (rAF) HOẶC sau {@link HIDDEN_TAB_FALLBACK_MS} — cái nào tới trước. Tab đang hiện:
 * rAF ≤ 1 frame; tab ẩn (rAF đứng): timeout. Môi trường không có rAF ⇒ chỉ timeout.
 */
export const nextFrame: Schedule = (run) => {
  let done = false;
  let raf: number | undefined;
  const fire = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (raf !== undefined) cancelAnimationFrame(raf);
    run();
  };
  const timer = setTimeout(fire, HIDDEN_TAB_FALLBACK_MS);
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(fire);
  return () => {
    done = true;
    clearTimeout(timer);
    if (raf !== undefined) cancelAnimationFrame(raf);
  };
};

export type FrameBatcher<T> = Readonly<{
  push: (item: T) => void;
  /** Xả ngay phần còn chờ (vd trước khi gỡ hook: không bỏ event — cache board không tự refetch). */
  flush: () => void;
}>;

/**
 * Gom item theo frame, xả MỘT lần theo đúng thứ tự đến (perf/board-500 P1): burst N event socket ⇒ 1
 * lần cập nhật cache + 1 commit React thay vì N.
 */
export function createFrameBatcher<T>(
  onFlush: (items: readonly T[]) => void,
  schedule: Schedule = nextFrame,
): FrameBatcher<T> {
  let queue: T[] = [];
  let cancel: (() => void) | null = null;
  const flush = () => {
    cancel?.();
    cancel = null;
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    onFlush(items);
  };
  return {
    push: (item) => {
      queue.push(item);
      cancel ??= schedule(flush);
    },
    flush,
  };
}
