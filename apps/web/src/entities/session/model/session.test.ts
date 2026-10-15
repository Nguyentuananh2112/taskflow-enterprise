import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type AuthHooks } from '@/shared/api';

import type { AuthChannel, AuthMessage } from './auth-channel';
import { createSessionController, type SessionDeps } from './session';
import { sessionStore } from './session-store';
import { tokenStore } from './token-store';

const USER = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  email: 'lan@example.com',
  fullName: 'Trần Lan',
  createdAt: '2026-10-15T03:00:00.000Z',
};
const TOKEN = { accessToken: 'at-secret-1', expiresIn: 900 };
const invalid = () => new ApiError({ status: 401, code: 'REFRESH_TOKEN_INVALID', message: '' });
const offline = () => new ApiError({ status: 0, code: 'NETWORK_ERROR', message: '' });

function setup(api: Partial<SessionDeps['api']> = {}) {
  let hooks!: AuthHooks;
  let deliver!: (message: AuthMessage) => void;
  const posted: AuthMessage[] = [];
  const channel: AuthChannel = { post: (m) => posted.push(m), close: () => undefined };
  const deps = {
    refresh: vi.fn(() => Promise.resolve(TOKEN)),
    me: vi.fn(() => Promise.resolve({ user: USER, memberships: [] })),
    logout: vi.fn(() => Promise.resolve(undefined)),
    logoutAll: vi.fn(() => Promise.resolve(undefined)),
    ...api,
  };
  const controller = createSessionController({
    api: deps,
    installHooks: (h) => (hooks = h),
    sleep: () => Promise.resolve(),
    openChannel: (onMessage) => {
      deliver = onMessage;
      return channel;
    },
  });
  const ended = vi.fn();
  controller.start();
  controller.onEnded(ended);
  current = controller;
  return {
    controller,
    api: deps,
    hooks,
    posted,
    ended,
    fromOtherTab: (m: AuthMessage) => deliver(m),
  };
}

let current: ReturnType<typeof createSessionController> | undefined;
afterEach(() => current?.resetForTest());

describe('bootstrap (tải trang)', () => {
  it('refresh OK ⇒ lấy /auth/me ⇒ authenticated, token chỉ trong tokenStore', async () => {
    const { controller, hooks } = setup();
    await controller.bootstrap();
    expect(sessionStore.get()).toEqual({ status: 'authenticated', user: USER });
    expect(hooks.getAccessToken()).toBe(TOKEN.accessToken);
    // W-TOKEN-1: state React-facing không chứa token.
    expect(JSON.stringify(sessionStore.get())).not.toContain(TOKEN.accessToken);
  });

  it('REFRESH_TOKEN_INVALID ⇒ anonymous, không gọi /auth/me', async () => {
    const { controller, api } = setup({ refresh: () => Promise.reject(invalid()) });
    await controller.bootstrap();
    expect(sessionStore.get().status).toBe('anonymous');
    expect(api.me).not.toHaveBeenCalled();
  });

  it('lỗi mạng ⇒ unreachable (KHÔNG đẩy về login); thử lại thành công ⇒ authenticated', async () => {
    const refresh = vi
      .fn<() => Promise<typeof TOKEN>>()
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(TOKEN);
    const { controller } = setup({ refresh });
    await controller.bootstrap();
    expect(sessionStore.get().status).toBe('unreachable');
    await controller.bootstrap();
    expect(sessionStore.get().status).toBe('authenticated');
  });

  it('gọi 2 lần (AuthGate + GuestGate, StrictMode) ⇒ chỉ khôi phục một lần', async () => {
    const { controller, api } = setup();
    await Promise.all([controller.bootstrap(), controller.bootstrap()]);
    expect(api.refresh).toHaveBeenCalledOnce();
  });
});

