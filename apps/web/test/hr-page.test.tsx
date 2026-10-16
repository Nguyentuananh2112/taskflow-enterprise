import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041c: /w/:ws/hr (attendance-leave.md §6, §9). Hôm nay theo server: thứ 5 2026-10-15, 10:00 giờ
// Việt Nam. Mock: lịch T2–T7 08:00–17:30, grace 0.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

const user = () => userEvent.setup({ delay: null });

function seed() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  const an = f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const open = (url: string, as: { id: string } = f.owner) => {
    const who = mock.db.getUser(as.id);
    if (!who) throw new Error('user?');
    f.signInAs(who);
    const tab = hub.client(getClientId(), as.id);
    openApp(url, tab);
    return tab;
  };
  const submitLeave = (by: typeof an, body: Record<string, unknown>) =>
    f.apiAs(by, 'POST', `/workspaces/${f.wsId}/leave-requests`, body);
  const grantHr = (to: { id: string }) =>
    f.apiAs(f.owner, 'PUT', `/workspaces/${f.wsId}/members/${to.id}/grants`, {
      grants: ['HR_MANAGE'],
    });
  return { f, an, open, submitLeave, grantHr };
}

describe('trang Nhân sự — quyền', () => {
  it('thành viên thường: không có lối vào, /hr báo không có quyền; được cấp ⇒ lối vào hiện ngay (realtime)', async () => {
    const { f, an, open, grantHr } = seed();
    open(`/w/${f.wsId}/projects`, an);
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(screen.queryByRole('link', { name: 'Nhân sự' })).toBeNull();
    await act(() => grantHr(an));
    const link = await screen.findByRole('link', { name: 'Nhân sự' });
    expect(link.getAttribute('href')).toBe(`/w/${f.wsId}/hr`);
    cleanupApp();

    const vy = f.addUser('Khách Vy', `vy-${crypto.randomUUID()}@example.com`, 'VIEWER');
    open(`/w/${f.wsId}/hr`, vy);
    expect(await screen.findByText('Bạn không có quyền Quản lý nhân sự')).toBeTruthy();
  });
});

