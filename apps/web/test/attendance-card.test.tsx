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

// Mốc 3.5 (ADR-139): thẻ GỌN ở trang chính /w (bỏ khỏi trang dự án); Admin không phải nhân viên ⇒ không có thẻ.
function open(access: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE') {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp('/w', hub.client(getClientId(), f.owner.id));
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
    // 10:00 đã qua giờ vào ca 08:00 mà chưa chấm ⇒ "Chưa chấm công" (không phải "Chưa tới giờ" — demo TL d9).
    expect(within(card).getByText('Chưa chấm công')).toBeTruthy();
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

  it('Admin: không có thẻ Chấm công, không nút Vào/Ra (server vẫn 403); có "Việc quản lý"', async () => {
    open('ADMIN');
    expect(await screen.findByRole('heading', { name: 'Việc quản lý' })).toBeTruthy();
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
    const url = `${API_BASE}/attendance/me/today`;
    mock.server.use(...[1, 2, 3].map(() => http.get(url, boom, { once: true })));
    f.signInAs(f.owner);
    openApp('/w', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
    expect(
      await screen.findByText('Không tải được chấm công.', {}, { timeout: 10_000 }),
    ).toBeTruthy();
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('region', { name: 'Chấm công' })).toBeTruthy();
  });

  it('không layout-shift (demo TL d9): skeleton CÙNG khung min-h với thẻ; ô thông báo luôn có, chấm xong chỉ đổi CHỮ (cùng phần tử)', async () => {
    const f = seedBoard(mock);
    const url = `${API_BASE}/attendance/me/today`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.server.use(
      http.get(
        url,
        async () => {
          await gate;
          return undefined; // chuyển tiếp cho handler mock thật
        },
        { once: true },
      ),
    );
    f.signInAs(f.owner);
    openApp('/w', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
    const skeleton = await screen.findByRole('status', { name: 'Đang tải chấm công' });
    expect(skeleton.className).toContain('md:min-h-44');
    release();
    const card = await screen.findByRole('region', { name: 'Chấm công' });
    expect(card.className).toContain('md:min-h-44');
    const note = within(card).getByText('Bạn chưa chấm vào hôm nay.');
    expect(note.className).toContain('min-h-10');
    await userEvent
      .setup({ delay: null })
      .click(within(card).getByRole('button', { name: 'Chấm vào' }));
    await waitFor(() => expect(note.textContent).toBe('Đã chấm vào lúc 10:00.'));
    expect(note.isConnected).toBe(true);
  });
});
