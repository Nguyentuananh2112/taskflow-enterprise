import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041b: /w/:ws/leave (attendance-leave.md §6, ADR-122; mã lỗi D chốt). Hôm nay theo server: thứ 5
// 2026-10-15 (giờ Việt Nam). Ngày làm mock: T2–T7.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open(
  role: 'OWNER' | 'VIEWER' = 'OWNER',
  before?: (f: ReturnType<typeof seedBoard>) => void,
) {
  const f = seedBoard(mock);
  before?.(f);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  const user =
    role === 'OWNER'
      ? f.owner
      : f.addUser('Khách Vy', `vy-${crypto.randomUUID()}@example.com`, 'VIEWER');
  f.signInAs(user);
  openApp(`/w/${f.wsId}/leave`, hub.client(getClientId(), user.id));
  return f;
}

async function submit(start: string, end: string, reason = '') {
  const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
  fireEvent.change(within(form).getByLabelText(/^Từ ngày/), { target: { value: start } });
  fireEvent.change(within(form).getByLabelText(/^Đến ngày/), { target: { value: end } });
  const why = within(form).getByLabelText(/^Lý do/);
  fireEvent.change(why, { target: { value: reason } });
  await userEvent
    .setup({ delay: null })
    .click(within(form).getByRole('button', { name: 'Gửi đơn' }));
  return form;
}

describe('trang Nghỉ phép', () => {
  it('số phép ⇒ gửi đơn 2 ngày ⇒ hiện trong danh sách "Chờ duyệt", số đang chờ cập nhật; a11y', async () => {
    open();
    expect(await screen.findByText(/Còn/)).toBeTruthy();
    expect(screen.getByRole('region', { name: /Phép năm 2026/ }).textContent).toContain('12 ngày');
    await expectNoA11yViolations();
    await submit('2026-10-19', '2026-10-20');
    expect(await screen.findByText('Đã gửi đơn — 2 ngày, chờ duyệt')).toBeTruthy();
    const list = screen.getByRole('region', { name: 'Đơn của tôi' });
    expect(
      await within(list).findByText(/Phép năm · 19\/10\/2026 – 20\/10\/2026 · 2 ngày/),
    ).toBeTruthy();
    expect(within(list).getByText('Chờ duyệt')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /Phép năm 2026/ }).textContent).toContain(
        'đang chờ duyệt 2 ngày',
      ),
    );
  });

  it('trùng ngày ⇒ câu rõ ràng; vượt số phép ⇒ báo còn bao nhiêu và đơn cần bao nhiêu', async () => {
    open();
    await submit('2026-10-19', '2026-10-20');
    await screen.findByText('Đã gửi đơn — 2 ngày, chờ duyệt');
    const form = await submit('2026-10-20', '2026-10-21');
    expect(
      await within(form).findByText('Trùng ngày với một đơn đang chờ hoặc đã được duyệt.'),
    ).toBeTruthy();
    await submit('2026-10-22', '2026-11-07'); // 15 ngày làm (T2–T7), còn 12 − 2 đang chờ = 10
    expect(
      await within(form).findByText('Không đủ ngày phép năm. Còn 10 ngày, đơn này cần 15 ngày.'),
    ).toBeTruthy();
  });

  it('hủy đơn chờ duyệt (có xác nhận); lý do hiển thị như chữ', async () => {
    open();
    await submit('2026-10-19', '2026-10-19', '<b>đi khám</b>');
    const list = screen.getByRole('region', { name: 'Đơn của tôi' });
    // Lý do hiển thị như TEXT (E2E-HR-08).
    expect(await within(list).findByText('Lý do: <b>đi khám</b>')).toBeTruthy();
    expect(list.querySelector('b')).toBeNull();
    const u = userEvent.setup({ delay: null });
    await u.click(within(list).getByRole('button', { name: /Hủy đơn 19\/10\/2026/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Hủy đơn nghỉ?' });
    await u.click(within(dialog).getByRole('button', { name: 'Hủy đơn' }));
    expect(await within(list).findByText('Đã hủy')).toBeTruthy();
  });

  it('đơn ĐÃ DUYỆT bắt đầu hôm nay (theo lịch của server) ⇒ không còn nút hủy', async () => {
    open('OWNER', (f) => {
      const at = '2026-10-14T03:00:00.000Z';
      mock.leave.items.push({
        id: crypto.randomUUID(),
        workspaceId: f.wsId,
        userId: f.owner.id,
        user: { id: f.owner.id, fullName: f.owner.fullName },
        type: 'ANNUAL',
        startDate: '2026-10-15',
        endDate: '2026-10-15',
        dayPart: 'FULL',
        days: 1,
        reason: '',
        status: 'APPROVED',
        decidedBy: { id: f.owner.id, fullName: 'Hana HR' },
        decidedAt: at,
        decisionNote: null,
        version: 2,
        createdAt: at,
        updatedAt: at,
      });
    });
    const list = await screen.findByRole('region', { name: 'Đơn của tôi' });
    expect(await within(list).findByText('Đã duyệt')).toBeTruthy();
    expect(within(list).getByText(/Hana HR/)).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Hủy đơn/ })).toBeNull();
  });

  // 19/10–07/11: 18 ngày làm (T2–T7) > 12 ⇒ báo ngay, chưa cần gửi.
  it('xem trước: đổi ngày ⇒ số ngày làm việc + phép còn (server đếm); vượt phép báo ngay trước khi gửi', async () => {
    open();
    const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    fireEvent.change(within(form).getByLabelText(/^Từ ngày/), { target: { value: '2026-10-19' } });
    fireEvent.change(within(form).getByLabelText(/^Đến ngày/), { target: { value: '2026-10-21' } });
    expect(
      await within(form).findByText(
        'Đơn này: 3 ngày làm việc · phép năm còn 12 ngày',
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Đến ngày/), { target: { value: '2026-11-07' } });
    expect(
      await within(form).findByText(
        /Không đủ ngày phép năm\. Còn 12 ngày, đơn này cần 18 ngày\./,
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
  });

  it('VIEWER: không có form, chỉ câu giải thích (server vẫn 403)', async () => {
    open('VIEWER');
    expect(
      await screen.findByText('Vai trò Người xem không xin nghỉ trong workspace này'),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Gửi đơn nghỉ' })).toBeNull();
  });
});
