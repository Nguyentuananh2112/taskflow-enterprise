import type { AuthTokenDto } from '@taskflow/contracts/auth';

import { createSingleFlight, isApiError, type SingleFlight } from '@/shared/api';

// Refresh token phía client (security.md §1.4, frontend.md §3.3):
// 1. Single-flight trong tab: mọi lời gọi đồng thời dùng chung một promise.
// 2. Xuyên tab: Web Locks `tf-refresh` — hai tab không gửi cùng một cookie refresh cùng lúc.
//    Không có `navigator.locks` (không phải secure context) ⇒ chỉ single-flight trong tab.
// 3. `409 REFRESH_IN_PROGRESS` (tab / request khác đang xoay) ⇒ đợi 300–800 ms có jitter rồi thử lại, tối đa 3 lần —
//    mở nhiều tab / máy thức dậy không còn rơi vào "Không kết nối được" oan (TL 18/10).
// Kết quả: token mới, `null` = phiên không còn (đăng nhập lại), ném lỗi = tạm thời (mạng/5xx).

export type LockRequester = Pick<LockManager, 'request'>;

export type RefresherDeps = Readonly<{
  call: () => Promise<AuthTokenDto>;
  locks?: LockRequester | undefined;
  sleep?: (ms: number) => Promise<void>;
  /** Nguồn ngẫu nhiên cho jitter (test truyền hàm cố định). */
  random?: () => number;
}>;

export const REFRESH_LOCK = 'tf-refresh';
export const REFRESH_RETRY_DELAY_MS = 300;
/** Jitter thêm vào mỗi lần chờ: 300 + [0, 500) ms ⇒ các tab không thử lại cùng nhịp. */
export const REFRESH_RETRY_JITTER_MS = 500;
export const REFRESH_MAX_RETRIES = 3;

const sessionGone = (error: unknown) =>
  isApiError(error, 'REFRESH_TOKEN_INVALID') || isApiError(error, 'ORIGIN_NOT_ALLOWED');

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRefresher(deps: RefresherDeps): SingleFlight<AuthTokenDto | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  async function attempt(retries = 0): Promise<AuthTokenDto | null> {
    try {
      return await deps.call();
    } catch (error) {
      if (sessionGone(error)) return null;
      if (retries < REFRESH_MAX_RETRIES && isApiError(error, 'REFRESH_IN_PROGRESS')) {
        // Tab khác vừa xoay — cookie mới sẽ nằm trong jar khi nó xong.
        await sleep(REFRESH_RETRY_DELAY_MS + Math.floor(random() * REFRESH_RETRY_JITTER_MS));
        return attempt(retries + 1);
      }
      throw error;
    }
  }

  const locked = () => (deps.locks ? deps.locks.request(REFRESH_LOCK, () => attempt()) : attempt());
  return createSingleFlight(locked);
}
