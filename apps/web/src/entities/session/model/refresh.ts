import type { AuthTokenDto } from '@taskflow/contracts/auth';

import { createSingleFlight, isApiError, type SingleFlight } from '@/shared/api';

// Refresh token phía client (security.md §1.4, frontend.md §3.3):
// 1. Single-flight trong tab: mọi lời gọi đồng thời dùng chung một promise.
// 2. Xuyên tab: Web Locks `tf-refresh` — hai tab không gửi cùng một cookie refresh cùng lúc.
//    Không có `navigator.locks` (không phải secure context) ⇒ chỉ single-flight trong tab.
// 3. `409 REFRESH_IN_PROGRESS` ⇒ đợi 300ms, thử lại ĐÚNG 1 lần.
// Kết quả: token mới, `null` = phiên không còn (đăng nhập lại), ném lỗi = tạm thời (mạng/5xx).

export type LockRequester = Pick<LockManager, 'request'>;

export type RefresherDeps = Readonly<{
  call: () => Promise<AuthTokenDto>;
  locks?: LockRequester | undefined;
  sleep?: (ms: number) => Promise<void>;
}>;

export const REFRESH_LOCK = 'tf-refresh';
export const REFRESH_RETRY_DELAY_MS = 300;

const sessionGone = (error: unknown) =>
  isApiError(error, 'REFRESH_TOKEN_INVALID') || isApiError(error, 'ORIGIN_NOT_ALLOWED');

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRefresher(deps: RefresherDeps): SingleFlight<AuthTokenDto | null> {
  const sleep = deps.sleep ?? defaultSleep;

  async function attempt(retried = false): Promise<AuthTokenDto | null> {
    try {
      return await deps.call();
    } catch (error) {
      if (sessionGone(error)) return null;
      if (!retried && isApiError(error, 'REFRESH_IN_PROGRESS')) {
        await sleep(REFRESH_RETRY_DELAY_MS); // tab khác vừa xoay — cookie mới đã nằm trong jar
        return attempt(true);
      }
      throw error;
    }
  }

  const locked = () => (deps.locks ? deps.locks.request(REFRESH_LOCK, () => attempt()) : attempt());
  return createSingleFlight(locked);
}
