import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';
import { suppressDailyOnceForTest } from '@/shared/lib/daily-once';
import { promptMemory } from '@/widgets/attendance-card';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-045: dialog nhắc chấm công khi vào trang dự án + hàng lối tắt dưới thẻ Chấm công. Giờ server do mock quyết định
// (thứ 5 2026-10-15, lịch mock 08:00–17:30 Asia/Ho_Chi_Minh) — không theo giờ máy chạy test.

const VN = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00+07:00`);
let now = VN('10:00');
let mock: ReturnType<typeof startMockApi>;

beforeAll(() => {
  mock = startMockApi({ now: () => now });
  suppressDailyOnceForTest(false);
});
afterAll(() => {
  suppressDailyOnceForTest(true);
  mock.stop();
});
beforeEach(() => {
  now = VN('10:00');
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanupApp();
  promptMemory.resetForTest();
});

function seed() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  const open = (user = f.owner) => {
    f.signInAs(user);
    openApp(`/w/${f.wsId}/projects`, hub.client(getClientId(), user.id));
  };
  return { f, open };
}

const prompt = () => screen.findByRole('dialog', { name: /^Chào buổi/ });

describe('dialog nhắc chấm công', () => {
  it('vào trang dự án lúc 10:00 chưa chấm ⇒ lời chào + ca làm; focus nút chính; a11y', async () => {
    const { f, open } = seed();
    open();
    const dialog = await prompt();
    const lastName = f.owner.fullName.trim().split(/\s+/).at(-1) ?? '';
    expect(within(dialog).getByRole('heading').textContent).toBe(`Chào buổi sáng, ${lastName}!`);
    expect(dialog.textContent).toContain('Hôm nay bạn chưa chấm công.');
    expect(dialog.textContent).toContain('Ca làm hôm nay: 08:00–17:30');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Chấm công vào' }),
      ),
    );
    await expectNoA11yViolations();
  });

  it('"Chấm công vào" ⇒ đóng, toast có giờ, thẻ "Đang làm"; vào lại trong ngày ⇒ không hiện', async () => {
    const { open } = seed();
    open();
    const u = userEvent.setup({ delay: null });
    await u.click(within(await prompt()).getByRole('button', { name: 'Chấm công vào' }));
    expect(await screen.findByText('Đã chấm vào lúc 10:00')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const card = screen.getByRole('region', { name: 'Chấm công' });
    await waitFor(() => expect(within(card).getByText(/Đang làm/)).toBeTruthy());
  });

  it('"Để sau" ⇒ đóng; tải lại trang (localStorage) ⇒ KHÔNG hiện lần 2 trong ngày; ngày mới ⇒ hiện lại', async () => {
    const { open } = seed();
    open();
    const u = userEvent.setup({ delay: null });
    await u.click(within(await prompt()).getByRole('button', { name: 'Để sau' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    cleanupApp();
    promptMemory.resetForTest(); // tab mới: chỉ còn localStorage
    open();
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(screen.queryByRole('dialog')).toBeNull();

    cleanupApp();
    now = Date.parse('2026-10-16T09:00:00+07:00'); // thứ 6, 09:00
    open();
    expect(await prompt()).toBeTruthy();
  });

  it('Esc = "Để sau"', async () => {
    const { open } = seed();
    open();
    await prompt();
    await userEvent.setup({ delay: null }).keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('region', { name: 'Chấm công' })).toBeTruthy();
  });

  it('storage bị chặn ⇒ vẫn chỉ hiện 1 lần trong phiên', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { open } = seed();
    open();
    await userEvent
      .setup({ delay: null })
      .click(within(await prompt()).getByRole('button', { name: 'Để sau' }));
    cleanupApp();
    open(); // cùng tab (bộ nhớ còn)
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('không hiện: đã chấm vào / sau giờ kết thúc ca (17:30) / VIEWER', async () => {
    const a = seed();
    mock.attendance.punch(
      a.f.wsId,
      { id: a.f.owner.id, fullName: a.f.owner.fullName },
      'IN',
      crypto.randomUUID(),
    );
    a.open();
    const card = await screen.findByRole('region', { name: 'Chấm công' });
    await within(card).findByRole('button', { name: 'Chấm ra' });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanupApp();

    now = VN('17:30');
    seed().open();
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanupApp();

    now = VN('10:00');
    const c = seed();
    c.open(c.f.addUser('Khách Vy', `vy-${crypto.randomUUID()}@example.com`, 'VIEWER'));
    expect(await screen.findByRole('heading', { name: /Dự án/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('lối tắt dưới thẻ Chấm công', () => {
  it('Bảng công · Xin nghỉ (còn N ngày) · Đơn nghỉ của tôi (N chờ duyệt) · Nhân sự (N đơn chờ, có hr:manage); a11y', async () => {
    const { f, open } = seed();
    const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    const leave = (start: string) => ({ type: 'ANNUAL', startDate: start, endDate: start });
    await f.apiAs(f.owner, 'POST', `/workspaces/${f.wsId}/leave-requests`, leave('2026-10-19'));
    await f.apiAs(mia, 'POST', `/workspaces/${f.wsId}/leave-requests`, leave('2026-10-20'));
    promptMemory.mark(f.owner.id, f.wsId, '2026-10-15'); // không cần dialog ở ca này
    open();
    const nav = await screen.findByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' });
    const link = (name: RegExp) => within(nav).findByRole('link', { name });
    expect((await link(/^Bảng công của tôi$/)).getAttribute('href')).toBe(
      `/w/${f.wsId}/attendance`,
    );
    expect((await link(/^Xin nghỉ · còn 12 ngày$/)).getAttribute('href')).toBe(
      `/w/${f.wsId}/leave`,
    );
    expect(await link(/^Đơn nghỉ của tôi · 1 chờ duyệt$/)).toBeTruthy();
    // OWNER có hr:manage: đơn chờ của cả công ty (của mình + của Mia).
    expect((await link(/^Nhân sự · 2 đơn chờ$/)).getAttribute('href')).toBe(
      `/w/${f.wsId}/hr?tab=leave`,
    );
    await expectNoA11yViolations();
  });

  it('MEMBER không có hr:manage ⇒ không có lối tắt Nhân sự; chưa có đơn ⇒ không ghi số', async () => {
    const { f, open } = seed();
    const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    promptMemory.mark(mia.id, f.wsId, '2026-10-15');
    open(mia);
    const nav = await screen.findByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' });
    expect(await within(nav).findByRole('link', { name: /^Xin nghỉ · còn/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Đơn nghỉ của tôi' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /Nhân sự/ })).toBeNull();
  });
});
