import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { COMPANY_SCOPE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { session } from '@/entities/session';
import { getClientId } from '@/shared/lib/client-id';
import { suppressDailyOnceForTest } from '@/shared/lib/daily-once';
import { localKeys } from '@/shared/lib/storage';
import { promptMemory } from '@/widgets/attendance-card';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-045: dialog nhắc chấm công + lối tắt — Mốc 3.5: ở TRANG CHÍNH /w (ADR-139), nhắc theo người; mỗi ca một mock mới
// (một công ty ⇒ đơn / lượt chấm của ca trước không lọt sang ca sau). Giờ server do mock quyết định
// (thứ 5 2026-10-15, lịch mock 08:00–17:30 Asia/Ho_Chi_Minh) — không theo giờ máy chạy test.

const VN = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00+07:00`);
let now = VN('10:00');
let mock: ReturnType<typeof startMockApi>;

beforeAll(() => suppressDailyOnceForTest(false));
afterAll(() => suppressDailyOnceForTest(true));
beforeEach(() => {
  now = VN('10:00');
  mock = startMockApi({ now: () => now });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanupApp();
  mock.stop();
  promptMemory.forgetAll(); // localStorage sống qua các test ⇒ mỗi test bắt đầu sạch
});

function seed() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  const open = (user = f.owner) => {
    f.signInAs(user);
    openApp('/w', hub.client(getClientId(), user.id));
  };
  return { f, open };
}

const prompt = () => screen.findByRole('dialog', { name: /^Chào buổi/ });

describe('dialog nhắc chấm công', () => {
  it('vào trang chính lúc 10:00 chưa chấm ⇒ lời chào + ca làm; focus nút chính; a11y', async () => {
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

  it('đăng xuất ⇒ xóa dấu "đã nhắc" khỏi máy (máy dùng chung — review B LOW-1); khóa không chứa UUID thô', async () => {
    const { f, open } = seed();
    open();
    await userEvent
      .setup({ delay: null })
      .click(within(await prompt()).getByRole('button', { name: 'Để sau' }));
    const keys = localKeys('tf.checkin-prompt.v1:');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(f.owner.id);
    expect(keys[0]).not.toContain(f.wsId);
    await act(() => session.logout());
    expect(localKeys('tf.checkin-prompt.v1:')).toEqual([]);
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

  it('không hiện: đã chấm vào / sau giờ kết thúc ca (17:30) / Admin (không phải nhân viên)', async () => {
    const a = seed();
    mock.attendance.punch(
      COMPANY_SCOPE,
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
    c.f.setCompanyAccess(c.f.owner, 'ADMIN');
    c.open();
    expect(await screen.findByRole('heading', { name: 'Việc quản lý' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('lối tắt và "Việc quản lý" ở trang chính', () => {
  it('nhân viên: Bảng công · Xin nghỉ (còn N ngày) · Đơn nghỉ của tôi (N chờ duyệt) — route công ty; không có "Việc quản lý"; a11y', async () => {
    const { f, open } = seed();
    const leave = (start: string) => ({ type: 'ANNUAL', startDate: start, endDate: start });
    await f.apiAs(f.owner, 'POST', '/leave/requests', leave('2026-10-19'));
    promptMemory.mark(f.owner.id, '2026-10-15'); // không cần dialog ở ca này
    open();
    const nav = await screen.findByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' });
    const link = (name: RegExp) => within(nav).findByRole('link', { name });
    expect((await link(/^Bảng công của tôi$/)).getAttribute('href')).toBe('/attendance');
    expect((await link(/^Xin nghỉ · còn 12 ngày$/)).getAttribute('href')).toBe('/leave');
    expect(await link(/^Đơn nghỉ của tôi · 1 chờ duyệt$/)).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /Nhân sự/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Việc quản lý' })).toBeNull();
    await expectNoA11yViolations();
  });

  it('HR: ô "Nhân sự" ghi số đơn chờ của cả công ty, mở thẳng tab Đơn nghỉ; Admin: ô "Quản trị", không lối tắt self', async () => {
    const { f, open } = seed();
    const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    const leave = (start: string) => ({ type: 'ANNUAL', startDate: start, endDate: start });
    await f.apiAs(f.owner, 'POST', '/leave/requests', leave('2026-10-19'));
    await f.apiAs(mia, 'POST', '/leave/requests', leave('2026-10-20'));
    f.setCompanyAccess(f.owner, 'HR');
    promptMemory.mark(f.owner.id, '2026-10-15');
    open();
    const tiles = await screen.findByRole('region', { name: 'Việc quản lý' });
    const hr = await within(tiles).findByRole('link', { name: /Nhân sự.*2 đơn nghỉ chờ duyệt/ });
    expect(hr.getAttribute('href')).toBe('/hr?tab=leave');
    expect(within(tiles).queryByRole('link', { name: /Quản trị/ })).toBeNull();
    cleanupApp();

    f.setCompanyAccess(f.owner, 'ADMIN');
    open();
    const admin = await screen.findByRole('region', { name: 'Việc quản lý' });
    expect(
      within(admin)
        .getByRole('link', { name: /Quản trị/ })
        .getAttribute('href'),
    ).toBe('/admin');
    expect(screen.queryByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' })).toBeNull();
  });
});
