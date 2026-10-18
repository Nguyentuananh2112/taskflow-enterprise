import type { UserDto } from '@taskflow/contracts/auth';

/**
 * - `idle`: chưa thử khôi phục phiên (vừa tải trang).
 * - `bootstrapping`: đang gọi /auth/refresh + /auth/me.
 * - `unreachable`: lỗi mạng/5xx khi khôi phục — KHÔNG đẩy về /login (frontend.md §3.3).
 * - `rate_limited`: server từ chối vì gửi quá nhiều (429) — phiên vẫn còn; `retryAt` = lúc được thử lại (lỗi #5).
 */
export type SessionStatus =
  'idle' | 'bootstrapping' | 'authenticated' | 'anonymous' | 'unreachable' | 'rate_limited';

export type SessionState = Readonly<{
  status: SessionStatus;
  user: UserDto | null;
  /** Chỉ khi `rate_limited`: mốc `Date.now()` được thử khôi phục lại. */
  retryAt?: number;
}>;

const INITIAL: SessionState = { status: 'idle', user: null };

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();

export const sessionStore = {
  get: (): SessionState => state,
  set: (next: SessionState): void => {
    if (
      next.status === state.status &&
      next.user === state.user &&
      next.retryAt === state.retryAt
    ) {
      return;
    }
    state = next;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Chỉ dùng trong test (mô phỏng tải lại trang). */
  resetForTest: (): void => {
    state = INITIAL;
    listeners.forEach((listener) => listener());
  },
};