describe('trang Nhân sự — thu quyền', () => {
  it('đang mở /hr mà bị thu grant ⇒ chuyển ngay sang "không có quyền", bảng dữ liệu biến mất', async () => {
    const { f, an, open, grantHr } = seed();
    await grantHr(an);
    open(`/w/${f.wsId}/hr`, an);
    await screen.findByRole('table', { name: 'Chấm công từng người hôm nay' });
    await act(() =>
      f.apiAs(f.owner, 'PUT', `/workspaces/${f.wsId}/members/${an.id}/grants`, { grants: [] }),
    );
    expect(await screen.findByText('Bạn không có quyền Quản lý nhân sự')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('trang Nhân sự — các tab', () => {
  it('Hôm nay: tổng + từng người (chữ + biểu tượng), tab bằng bàn phím; a11y', async () => {
    const { f, an, open } = seed();
    mock.attendance.punch(f.wsId, { id: an.id, fullName: an.fullName }, 'IN', crypto.randomUUID());
    open(`/w/${f.wsId}/hr`);
    const table = await screen.findByRole('table', { name: 'Chấm công từng người hôm nay' });
    const row = within(table).getByRole('row', { name: /Nguyễn An/ });
    expect(row.textContent).toContain('Có mặt');
    expect(row.textContent).toContain('muộn 2 giờ');
    expect(within(table).getByRole('row', { name: /Trần Lan/ }).textContent).toContain(
      'Chưa tới giờ',
    );
    await expectNoA11yViolations();

    const tab = screen.getByRole('tab', { name: 'Hôm nay' });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Bảng công tháng' }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(window.location.search).toBe('?tab=timesheet');
  });

  it('Đơn nghỉ: thấy lý do; duyệt có ghi chú ⇒ Đã duyệt; thu hồi bắt buộc lý do; a11y', async () => {
    const { f, an, open, submitLeave } = seed();
    await submitLeave(an, {
      type: 'ANNUAL',
      startDate: '2026-10-19',
      endDate: '2026-10-20',
      dayPart: 'FULL',
      reason: 'Về quê',
    });
    open(`/w/${f.wsId}/hr?tab=leave`);
    const item = await screen.findByRole('listitem', { name: 'Đơn của Nguyễn An' });
    expect(item.textContent).toContain('Lý do: Về quê');
    expect(item.textContent).toContain('2 ngày');
    await expectNoA11yViolations();

    const u = user();
    await u.click(within(item).getByRole('button', { name: 'Duyệt đơn của Nguyễn An' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duyệt đơn của Nguyễn An?' });
    await u.type(within(dialog).getByLabelText(/^Ghi chú/), 'Chúc đi vui');
    await u.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Đã duyệt đơn của Nguyễn An')).toBeTruthy();
    expect(mock.leave.items.find((l) => l.userId === an.id)?.decisionNote).toBe('Chúc đi vui');
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Đơn của Nguyễn An' })).toBeNull(),
    );

    await u.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái' }), 'APPROVED');
    const approved = await screen.findByRole('listitem', { name: 'Đơn của Nguyễn An' });
    await u.click(within(approved).getByRole('button', { name: 'Thu hồi đơn của Nguyễn An' }));
    const revoke = await screen.findByRole('dialog', { name: /Thu hồi đơn đã duyệt/ });
    const confirm = within(revoke).getByRole('button', { name: 'Thu hồi' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await u.type(within(revoke).getByLabelText(/^Lý do thu hồi/), 'Dự án gấp');
    await u.click(confirm);
    expect(await screen.findByText('Đã thu hồi đơn của Nguyễn An')).toBeTruthy();
    expect(mock.leave.items.find((l) => l.userId === an.id)?.status).toBe('REVOKED');
  });

  it('HR (không phải OWNER) không thấy nút với đơn của chính mình', async () => {
    const { f, an, open, submitLeave, grantHr } = seed();
    await grantHr(an);
    await submitLeave(an, {
      type: 'UNPAID',
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      dayPart: 'AM',
    });
    open(`/w/${f.wsId}/hr?tab=leave`, an);
    const item = await screen.findByRole('listitem', { name: 'Đơn của Nguyễn An' });
    expect(item.textContent).toContain('người khác có quyền Quản lý nhân sự sẽ xử lý');
    expect(within(item).queryByRole('button')).toBeNull();
  });

  it('Bảng công: chọn người ⇒ lịch tháng; bấm ngày ⇒ thêm lượt ⇒ ô ngày cập nhật, không tải lại cả bảng', async () => {
    const { f, open } = seed();
    open(`/w/${f.wsId}/hr?tab=timesheet`);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Nguyễn An' }));
    const month = await screen.findByRole('region', { name: 'Bảng công của Nguyễn An' });
    const day = within(month).getByRole('button', { name: /14\/10/ });
    // Dialog mở ⇒ Radix ẩn phần ngoài khỏi cây a11y: giữ tham chiếu hàng (key theo ngày, không đổi).
    const dayRow = day.closest('tr');
    expect(dayRow?.textContent).toContain('Vắng');
    await u.click(day);
    const dialog = await screen.findByRole('dialog', { name: /Nguyễn An — / });
    expect(await within(dialog).findByText('Không có lượt chấm nào trong ngày này.')).toBeTruthy();
    const form = within(dialog).getByRole('form', { name: 'Thêm lượt chấm' });
    fireEvent.change(within(form).getByLabelText(/^Giờ/), { target: { value: '08:00' } });
    await u.type(within(form).getByLabelText(/^Lý do/), 'Quên chấm');
    await u.click(within(form).getByRole('button', { name: 'Thêm lượt' }));
    expect(await screen.findByText('Đã thêm lượt chấm')).toBeTruthy();
    await waitFor(() => expect(dayRow?.textContent).toContain('Chưa chấm ra'));
    expect(await within(dialog).findByText(/HR điều chỉnh/)).toBeTruthy();
  });

  it('Xuất CSV: tải Blob với tên file từ server', async () => {
    const { f, open } = seed();
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:hr';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    open(`/w/${f.wsId}/hr?tab=timesheet`);
    await user().click(await screen.findByRole('button', { name: 'Xuất CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('cham-cong-2026-10.csv');
    expect(await created[0]?.text()).toContain('Nguyễn An');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('Số phép: chỉnh điều chỉnh ⇒ dòng cập nhật; Lịch & ngày lễ: thêm ngày lễ', async () => {
    const { f, an, open } = seed();
    open(`/w/${f.wsId}/hr?tab=balances`);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Chỉnh số phép của Nguyễn An' }));
    const dialog = await screen.findByRole('dialog', { name: /Số phép năm 2026 của Nguyễn An/ });
    const input = within(dialog).getByLabelText(/^Điều chỉnh/);
    await u.clear(input);
    await u.type(input, '1,5');
    await u.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã cập nhật số phép của Nguyễn An')).toBeTruthy();
    const row = screen.getByRole('row', { name: /Nguyễn An/ });
    expect(row.textContent).toContain('13,5 ngày');
    expect(mock.leave.balance(f.wsId, an.id, 2026).adjustmentDays).toBe(1.5);

    await u.click(screen.getByRole('tab', { name: 'Lịch & ngày lễ' }));
    expect(
      await screen.findByText(/Đang dùng lịch mặc định: T2, T3, T4, T5, T6, T7, 08:00–17:30/),
    ).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Thêm ngày lễ' });
    fireEvent.change(within(form).getByLabelText(/^Ngày/), { target: { value: '2026-11-20' } });
    await u.type(within(form).getByLabelText(/^Tên ngày lễ/), 'Nhà giáo');
    await u.click(within(form).getByRole('button', { name: 'Lưu ngày lễ' }));
    expect(await screen.findByText(/20\/11\/2026/)).toBeTruthy();
    await expectNoA11yViolations();
  });
});