describe('đăng nhập / kết thúc phiên', () => {
  it('signIn ⇒ authenticated + báo tab khác "login"', () => {
    const { controller, posted } = setup();
    controller.signIn(TOKEN, USER);
    expect(sessionStore.get().status).toBe('authenticated');
    expect(posted).toEqual([{ type: 'login' }]);
  });

  it('http báo hết phiên ⇒ xóa token, anonymous, listener nhận lý do, báo tab khác', () => {
    const { controller, hooks, posted, ended } = setup();
    controller.signIn(TOKEN, USER);
    hooks.onSessionEnded('revoked');
    expect(hooks.getAccessToken()).toBeNull();
    expect(sessionStore.get()).toEqual({ status: 'anonymous', user: null });
    expect(ended).toHaveBeenCalledWith('revoked');
    expect(posted).toContainEqual({ type: 'logout' });
  });

  it('hook refresh của http: thành công ⇒ true + thay token; mất phiên ⇒ false', async () => {
    const refresh = vi
      .fn<() => Promise<typeof TOKEN>>()
      .mockResolvedValueOnce({ accessToken: 'at-2', expiresIn: 900 })
      .mockRejectedValueOnce(invalid());
    const { hooks } = setup({ refresh });
    await expect(hooks.refresh()).resolves.toBe(true);
    expect(tokenStore.get()).toBe('at-2');
    await expect(hooks.refresh()).resolves.toBe(false);
  });

  it.each([
    ['đăng xuất ở tab này', 'self'],
    ['tin "logout" từ tab khác', 'other-tab'],
  ] as const)(
    'refresh đang bay khi phiên kết thúc (%s) ⇒ KHÔNG đặt lại token (G1 W1, W-TOKEN-1)',
    async (_label, via) => {
      let release!: (token: typeof TOKEN) => void;
      const refresh = vi.fn(() => new Promise<typeof TOKEN>((resolve) => (release = resolve)));
      const { controller, hooks, fromOtherTab } = setup({ refresh });
      controller.signIn(TOKEN, USER);
      const renewing = hooks.refresh();
      await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
      if (via === 'self') await controller.logout();
      else fromOtherTab({ type: 'logout' });
      release({ accessToken: 'at-late', expiresIn: 900 });
      await expect(renewing).resolves.toBe(false);
      expect(tokenStore.get()).toBeNull();
      expect(sessionStore.get().status).toBe('anonymous');
    },
  );

  it('logout OK ⇒ true, không có gì chờ xác nhận', async () => {
    const { controller } = setup();
    controller.signIn(TOKEN, USER);
    await expect(controller.logout()).resolves.toBe(true);
    expect(controller.isLogoutPending()).toBe(false);
  });

  it('logout lỗi (T-029 H2): thử lại 1 lần, vẫn kết thúc phiên LOCAL nhưng trả false + pending', async () => {
    const logout = vi.fn(() => Promise.reject(offline()));
    const { controller, ended } = setup({ logout });
    controller.signIn(TOKEN, USER);
    await expect(controller.logout()).resolves.toBe(false);
    expect(logout).toHaveBeenCalledTimes(2);
    expect(sessionStore.get().status).toBe('anonymous');
    expect(ended).toHaveBeenCalledWith('logout');
    expect(controller.isLogoutPending()).toBe(true);
  });

  it('đang chờ xác nhận đăng xuất ⇒ bootstrap KHÔNG tự đăng nhập lại bằng cookie', async () => {
    const refresh = vi.fn(() => Promise.resolve(TOKEN));
    const { controller } = setup({ refresh, logout: () => Promise.reject(offline()) });
    controller.signIn(TOKEN, USER);
    await controller.logout();
    refresh.mockClear();
    sessionStore.set({ status: 'idle', user: null }); // tải lại trang /login trong cùng phiên JS
    await controller.bootstrap();
    expect(refresh).not.toHaveBeenCalled();
    expect(sessionStore.get().status).toBe('anonymous');
  });

  it('retryLogout thành công ⇒ hết pending', async () => {
    const logout = vi
      .fn<() => Promise<undefined>>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(undefined);
    const { controller } = setup({ logout });
    controller.signIn(TOKEN, USER);
    await controller.logout();
    const changed = vi.fn();
    controller.onLogoutPendingChange(changed);
    await expect(controller.retryLogout()).resolves.toBe(true);
    expect(controller.isLogoutPending()).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it('logoutAll lỗi ⇒ ném lỗi, phiên GIỮ NGUYÊN để thử lại', async () => {
    const { controller } = setup({ logoutAll: () => Promise.reject(offline()) });
    controller.signIn(TOKEN, USER);
    await expect(controller.logoutAll()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(sessionStore.get().status).toBe('authenticated');
  });
});

describe('đồng bộ đa tab', () => {
  it('tab khác logout ⇒ tab này kết thúc phiên ngay, không phát lại (không vòng lặp)', () => {
    const { controller, posted, ended, fromOtherTab } = setup();
    controller.signIn(TOKEN, USER);
    posted.length = 0;
    fromOtherTab({ type: 'logout' });
    expect(sessionStore.get().status).toBe('anonymous');
    expect(tokenStore.get()).toBeNull();
    expect(ended).toHaveBeenCalledWith('logout');
    expect(posted).toEqual([]);
  });

  it('tab khác login khi tab này là khách ⇒ tự khôi phục phiên', async () => {
    const refresh = vi
      .fn<() => Promise<typeof TOKEN>>()
      .mockRejectedValueOnce(invalid())
      .mockResolvedValueOnce(TOKEN);
    const { controller, fromOtherTab } = setup({ refresh });
    await controller.bootstrap();
    expect(sessionStore.get().status).toBe('anonymous');
    fromOtherTab({ type: 'login' });
    await vi.waitFor(() => expect(sessionStore.get().status).toBe('authenticated'));
  });
});
