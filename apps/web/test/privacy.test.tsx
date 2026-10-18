import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { testRouter } from '@test/navigation';
import { cleanupApp } from '@test/render';

import { privacyLater } from '@/features/privacy-ack';
import { getClientId } from '@/shared/lib/client-id';
import { suppressSessionOnceForTest } from '@/shared/lib/session-once';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-075: thông báo quyền riêng tư — trang /privacy, hộp thoại "lần đầu" (chỉ ở Chấm công / Nghỉ phép / Trò chuyện /
// Phiếu lương; "Để sau" / Esc ⇒ hiện lại phiên sau), đồng ý lý do nghỉ (form nghỉ khóa ô lý do), đầu mối liên hệ ở
// /admin/company. Mock theo contracts G (e01c5c85).

const PROMPT = 'Thông báo về xử lý dữ liệu cá nhân';

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => suppressSessionOnceForTest(false));
afterAll(() => suppressSessionOnceForTest(true));
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
  privacyLater.forgetAll();
});

function open(path: string, access: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return f;
}

describe('quyền riêng tư (T-075)', () => {
  it('/privacy: tên công ty, đủ mục, liên hệ mặc định; "Tôi đã đọc" + đồng ý lý do nghỉ lưu vào server; a11y', async () => {
    const f = open('/privacy');
    expect(await screen.findByRole('heading', { level: 1, name: 'Quyền riêng tư' })).toBeTruthy();
    expect(await screen.findByText(mock.db.company.name)).toBeTruthy();
    for (const name of ['Chấm công & Nghỉ phép', 'Trò chuyện & ảnh đại diện', 'Phiếu lương']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByText('quản trị viên của công ty')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull(); // trang đầy đủ ⇒ không hiện thêm hộp thoại
    await expectNoA11yViolations();

    const u = userEvent.setup({ delay: null });
    await u.click(screen.getByRole('button', { name: 'Tôi đã đọc' }));
    expect(await screen.findByText(/Bạn đã xác nhận đọc ngày/)).toBeTruthy();
    expect(mock.db.company.privacy.get(f.owner.id).ackVersion).toBe(1);

    await u.click(screen.getByRole('checkbox', { name: /Tôi đồng ý để công ty xử lý lý do nghỉ/ }));
    await waitFor(() => expect(mock.db.company.privacy.get(f.owner.id).consent).toBe(true));
    expect(screen.getByRole('checkbox', { name: /lý do nghỉ/ })).toHaveProperty('checked', true);
  });

  it('hộp thoại lần đầu ở /leave (không ở /w); Esc = để sau ⇒ không hiện lại trong phiên; phiên mới hiện lại; a11y', async () => {
    open('/w');
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull();
    act(() => testRouter.push('/leave'));
    const dialog = await screen.findByRole('dialog', { name: PROMPT });
    expect(within(dialog).getByRole('heading', { name: 'Phiếu lương' })).toBeTruthy();
    await expectNoA11yViolations();

    await userEvent.setup({ delay: null }).keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull());
    act(() => testRouter.push('/attendance'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull();

    act(() => privacyLater.forgetAll()); // phiên kết thúc
    act(() => testRouter.push('/leave'));
    expect(await screen.findByRole('dialog', { name: PROMPT })).toBeTruthy();
  });

  it('"Tôi đã đọc" trong hộp thoại; nội dung vừa đổi (409) ⇒ báo đọc lại, bấm lần nữa xong', async () => {
    const f = open('/attendance');
    const dialog = await screen.findByRole('dialog', { name: PROMPT });
    mock.db.company.privacy.version = 2; // nội dung đổi sau khi đã tải
    const u = userEvent.setup({ delay: null });
    await u.click(within(dialog).getByRole('button', { name: 'Tôi đã đọc' }));
    expect(await within(dialog).findByText(/Thông báo vừa được cập nhật/)).toBeTruthy();
    await u.click(within(dialog).getByRole('button', { name: 'Tôi đã đọc' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PROMPT })).toBeNull());
    expect(mock.db.company.privacy.get(f.owner.id).ackVersion).toBe(2);
  });

  it('form nghỉ phép: chưa đồng ý ⇒ ô lý do khóa + giải thích + link /privacy; đồng ý ⇒ mở', async () => {
    const f = open('/leave');
    await screen.findByRole('dialog', { name: PROMPT });
    await userEvent.setup({ delay: null }).keyboard('{Escape}');
    const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    const why = within(form).getByLabelText(/^Lý do/);
    await waitFor(() =>
      expect(within(form).getByText(/chưa đồng ý để công ty xử lý lý do nghỉ/)).toBeTruthy(),
    );
    expect(why).toHaveProperty('disabled', true);
    expect(
      within(form)
        .getByRole('link', { name: 'Đồng ý ở trang Quyền riêng tư' })
        .getAttribute('href'),
    ).toBe('/privacy');
    cleanupApp();

    mock.db.company.privacy.setConsent(f.owner.id, true);
    mock.db.company.privacy.ack(f.owner.id);
    f.signInAs(f.owner);
    openApp('/leave', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
    const again = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    await waitFor(() =>
      expect(within(again).getByLabelText(/^Lý do/)).toHaveProperty('disabled', false),
    );
    expect(within(again).queryByRole('link', { name: 'Đồng ý ở trang Quyền riêng tư' })).toBeNull();
  });

  it('/admin/company: đầu mối liên hệ ⇒ lưu ⇒ hiện trong /privacy; chân trang có link Quyền riêng tư', async () => {
    const f = open('/admin/company', 'ADMIN');
    const form = await screen.findByRole('form', { name: 'Đầu mối liên hệ dữ liệu cá nhân' });
    const u = userEvent.setup({ delay: null });
    await u.type(within(form).getByLabelText(/^Đầu mối liên hệ/), 'Chị Lan — lan@example.com');
    await u.click(within(form).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã lưu đầu mối liên hệ')).toBeTruthy();
    expect(mock.db.company.privacyContact).toBe('Chị Lan — lan@example.com');
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Quyền riêng tư' }).getAttribute('href')).toBe(
      '/privacy',
    );
    act(() => testRouter.push('/privacy'));
    expect(await screen.findByText('Chị Lan — lan@example.com')).toBeTruthy();
    expect(f.owner.id).toBeTruthy();
  });
});
