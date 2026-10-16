import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041a: /w/:ws/attendance — bảng công tháng (attendance-leave.md §6, E2E-HR-07).
// Mock: thứ 5 2026-10-15 10:00 giờ Việt Nam.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open(path = '') {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.signInAs(f.owner);
  openApp(`/w/${f.wsId}/attendance${path}`, hub.client(getClientId(), f.owner.id));
  return f;
}

describe('bảng công tháng', () => {
  it('mặc định THÁNG CỦA SERVER; <table> có tiêu đề cột + hàng; trạng thái chữ + biểu tượng; a11y', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Ngày', 'Trạng thái', 'Vào', 'Ra', 'Giờ làm', 'Muộn / sớm']);
    const rows = within(table).getAllByRole('rowheader');
    expect(rows).toHaveLength(31);
    // Người dùng gia nhập 15/10 ⇒ ngày trước đó KHÔNG phải "Vắng" (TL chốt NOT_EMPLOYED).
    const before = within(table)
      .getByRole('rowheader', { name: /14\/10/ })
      .closest('tr');
    expect(before?.textContent).toContain('Chưa/không làm việc');
    expect(before?.textContent).not.toContain('Vắng');
    const sun = within(table)
      .getByRole('rowheader', { name: /18\/10/ })
      .closest('tr');
    expect(sun?.textContent).toContain('Không phải ngày làm');
    // Biểu tượng chỉ để nhìn (trung tính, không màu vắng) — trình đọc màn hình đọc chữ.
    expect(before?.querySelector('[aria-hidden="true"]')?.textContent).toContain('·');
    await expectNoA11yViolations();
  });

  it('?month= chọn tháng khác; liên kết tháng trước/sau', async () => {
    open('?month=2026-09');
    expect(await screen.findByRole('table', { name: 'Bảng công tháng 9/2026' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Chọn tháng' });
    expect(within(nav).getByRole('link', { name: '← Tháng trước' }).getAttribute('href')).toBe(
      '?month=2026-08',
    );
    expect(within(nav).getByRole('link', { name: 'Tháng sau →' }).getAttribute('href')).toBe(
      '?month=2026-10',
    );
  });

  it('bấm một ngày ⇒ lượt chấm kèm IP/thiết bị; lượt đã hủy gạch ngang + người hủy + lý do (hiển thị như TEXT)', async () => {
    const f = open();
    const me = { id: f.owner.id, fullName: f.owner.fullName };
    mock.attendance.punch(f.wsId, me, 'IN', crypto.randomUUID(), {
      ip: '10.0.0.7',
      userAgent: 'Firefox/141',
    });
    mock.attendance.punch(f.wsId, me, 'OUT', crypto.randomUUID());
    const out = mock.attendance.events(f.wsId, f.owner.id, '2026-10-15')[1];
    const evil = '<img src=x onerror="alert(1)">';
    mock.attendance.voidPunch(
      f.wsId,
      f.owner.id,
      '2026-10-15',
      out?.id ?? '',
      { id: me.id, fullName: 'Hana HR' },
      evil,
    );
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    await userEvent
      .setup({ delay: null })
      .click(within(table).getByRole('button', { name: /15\/10/ }));
    const dialog = await screen.findByRole('dialog', { name: /Lượt chấm/ });
    expect(await within(dialog).findByText(/Vào lúc 10:00 · Web/)).toBeTruthy();
    expect(within(dialog).getByText(/IP 10\.0\.0\.7/).textContent).toContain(
      'Thiết bị: Firefox/141',
    );
    const voided = within(dialog).getByText(/Ra lúc 10:00 · Web/);
    expect(voided.className).toContain('line-through');
    expect(within(dialog).getByText(`Đã hủy bởi Hana HR: ${evil}`)).toBeTruthy();
    expect(dialog.querySelector('img')).toBeNull();
    await expectNoA11yViolations();
  });
});
