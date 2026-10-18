import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, COMPANY_SCOPE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041b: /leave (Mốc 3.5 — cấp công ty) (attendance-leave.md §6, ADR-122; mã lỗi D chốt). Hôm nay theo server: thứ 5
// 2026-10-15 (giờ Việt Nam). Ngày làm mock: T2–T7.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open(
  access: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE',
  before?: (f: ReturnType<typeof seedBoard>) => void,
) {
  const f = seedBoard(mock);
  before?.(f);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp('/leave', hub.client(getClientId(), f.owner.id));
  return f;
}

async function submit(start: string, end: string, reason = '') {
  const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
  fireEvent.change(within(form).getByLabelText(/^Từ ngày/), { target: { value: start } });
  fireEvent.change(within(form).getByLabelText(/^Đến ngày/), { target: { value: end } });
  const why = within(form).getByLabelText(/^Lý do/);
  // T-075: ô lý do chỉ mở khi đã đồng ý (ca có lý do bật đồng ý trước khi mở trang).
  if (reason) await waitFor(() => expect(why).toHaveProperty('disabled', false));
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
        'Đang chờ 2 ngày',
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
    open('EMPLOYEE', (f) => mock.db.company.privacy.setConsent(f.owner.id, true));
    await submit('2026-10-19', '2026-10-19', '<b>đi khám</b>');
    const list = screen.getByRole('region', { name: 'Đơn của tôi' });
    // Lý do hiển thị như TEXT (E2E-HR-08).
    expect(await within(list).findByText('Lý do: <b>đi khám</b>')).toBeTruthy();
    expect(list.querySelector('b')).toBeNull();
    const u = userEvent.setup({ delay: null });
    await u.click(within(list).getByRole('button', { name: /Hủy đơn Phép năm 19\/10\/2026/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Hủy đơn nghỉ?' });
    await u.click(within(dialog).getByRole('button', { name: 'Hủy đơn' }));
    expect(await within(list).findByText('Đã hủy')).toBeTruthy();
  });

  it('đơn ĐÃ DUYỆT bắt đầu hôm nay (theo lịch của server) ⇒ không còn nút hủy', async () => {
    open('EMPLOYEE', (f) => {
      const at = '2026-10-14T03:00:00.000Z';
      mock.leave.items.push({
        id: crypto.randomUUID(),
        workspaceId: COMPANY_SCOPE,
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

  it('Admin (không phải nhân viên): không có form, chỉ câu giải thích + lối về (server vẫn 403)', async () => {
    open('ADMIN');
    expect(await screen.findByText('Tài khoản Quản trị không xin nghỉ phép')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về trang chính' }).getAttribute('href')).toBe('/w');
    expect(screen.queryByRole('form', { name: 'Gửi đơn nghỉ' })).toBeNull();
  });

  it('"Đơn của tôi" > 50 đơn ⇒ trang đầu 50 + "Tải thêm" ⇒ đủ 51 đơn, hết nút', async () => {
    open('EMPLOYEE', (f) => {
      const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      for (let i = 0; i < 51; i++) {
        mock.leave.items.push({
          id: crypto.randomUUID(),
          workspaceId: COMPANY_SCOPE,
          userId: f.owner.id,
          user: { id: f.owner.id, fullName: f.owner.fullName },
          type: 'UNPAID',
          startDate: '2026-01-05',
          endDate: '2026-01-05',
          dayPart: 'FULL',
          reason: null,
          days: 1,
          status: 'REJECTED',
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          version: 2,
          createdAt: at(i),
          updatedAt: at(i),
        });
      }
    });
    const section = await screen.findByRole('region', { name: 'Đơn của tôi' });
    const more = await within(section).findByRole('button', { name: 'Tải thêm' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(50);
    await userEvent.setup({ delay: null }).click(more);
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(51));
    expect(within(section).queryByRole('button', { name: 'Tải thêm' })).toBeNull();
  });

  it('me/today lỗi ⇒ form và danh sách báo lỗi + Thử lại, không kẹt skeleton', async () => {
    const boom = () =>
      HttpResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } },
        { status: 500 },
      );
    open('EMPLOYEE', () => {
      const url = `${API_BASE}/attendance/me/today`;
      mock.server.use(...[1, 2, 3].map(() => http.get(url, boom, { once: true })));
    });
    expect(
      await screen.findByText('Không tải được ngày hôm nay', {}, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.getByText('Không tải được đơn')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Đang tải đơn' })).toBeNull();
    await userEvent
      .setup({ delay: null })
      .click(screen.getAllByRole('button', { name: 'Thử lại' })[0] as HTMLElement);
    expect(await screen.findByRole('form', { name: 'Gửi đơn nghỉ' })).toBeTruthy();
  });
});
