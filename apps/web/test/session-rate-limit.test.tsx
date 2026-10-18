import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { seedBoard } from '@test/board-harness';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp, renderWithProviders } from '@test/render';

import { AuthGate } from '@/app/gates';
import { forgetActivationToken } from '@/features/account-activate';
import { ActivatePage } from '@/views/activate';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Lỗi #5 (D tìm trên localhost 18/10): tải lại trang khi hạn mức refresh theo IP đã hết (429) ⇒ trước đây hiện "Không
// kết nối được máy chủ — kiểm tra mạng". Kỳ vọng: "Bạn thao tác quá nhanh", đếm ngược theo retryAfterSec, tự thử lại.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
  window.history.replaceState(null, '', '/');
  forgetActivationToken();
});

const limitedOnce = (retryAfterSec: number) =>
  mock.server.use(
    http.post(
      `${API_BASE}/auth/refresh`,
      () =>
        HttpResponse.json(
          {
            success: false,
            error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec } },
            meta: { timestamp: new Date().toISOString(), requestId: crypto.randomUUID() },
          },
          { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
        ),
      { once: true },
    ),
  );

describe('khôi phục phiên bị 429 (lỗi #5)', () => {
  it('cổng: "Bạn thao tác quá nhanh" + đếm ngược (không phải "Không kết nối được"); hết giờ tự thử lại ⇒ vào trang; a11y', async () => {
    const f = seedBoard(mock);
    // Tải trang = khôi phục bằng refresh (không signIn sẵn): lần 1 bị 429, lần thử lại (hết giờ) thành công.
    const user = mock.db.getUser(f.owner.id)!;
    mock.server.use(
      http.post(
        `${API_BASE}/auth/refresh`,
        () =>
          HttpResponse.json({
            success: true,
            data: mock.db.issueAccess(user),
            meta: { timestamp: new Date().toISOString(), requestId: crypto.randomUUID() },
          }),
        { once: true },
      ),
    );
    limitedOnce(1);
    renderWithProviders(
      <AuthGate>
        <h1>Nội dung sau cổng</h1>
      </AuthGate>,
    );
    expect(await screen.findByText('Bạn thao tác quá nhanh')).toBeTruthy();
    expect(screen.getByText(/Tự thử lại sau 1 giây/)).toBeTruthy();
    expect(screen.queryByText('Không kết nối được máy chủ')).toBeNull();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toHaveProperty('disabled', true);
    await expectNoA11yViolations();
    await waitFor(
      () => expect(screen.getByRole('heading', { name: 'Nội dung sau cổng' })).toBeTruthy(),
      {
        timeout: 4_000,
      },
    );
  });

  it('/activate: 429 ⇒ đếm ngược + dặn ĐỪNG tải lại trang (token đã rời URL); hết giờ ⇒ mở form', async () => {
    const { user } = mock.db.createUser({
      email: 'nina@example.com',
      password: '',
      fullName: 'Nguyễn Thị Nina',
      workspace: false,
    });
    const { token } = mock.db.company.issueToken(user.id, mock.db.now(), 7 * 86_400_000);
    limitedOnce(1);
    window.history.replaceState(null, '', `/activate#t=${token}`);
    renderWithProviders(<ActivatePage />);
    expect(await screen.findByText('Bạn thao tác quá nhanh')).toBeTruthy();
    expect(screen.getByText(/Đừng tải lại trang/)).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Chào Nguyễn Thị Nina!' },
        { timeout: 4_000 },
      ),
    ).toBeTruthy();
  });
});
