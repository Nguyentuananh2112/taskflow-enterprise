import { QueryClient } from '@tanstack/react-query';
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
import { AttendancePage } from '@/views/attendance';
import { LoginPage } from '@/views/login';
import { WorkspacePickerPage } from '@/views/workspace-picker';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Luồng tích hợp bắt buộc của T-019 trên mock API (MSW): đăng nhập → trang chính → reload giữ phiên →
// đăng xuất. Mốc 3.5 (ADR-137): không còn tự đăng ký — tài khoản có sẵn (HR tạo + kích hoạt — xem activate-page). Ghép đúng các route của app/ (route group (auth) + (app)).

const ROUTES: Record<string, () => ReactNode> = {
  '/login': () => (
    <GuestGate>
      <LoginPage />
    </GuestGate>
  ),
  '/w': () => (
    <AuthGate>
      <AppShell>
        <WorkspacePickerPage />
      </AppShell>
    </AuthGate>
  ),
  '/attendance': () => (
    <AuthGate>
      <AppShell>
        <AttendancePage />
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
const AN_PASSWORD = 'cay-tre-xanh-ven-song';
let mock: ReturnType<typeof startMockApi>;
let now = Date.now();
beforeAll(() => {
  mock = startMockApi({ accessTtlSec: 60, now: () => now });
  mock.db.createUser({ email: 'binh@example.com', password: BINH_PASSWORD, fullName: 'Lê Bình' });
  mock.db.createUser({
    email: 'an.nguyen@example.com',
    password: AN_PASSWORD,
    fullName: 'Nguyễn Văn An',
  });
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
  it('đăng nhập → trang chính → reload giữ phiên → token hết hạn được làm mới trong suốt → đăng xuất', async () => {
    const user = userEvent.setup({ delay: null });

    // 1. Khách vào /w ⇒ bị chuyển về /login?next=/w; không có lối "Đăng ký" (ADR-137).
    openPage('/w');
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(window.location.search).toBe('?next=%2Fw');
    expect(screen.queryByRole('link', { name: 'Đăng ký' })).toBeNull();

    // 2. Đăng nhập ⇒ vào trang chính /w với workspace của mình.
    await user.type(await screen.findByLabelText(/Email/), 'an.nguyen@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), AN_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trang chính' })).toBeDefined();
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
    const user = userEvent.setup({ delay: null });
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

  it('SEC-HR-67: đang đăng nhập mà bị cho nghỉ việc ⇒ request kế tiếp 401 SESSION_REVOKED ⇒ về /login, xóa cache (gồm nhánh company), KHÔNG gọi refresh', async () => {
    const user = userEvent.setup({ delay: null });
    const { user: cuong } = mock.db.createUser({
      email: 'cuong@example.com',
      password: BINH_PASSWORD,
      fullName: 'Trịnh Cường',
    });
    openPage('/login?next=%2Fw');
    await user.type(await screen.findByLabelText(/Email/), 'cuong@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), BINH_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trang chính' })).toBeDefined();

    // Nghỉ việc hoàn tất (ADR-137) — access token trong bộ nhớ CÒN hạn nhưng không còn thuộc công ty.
    act(() => mock.db.company.remove(cuong.id));
    const rotate = vi.spyOn(mock.db, 'rotateRefresh');
    const clear = vi.spyOn(QueryClient.prototype, 'clear');
    act(() => testRouter.push('/attendance'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(window.location.pathname).toBe('/login');
    expect(await screen.findByText('Phiên đăng nhập đã hết')).toBeDefined();
    expect(clear).toHaveBeenCalled(); // SessionEffects: queryClient.clear() ⇒ mọi nhánh ['company', …] mất
    expect(rotate, 'SESSION_REVOKED không được vào vòng refresh').not.toHaveBeenCalled();
    rotate.mockRestore();
    clear.mockRestore();
  });

  it('SEC-HR-67 (thu hồi phiên khi nghỉ việc): access cũ ⇒ 401 UNAUTHORIZED ⇒ /login không refresh; access hết hạn ⇒ refresh 401 REFRESH_TOKEN_INVALID đúng MỘT lần ⇒ /login, không lặp', async () => {
    const user = userEvent.setup({ delay: null });
    const signIn = async (email: string) => {
      openPage('/login?next=%2Fw');
      await user.type(await screen.findByLabelText(/Email/), email);
      await user.type(screen.getByLabelText(/Mật khẩu/), BINH_PASSWORD);
      await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Trang chính' })).toBeDefined();
    };

    // (a) Hoàn tất nghỉ việc tăng token_version + thu hồi refresh (ADR-105) ⇒ access trong bộ nhớ thành UNAUTHORIZED.
    const { user: dung } = mock.db.createUser({
      email: 'dung@example.com',
      password: BINH_PASSWORD,
      fullName: 'Phạm Dũng',
    });
    await signIn('dung@example.com');
    act(() => mock.db.revokeAllSessions(dung.id, 'LOGOUT_ALL'));
    const rotateA = vi.spyOn(mock.db, 'rotateRefresh');
    act(() => testRouter.push('/attendance'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(rotateA, 'UNAUTHORIZED không vào vòng refresh').not.toHaveBeenCalled();
    rotateA.mockRestore();
    cleanupApp();
    mock.jar.clear();

    // (b) Access HẾT HẠN đúng lúc refresh đã bị thu hồi ⇒ thử refresh MỘT lần ⇒ REFRESH_TOKEN_INVALID ⇒ /login.
    mock.db.createUser({
      email: 'em@example.com',
      password: BINH_PASSWORD,
      fullName: 'Lý Em',
    });
    await signIn('em@example.com');
    // Chỉ refresh token bị thu hồi (job hoàn tất nghỉ việc chạy giữa hai lần access còn hạn) — access cũ vẫn khớp
    // token_version cho tới khi hết hạn ⇒ web đi đường TOKEN_EXPIRED → refresh.
    act(() => mock.db.revokeRefresh(mock.jar.get('tf_rt')));
    now += 61_000; // access TTL 60 s
    const rotateB = vi.spyOn(mock.db, 'rotateRefresh');
    act(() => testRouter.push('/attendance'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(rotateB.mock.results.map((r) => (r.value as { status: string }).status)).toEqual([
      'invalid',
    ]);
    rotateB.mockRestore();
  });

  it('?next= trỏ ra ngoài (open redirect) ⇒ bị bỏ, vào /w', async () => {
    const user = userEvent.setup({ delay: null });
    openPage('/login?next=%2F%2Fevil.example');
    await user.type(await screen.findByLabelText(/Email/), 'binh@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), BINH_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trang chính' })).toBeDefined();
    expect(window.location.pathname).toBe('/w');
  });
});
