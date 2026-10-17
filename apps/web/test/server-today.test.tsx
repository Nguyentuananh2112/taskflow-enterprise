import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// "Hôm nay" của web = giờ SERVER, không phải giờ máy (E2E neo giờ API bằng TEST_CLOCK_ANCHOR). Máy chạy
// test ở giờ thật; mock API neo ở thứ 2 10/03/2031 10:00 giờ Việt Nam — lệch xa mọi ngày chạy test.

const SERVER_NOW = Date.parse('2031-03-10T03:00:00.000Z');
let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => SERVER_NOW });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open(path: string) {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.signInAs(f.owner);
  openApp(`/w/${f.wsId}${path}`, hub.client(getClientId(), f.owner.id));
  return f;
}

describe('giờ máy lệch xa giờ server ⇒ UI theo server', () => {
  it('sanity: máy KHÔNG ở tháng 3/2031', () => {
    expect(new Date().toISOString().slice(0, 7)).not.toBe('2031-03');
  });

  it('/attendance: tháng mặc định 3/2031, hàng 10/03 được đánh dấu "hôm nay" (aria-current=date)', async () => {
    open('/attendance');
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 3/2031' });
    const current = table.querySelectorAll('tr[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(within(current[0] as HTMLElement).getByRole('rowheader').textContent).toMatch(
      /10\/03.*hôm nay/,
    );
  });

  it('/leave: ngày mặc định của form = hôm nay của server; năm số phép = 2031', async () => {
    open('/leave');
    const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    expect(within(form).getByLabelText<HTMLInputElement>(/^Từ ngày/).value).toBe('2031-03-10');
    expect(within(form).getByLabelText<HTMLInputElement>(/^Đến ngày/).value).toBe('2031-03-10');
    expect(await screen.findByRole('heading', { name: 'Phép năm 2031' })).toBeTruthy();
  });

  it('chuông: thông báo tạo "bây giờ" theo server ⇒ "phút này", không phải số ngày theo giờ máy', async () => {
    const f = open('/projects');
    mock.notifications.notify(f.owner.id, {
      type: 'LEAVE_APPROVED',
      refId: crypto.randomUUID(),
      workspaceId: f.wsId,
      workspaceName: 'Công ty Lan',
      actor: { id: crypto.randomUUID(), fullName: 'Hana HR' },
      leave: { type: 'ANNUAL', startDate: '2031-03-12', endDate: '2031-03-12' },
    });
    const u = userEvent.setup({ delay: null });
    await u.click(await screen.findByRole('button', { name: 'Thông báo, 1 chưa đọc' }));
    const panel = await screen.findByRole('dialog', { name: 'Thông báo' });
    const item = await within(panel).findByRole('link', { name: /^Chưa đọc:/ });
    expect(item.getAttribute('aria-label')).toMatch(/, phút này$/);
  });

  it('/hr: bảng công tháng 3/2031 + "Tháng sau" khóa; ngày lễ năm 2031; số phép năm 2031', async () => {
    open('/hr?tab=timesheet');
    expect(await screen.findByRole('heading', { name: 'Bảng công tháng 3/2031' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Tháng sau ›' }).disabled).toBe(
      true,
    );
    cleanupApp();

    open('/hr?tab=calendar');
    expect(await screen.findByRole('heading', { name: 'Ngày lễ năm 2031' })).toBeTruthy();
    cleanupApp();

    open('/hr?tab=balances');
    expect(await screen.findByRole('heading', { name: 'Số phép năm 2031' })).toBeTruthy();
  });
});

describe('việc không phải Mốc 3 cũng theo server', () => {
  it('hạn chót: "quá hạn" so với hôm nay của server (task hạn 09/03/2031 quá hạn, 10/03 thì chưa)', async () => {
    const { isOverdue } = await import('@/shared/lib/date-only');
    const { serverClock } = await import('@/shared/lib/server-clock');
    serverClock.observe(new Date(SERVER_NOW).toISOString());
    // Giờ máy thật (khác 2031) không còn quyết định kết quả.
    expect(isOverdue('2031-03-09')).toBe(true);
    expect(isOverdue('2031-03-10')).toBe(false);
  });
});
