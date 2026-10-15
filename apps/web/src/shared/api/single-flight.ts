/**
 * Gộp các lời gọi đồng thời thành MỘT lần chạy: ai gọi trong lúc đang chạy nhận cùng promise.
 * Dùng cho refresh token (security.md §1.4, frontend.md §3.3). Xuyên tab (Web Locks) là việc
 * của hook auth ở Phase 4 — lớp này chỉ lo trong một tab.
 */
export type SingleFlight<T> = {
  run(): Promise<T>;
  /** Promise đang chạy, hoặc null — để request mới xếp hàng chờ refresh xong. */
  inflight(): Promise<T> | null;
};

export function createSingleFlight<T>(fn: () => Promise<T>): SingleFlight<T> {
  let current: Promise<T> | null = null;
  return {
    run() {
      current ??= fn().finally(() => {
        current = null;
      });
      return current;
    },
    inflight: () => current,
  };
}
