import { afterEach, describe, expect, it, vi } from 'vitest';

import { HIDDEN_TAB_FALLBACK_MS, createFrameBatcher, nextFrame } from './frame-batcher';

// perf/board-500 P1: gom theo frame — đúng thứ tự, một lần xả mỗi frame, tab ẩn vẫn xả.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lịch tay: `tick()` = frame kế tiếp tới. */
function manualSchedule() {
  const pending: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      pending.push(run);
      return () => void pending.splice(pending.indexOf(run), 1);
    },
    tick: () => pending.splice(0).forEach((run) => run()),
    pendingCount: () => pending.length,
  };
}

describe('createFrameBatcher', () => {
  it('nhiều item trong 1 frame ⇒ MỘT lần xả, đúng thứ tự đến; chỉ hẹn 1 frame', () => {
    const frames = manualSchedule();
    const flushed: number[][] = [];
    const batcher = createFrameBatcher<number>(
      (items) => flushed.push([...items]),
      frames.schedule,
    );
    for (let i = 0; i < 499; i++) batcher.push(i);
    expect(frames.pendingCount()).toBe(1);
    expect(flushed).toEqual([]);
    frames.tick();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(Array.from({ length: 499 }, (_, i) => i));
  });

  it('item đến sau khi xả ⇒ frame mới, không lẫn lô cũ', () => {
    const frames = manualSchedule();
    const flushed: string[][] = [];
    const batcher = createFrameBatcher<string>(
      (items) => flushed.push([...items]),
      frames.schedule,
    );
    batcher.push('a');
    frames.tick();
    batcher.push('b');
    batcher.push('c');
    frames.tick();
    expect(flushed).toEqual([['a'], ['b', 'c']]);
  });

  it('flush() xả ngay phần đang chờ và hủy frame đã hẹn; rỗng ⇒ không gọi', () => {
    const frames = manualSchedule();
    const onFlush = vi.fn();
    const batcher = createFrameBatcher<number>(onFlush, frames.schedule);
    batcher.flush();
    expect(onFlush).not.toHaveBeenCalled();
    batcher.push(1);
    batcher.flush();
    expect(onFlush).toHaveBeenCalledWith([1]);
    expect(frames.pendingCount()).toBe(0);
    frames.tick();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

describe('nextFrame', () => {
  it('tab hiện: rAF chạy trước ⇒ xả ở frame, timeout dự phòng bị hủy', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const run = vi.fn();
    nextFrame(run);
    frame?.(0);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HIDDEN_TAB_FALLBACK_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tab ẩn: rAF không bao giờ chạy ⇒ vẫn xả sau timeout dự phòng, rồi hủy rAF', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const cancelRaf = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelRaf);
    const run = vi.fn();
    nextFrame(run);
    vi.advanceTimersByTime(HIDDEN_TAB_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancelRaf).toHaveBeenCalledWith(1);
  });

  it('hủy trước khi tới ⇒ không chạy', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const run = vi.fn();
    const cancel = nextFrame(run);
    cancel();
    vi.advanceTimersByTime(HIDDEN_TAB_FALLBACK_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
});
