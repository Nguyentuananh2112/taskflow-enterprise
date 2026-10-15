import { act, configure, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { API_BASE, startMockApi } from '@test/mock-api';
import { testRouter } from '@test/navigation';
import { cleanupApp } from '@test/render';

import { AppShell, AuthGate, GuestGate } from '@/app/gates';
import { AppProviders } from '@/app/providers';
import { createOfflineRealtimeClient } from '@/shared/socket';
import { AccountPage } from '@/views/account';
import { LoginPage } from '@/views/login';
import { RegisterPage } from '@/views/register';
import { WorkspacePickerPage } from '@/views/workspace-picker';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Luồng tích hợp bắt buộc của T-019 trên mock API (MSW): đăng ký → dashboard → reload giữ phiên →
// đăng xuất. Ghép đúng các route của app/ (route group (auth) + (app)).

const ROUTES: Record<string, () => ReactNode> = {
  '/login': () => (
    <GuestGate>
      <LoginPage />
    </GuestGate>
  ),
  '/register': () => (
    <GuestGate>
      <RegisterPage />
    </GuestGate>
  ),
  '/w': () => (
    <AuthGate>
      <AppShell>
        <WorkspacePickerPage />
      </AppShell>
    </AuthGate>
  ),
  '/account': () => (
    <AuthGate>
      <AppShell>
        <AccountPage />
      </AppShell>
    </AuthGate>
  ),
};

// Luồng phiên không cần socket thật (realtime có test riêng với socket giả).
const offline = createOfflineRealtimeClient(crypto.randomUUID());
const offlineRealtime = () => offline;

function App() {
  const pathname = useSyncExternalStore(testRouter.subscribe, testRouter.pathname);
  const route = ROUTES[pathname] ?? (() => <p>404 {pathname}</p>);
  return (
    <AppProviders
      config={{ apiUrl: API_BASE, wsUrl: 'http://localhost:4000', appEnv: 'test' }}
      nonce={undefined}
      realtime={offlineRealtime}
    >
      {route()}
    </AppProviders>
  );
}

/** Mở URL như gõ vào thanh địa chỉ (tải trang mới). */
function openPage(url: string) {
  window.history.replaceState({}, '', url);
  return render(<App />);
}

/** Tải lại trang: mất mọi state JS (token trong bộ nhớ, cache), cookie + server giữ nguyên. */
function reload() {
  const url = window.location.pathname + window.location.search;
  cleanupApp();
  return openPage(url);
}

const BINH_PASSWORD = 'song-hong-mua-lu';
let mock: ReturnType<typeof startMockApi>;
let now = Date.now();
beforeAll(() => {
  mock = startMockApi({ accessTtlSec: 60, now: () => now });
  mock.db.createUser({ email: 'binh@example.com', password: BINH_PASSWORD, fullName: 'Lê Bình' });
});
afterAll(() => mock.stop());
afterEach(() => {
  cleanupApp();
  mock.jar.clear(); // mỗi test là một trình duyệt mới (cookie refresh không mang sang)
});
// Luồng dài, nhiều request: nới thời gian chờ khi cả repo chạy test song song trên máy yếu.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

describe('luồng xác thực trên mock API', () => {
  it('đăng ký → dashboard → reload giữ phiên → token hết hạn được làm mới trong suốt → đăng xuất', async () => {
    const user = userEvent.setup();

    // 1. Khách vào /w ⇒ bị chuyển về /login?next=/w, rồi đi tới /register.
    openPage('/w');
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(window.location.search).toBe('?next=%2Fw');
    expect(screen.getByRole('link', { name: 'Đăng ký' }).getAttribute('href')).toBe('/register');
    act(() => testRouter.push('/register'));

    // 2. Đăng ký ⇒ vào dashboard /w với workspace mặc định.
    await user.type(await screen.findByLabelText(/Họ tên/), 'Nguyễn Văn An');
    await user.type(screen.getByLabelText(/Email/), 'an.nguyen@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), 'cay-tre-xanh-ven-song');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Workspace của bạn' }),
    ).toBeDefined();
    expect(window.location.pathname).toBe('/w');
    expect(await screen.findByText('Workspace của Nguyễn Văn An')).toBeDefined();
    expect(screen.getByText('Chủ sở hữu')).toBeDefined();

    // 3. Reload ⇒ khôi phục phiên bằng cookie refresh, không phải đăng nhập lại.
    const { container } = reload();
    expect(await screen.findByText('Workspace của Nguyễn Văn An')).toBeDefined();
    expect(window.location.pathname).toBe('/w');
    await expectNoA11yViolations(container);

    // 4. Access token hết hạn ⇒ PATCH /auth/me nhận TOKEN_EXPIRED ⇒ refresh + gửi lại 1 lần,
    //    người dùng chỉ thấy kết quả (ADR-083 sửa họ tên).
    act(() => testRouter.push('/account'));
    const fullName = await screen.findByLabelText<HTMLInputElement>(/Họ tên/);
    expect(fullName.value).toBe('Nguyễn Văn An');
    now += 61_000;
    const rotate = vi.spyOn(mock.db, 'rotateRefresh');
    const verify = vi.spyOn(mock.db, 'verifyAccess');
    await user.clear(fullName);
    await user.type(fullName, 'Nguyễn Văn Ân');
    await user.click(screen.getByRole('button', { name: 'Lưu họ tên' }));
    expect(await screen.findByText('Đã lưu họ tên')).toBeDefined();
    expect(verify.mock.results.map((r) => (r.value as { status: string }).status)).toEqual([
      'expired',
      'ok',
    ]);
    expect(rotate).toHaveBeenCalledOnce();
    rotate.mockRestore();
    verify.mockRestore();
    expect(screen.getByRole('navigation', { name: 'Tài khoản' }).textContent).toContain(
      'Nguyễn Văn Ân',
    );

    // 5. Đăng xuất ⇒ về /login, cookie bị xóa, reload vẫn là khách.
    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(mock.jar.get('tf_rt')).toBeUndefined();
    reload();
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeDefined();
  });

  it('đăng xuất mọi thiết bị ⇒ cache của người dùng bị xóa, về /login', async () => {
    const user = userEvent.setup();
    openPage('/login?next=%2Faccount');
    await user.type(await screen.findByLabelText(/Email/), 'binh@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), BINH_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    // `?next=` an toàn ⇒ đúng trang người dùng định vào.
    expect(await screen.findByRole('heading', { level: 1, name: 'Tài khoản' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Đăng xuất mọi thiết bị' }));
    await user.click(await screen.findByRole('button', { name: 'Đăng xuất tất cả' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(screen.queryByText('Lê Bình')).toBeNull();
  });

  it('?next= trỏ ra ngoài (open redirect) ⇒ bị bỏ, vào /w', async () => {
    const user = userEvent.setup();
    openPage('/login?next=%2F%2Fevil.example');
    await user.type(await screen.findByLabelText(/Email/), 'binh@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), BINH_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Workspace của bạn' }),
    ).toBeDefined();
    expect(window.location.pathname).toBe('/w');
  });
});
