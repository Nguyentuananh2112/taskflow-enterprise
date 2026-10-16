import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041a: thẻ Chấm công đầu trang danh sách dự án (attendance-leave.md §6, E2E-HR-01/04/05).
// Mock cố định: thứ 5 2026-10-15, 03:00Z = 10:00 giờ Việt Nam (ngày làm, sau giờ vào 08:00).

const FIXED = Date.parse('2026-10-15T03:00:00.000Z');
let mock: ReturnType<typeof startMockApi>;

beforeAll(() => {
  mock = startMockApi({ now: () => FIXED });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open(role: 'OWNER' | 'VIEWER' = 'OWNER') {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  const user =
    role === 'OWNER'
      ? f.owner
      : f.addUser('Khách Vy', `vy-${crypto.randomUUID()}@example.com`, 'VIEWER');
  f.signInAs(user);
  openApp(`/w/${f.wsId}/projects`, hub.client(getClientId(), user.id));
  return f;
}

describe('thẻ Chấm công', () => {
  it('giờ theo SERVER + múi giờ của lịch; nhắc khi chưa vào; Vào ⇒ "Đang làm", giờ vào 10:00, hết nhắc; a11y', async () => {
    open();
    const card = await screen.findByRole('region', { name: 'Chấm công' });
    // Tên cho đồng hồ là chữ sr-only bên trong (ARIA 1.2 không cho aria-label trên <p>).
    const clock = within(card).getByText('Giờ hiện tại theo máy chủ:', {
      exact: false,
    }).parentElement;
    expect(clock?.tagName).toBe('P');
    expect(clock?.hasAttribute('aria-label')).toBe(false);
    expect(clock?.textContent).toMatch(/^Giờ hiện tại theo máy chủ: 10:00:/);
    expect(within(card).getByText(/08:00–17:30/)).toBeTruthy();
    expect(within(card).getByText('Bạn chưa chấm vào hôm nay.')).toBeTruthy();
    expect(within(card).getByText('Chưa tới giờ')).toBeTruthy();
    await expectNoA11yViolations();

    await userEvent
      .setup({ delay: null })
      .click(within(card).getByRole('button', { name: 'Chấm vào' }));
    expect(await screen.findByText('Đã chấm vào')).toBeTruthy();
    await waitFor(() => expect(within(card).getByText(/Đang làm/)).toBeTruthy());
    expect(within(card).getByText(/· đi muộn/)).toBeTruthy();
    expect(within(card).getByText(/10:00 \/ —/)).toBeTruthy();
    expect(within(card).queryByText('Bạn chưa chấm vào hôm nay.')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Chấm ra' })).toBeTruthy();
  });

  it('VIEWER: không có thẻ Chấm công (server vẫn 403)', async () => {
    open('VIEWER');
    expect(await screen.findByRole('heading', { name: /Dự án/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Chấm công' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chấm vào' })).toBeNull();
  });

  it('me/today lỗi ⇒ thẻ báo "Không tải được chấm công" + Thử lại (không biến mất im lặng)', async () => {
    const boom = () =>
      HttpResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } },
        { status: 500 },
      );
    const f = seedBoard(mock);
    const url = `${API_BASE}/workspaces/${f.wsId}/attendance/me/today`;
    mock.server.use(...[1, 2, 3].map(() => http.get(url, boom, { once: true })));
    f.signInAs(f.owner);
    openApp(
      `/w/${f.wsId}/projects`,
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    expect(
      await screen.findByText('Không tải được chấm công.', {}, { timeout: 10_000 }),
    ).toBeTruthy();
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('region', { name: 'Chấm công' })).toBeTruthy();
  });
});
