import type { AuthTokenDto, UserDto } from '@taskflow/contracts/auth';

import { setAuthHooks, type AuthHooks } from '@/shared/api';

import { authApi, type AuthApi } from '../api/auth.api';
import { openAuthChannel, type AuthChannel, type AuthMessage } from './auth-channel';
import { createRefresher, type LockRequester } from './refresh';
import { sessionStore } from './session-store';
import { tokenStore } from './token-store';

// Vòng đời phiên phía client (frontend.md §3.3). Một instance cho mỗi tab (`session` bên dưới).

export type EndReason = 'logout' | 'expired' | 'revoked';

export const LOGOUT_RETRY_DELAY_MS = 500;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type SessionDeps = Readonly<{
  api: Pick<AuthApi, 'refresh' | 'me' | 'logout' | 'logoutAll'>;
  locks?: LockRequester | undefined;
  openChannel?: (onMessage: (message: AuthMessage) => void) => AuthChannel;
  installHooks?: (hooks: AuthHooks) => void;
  sleep?: (ms: number) => Promise<void>;
}>;

export function createSessionController(deps: SessionDeps) {
  const refresher = createRefresher({
    call: deps.api.refresh,
    locks: deps.locks,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  const endedListeners = new Set<(reason: EndReason) => void>();
  let channel: AuthChannel | null = null;
  /**
   * T-029 H2: đăng xuất ở server CHƯA được xác nhận (lỗi mạng/5xx/403) — cookie refresh có thể còn
   * sống. Trong lúc này không tự khôi phục phiên bằng refresh; UI báo và cho thử lại.
   */
  let logoutPending = false;
  const pendingListeners = new Set<() => void>();
  const setLogoutPending = (value: boolean) => {
    if (value === logoutPending) return;
    logoutPending = value;
    pendingListeners.forEach((listener) => listener());
  };
  /** POST /auth/logout, thử lại 1 lần nếu lỗi. `true` = server đã xác nhận. */
  async function serverLogout(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await deps.api.logout();
        setLogoutPending(false);
        return true;
      } catch {
        if (attempt === 0) await (deps.sleep ?? defaultSleep)(LOGOUT_RETRY_DELAY_MS);
      }
    }
    setLogoutPending(true);
    return false;
  }

  const set = (status: 'authenticated' | 'anonymous' | 'unreachable', user: UserDto | null) =>
    sessionStore.set({ status, user });

  /** Token mới hay chưa: `true` = đã có token, `false` = phiên không còn; ném lỗi = tạm thời. */
  async function renew(): Promise<boolean> {
    const token = await refresher.run();
    if (token) tokenStore.set(token);
    return token !== null;
  }

  function end(reason: EndReason, broadcast = true): void {
    const wasActive = sessionStore.get().status === 'authenticated' || tokenStore.get() !== null;
    tokenStore.clear();
    set('anonymous', null);
    if (!wasActive) return;
    endedListeners.forEach((listener) => listener(reason));
    if (broadcast) channel?.post({ type: 'logout' });
  }

  function onChannel(message: AuthMessage): void {
    if (message.type === 'logout') end('logout', false);
    else if (sessionStore.get().status === 'anonymous') {
      sessionStore.set({ status: 'idle', user: null });
      void controller.bootstrap();
    }
  }

  const controller = {
    /** Cắm hook vào `http` + mở kênh đa tab. Idempotent; chỉ có tác dụng ở trình duyệt. */
    start(): void {
      if (channel) return;
      (deps.installHooks ?? setAuthHooks)({
        getAccessToken: tokenStore.get,
        refresh: renew,
        onSessionEnded: (reason) => end(reason),
      });
      channel = (deps.openChannel ?? openAuthChannel)(onChannel);
    },

    /** Khôi phục phiên khi tải trang: refresh (cookie) → /auth/me. Chạy 1 lần (idle/unreachable). */
    async bootstrap(): Promise<void> {
      controller.start();
      const { status } = sessionStore.get();
      if (status !== 'idle' && status !== 'unreachable') return;
      if (logoutPending) {
        set('anonymous', null); // người dùng đã chọn đăng xuất — không đăng nhập lại im lặng
        return;
      }
      sessionStore.set({ status: 'bootstrapping', user: null });
      try {
        if (!(await renew())) {
          set('anonymous', null);
          return;
        }
        set('authenticated', (await deps.api.me()).user);
      } catch {
        set('unreachable', null); // mạng/5xx: màn "Không kết nối được" + Thử lại
      }
    },

    /** Sau login/register thành công. */
    signIn(token: AuthTokenDto, user: UserDto): void {
      controller.start();
      tokenStore.set(token);
      set('authenticated', user);
      channel?.post({ type: 'login' });
    },

    /** Đổi mật khẩu trả token mới cho thiết bị hiện tại. */
    replaceToken(token: AuthTokenDto): void {
      tokenStore.set(token);
    },

    /** Cập nhật hồ sơ (vd sửa họ tên) mà không đổi trạng thái phiên. */
    updateUser(user: UserDto): void {
      if (sessionStore.get().status === 'authenticated') set('authenticated', user);
    },

    /**
     * Đăng xuất thiết bị này: luôn kết thúc phiên LOCAL kể cả khi request lỗi (frontend.md §3.3),
     * nhưng KHÔNG nuốt lỗi (T-029 H2): trả `false` khi server chưa xác nhận để UI báo người dùng;
     * `retryLogout()` thử lại (cookie refresh HttpOnly vẫn được trình duyệt gửi).
     */
    async logout(): Promise<boolean> {
      const confirmed = await serverLogout();
      end('logout');
      return confirmed;
    },

    retryLogout: (): Promise<boolean> => serverLogout(),

    /** Đăng xuất ở server đang chờ xác nhận (UI: cảnh báo + "Thử lại"). */
    isLogoutPending: (): boolean => logoutPending,
    onLogoutPendingChange(listener: () => void): () => void {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },

    /** Đăng xuất mọi thiết bị: request lỗi ⇒ ném lỗi, phiên giữ nguyên để người dùng thử lại. */
    async logoutAll(): Promise<void> {
      await deps.api.logoutAll();
      end('logout');
    },

    /** `listener(reason)` khi phiên đang hoạt động bị kết thúc (dọn cache, toast…). */
    onEnded(listener: (reason: EndReason) => void): () => void {
      endedListeners.add(listener);
      return () => {
        endedListeners.delete(listener);
      };
    },

    /** Chỉ dùng trong test: mô phỏng tải lại trang (mất token trong bộ nhớ, đóng kênh). */
    resetForTest(): void {
      channel?.close();
      channel = null;
      endedListeners.clear();
      pendingListeners.clear();
      logoutPending = false;
      tokenStore.clear();
      sessionStore.resetForTest();
    },
  };
  return controller;
}

export type SessionController = ReturnType<typeof createSessionController>;

const browserLocks = (): LockRequester | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.locks;

/** Instance duy nhất của tab. */
export const session = createSessionController({ api: authApi, locks: browserLocks() });
