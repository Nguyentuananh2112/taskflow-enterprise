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
  it('mặc định THÁNG CỦA SERVER, dạng LỊCH T2→CN: hôm nay nổi bật, tổng kết từ server, ngày trước khi vào làm gộp 1 câu, tương lai trống; a11y', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
    // Người dùng gia nhập 15/10 ⇒ MỘT câu thay vì 14 ô "Chưa/không làm việc".
    expect(screen.getByText('Bạn bắt đầu làm từ 15/10')).toBeTruthy();
    expect(table.textContent).not.toContain('Chưa/không làm việc');
    expect(table.textContent).not.toContain('Vắng');
    const today = table.querySelectorAll('td[aria-current="date"]');
    expect(today).toHaveLength(1);
    expect(
      within(today[0] as HTMLElement)
        .getByRole('button')
        .getAttribute('aria-label'),
    ).toBe('Ngày 15/10, hôm nay, Chưa chấm công');
    // Ngày tương lai: chỉ số ngày, không chữ trạng thái ("Chưa tới giờ" đã bỏ).
    const future = within(table).getByRole('button', { name: /^Ngày 20\/10$/ });
    expect(future.textContent).toBe('20');
    expect(table.textContent).not.toContain('Chưa tới giờ');
    // Ô "Hôm nay" + tổng kết (số do server tính).
    const box = screen.getByRole('region', { name: /^Hôm nay, / });
    expect(box.textContent).toContain('Bạn chưa chấm công');
    expect(within(box).getByRole('button', { name: 'Chấm vào' })).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Tổng kết tháng 10/2026' });
    expect(summary.textContent).toContain('Ngày đi làm0 ngày');
    expect(summary.textContent).toContain('Tính đến hết ngày 15/10.');
    expect(screen.getByRole('list', { name: 'Chú thích' })).toBeTruthy();
    await expectNoA11yViolations();
  });

  it('bàn phím: lưới chỉ MỘT điểm dừng Tab (hôm nay); ←/→ một ngày, ↑/↓ một tuần; Enter mở chi tiết', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    const tabbable = within(table)
      .getAllByRole('button')
      .filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Ngày 15/10, hôm nay, Chưa chấm công',
    ]);
    const u = userEvent.setup({ delay: null });
    tabbable[0]?.focus();
    await u.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Ngày 16/10');
    await u.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Ngày 23/10');
    await u.keyboard('{ArrowUp}{ArrowUp}{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Ngày 8\/10/);
    // Ô đang focus nhận tabindex 0 (roving) ⇒ Tab ra rồi vào lại về đúng ô.
    expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
    await u.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: /^Ngày .*08\/10/ })).toBeTruthy();
  });

  it('bấm ô ngày N ⇒ dialog đúng ngày N, kể cả sau khi đi bằng phím mũi tên (demo TL: bấm 17 mở 31/10)', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    const u = userEvent.setup({ delay: null });
    const cell = (n: number) =>
      within(table).getByRole('button', { name: new RegExp(`^Ngày ${n}/10`) });
    for (const n of [17, 1, 31, 9]) {
      await u.click(cell(n));
      expect(
        await screen.findByRole('dialog', {
          name: new RegExp(`, ${String(n).padStart(2, '0')}/10$`),
        }),
      ).toBeTruthy();
      await u.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    // Đi bằng phím rồi BẤM chuột vào ô khác ⇒ vẫn đúng ô được bấm (roving tabindex không ghi đè).
    cell(15).focus();
    await u.keyboard('{ArrowRight}{ArrowDown}');
    await u.click(cell(17));
    expect(await screen.findByRole('dialog', { name: /, 17\/10$/ })).toBeTruthy();
  });

  it('chi tiết ngày: "‹ Ngày trước" / "Ngày sau ›" đổi ngày ngay trong dialog, không vượt khỏi tháng', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    const u = userEvent.setup({ delay: null });
    const title = () => screen.getByRole('dialog').querySelector('h2')?.textContent;
    await u.click(within(table).getByRole('button', { name: /^Ngày 15\/10/ }));
    await screen.findByRole('dialog', { name: /15\/10$/ });
    await u.click(screen.getByRole('button', { name: 'Ngày sau ›' }));
    expect(title()).toMatch(/16\/10$/);
    await u.click(screen.getByRole('button', { name: '‹ Ngày trước' }));
    await u.click(screen.getByRole('button', { name: '‹ Ngày trước' }));
    expect(title()).toMatch(/14\/10$/);
    await u.keyboard('{Escape}');
    await u.click(within(table).getByRole('button', { name: /^Ngày 1\/10/ }));
    await screen.findByRole('dialog', { name: /01\/10$/ });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '‹ Ngày trước' }).disabled).toBe(
      true,
    );
    await u.keyboard('{Escape}');
    await u.click(within(table).getByRole('button', { name: /^Ngày 31\/10/ }));
    await screen.findByRole('dialog', { name: /31\/10$/ });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ngày sau ›' }).disabled).toBe(
      true,
    );
  });

  it('chuyển "Danh sách" ⇒ bảng có tiêu đề hàng, câu chữ đời thường; NHỚ lựa chọn khi vào lại', async () => {
    open();
    await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    const u = userEvent.setup({ delay: null });
    await u.click(screen.getByRole('button', { name: 'Danh sách' }));
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Ngày', 'Trạng thái', 'Giờ vào', 'Giờ ra', 'Số giờ làm']);
    // 1–14/10 ngoài nhiệm kỳ ⇒ một dòng câu; còn 15–31 là 17 hàng ngày.
    expect(within(table).getAllByRole('rowheader')).toHaveLength(17);
    expect(table.textContent).toContain('Bạn bắt đầu làm từ 15/10');
    expect(screen.getByRole('button', { name: 'Danh sách' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    cleanupApp();
    open();
    expect(
      (await screen.findByRole('button', { name: 'Danh sách' })).getAttribute('aria-pressed'),
    ).toBe('true');
    await u.click(screen.getByRole('button', { name: 'Lịch' }));
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
      .click(within(table).getByRole('button', { name: /^Ngày 15\/10/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Ngày .*15\/10/ });
    // Lời thường trước: Giờ vào / Giờ ra / Số giờ làm (giờ "10:00" theo lịch), rồi mới tới lượt chấm thô.
    expect(dialog.textContent).toContain('Giờ vào10:00');
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

  it('không có ?month và me/today lỗi ⇒ "Không tải được bảng công" + Thử lại, không kẹt skeleton', async () => {
    const boom = () =>
      HttpResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } },
        { status: 500 },
      );
    const f = seedBoard(mock);
    const url = `${API_BASE}/workspaces/${f.wsId}/attendance/me/today`;
    mock.server.use(...[1, 2, 3].map(() => http.get(url, boom, { once: true })));
    f.signInAs(f.owner);
    const hub = new FakeRealtimeHub(mock.board, mock.db);
    openApp(`/w/${f.wsId}/attendance`, hub.client(getClientId(), f.owner.id));
    expect(
      await screen.findByText('Không tải được bảng công', {}, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Đang tải bảng công' })).toBeNull();
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' })).toBeTruthy();
  });
});
