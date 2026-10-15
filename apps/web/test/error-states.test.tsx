import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// E3 — trạng thái lỗi theo frontend.md §1.2: lỗi tải (mạng/5xx) ⇒ khối lỗi + "Thử lại", không treo
// skeleton mãi. 5xx được QueryClient retry 2 lần ⇒ server trả lỗi 3 lần liền rồi mới hồi phục.

let mock: ReturnType<typeof startMockApi>;

beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

const fail3 = (path: string) => {
  const url = `${API_BASE}${path}`;
  const boom = () =>
    HttpResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } },
      { status: 500 },
    );
  mock.server.use(
    http.get(url, boom, { once: true }),
    http.get(url, boom, { once: true }),
    http.get(url, boom, { once: true }),
  );
};

describe('trạng thái lỗi tải (E3)', () => {
  it('Tài khoản: /auth/me lỗi ⇒ "Không tải được hồ sơ" + Thử lại ⇒ hiện form hồ sơ', async () => {
    const f = seedBoard(mock);
    f.signInAs(f.owner);
    fail3('/auth/me');
    openApp('/account', new FakeRealtimeHub(mock.board).client(getClientId()));
    expect(await screen.findByText('Không tải được hồ sơ', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Đang tải hồ sơ' })).toBeNull();
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByLabelText(/^Họ tên/)).toBeTruthy();
  });

  it('Cài đặt dự án: lỗi 5xx ⇒ "Không tải được dự án" + Thử lại ⇒ hiện form', async () => {
    const f = seedBoard(mock);
    f.signInAs(f.owner);
    fail3(`/workspaces/${f.wsId}/projects/${f.project.id}`);
    openApp(
      `/w/${f.wsId}/p/${f.project.id}/settings`,
      new FakeRealtimeHub(mock.board).client(getClientId()),
    );
    expect(await screen.findByText('Không tải được dự án', {}, { timeout: 10_000 })).toBeTruthy();
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByLabelText(/^Tên dự án/)).toBeTruthy();
    expect(screen.queryByText('Không tải được dự án')).toBeNull();
  });
});
