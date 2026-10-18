import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Lỗi thăm dò localhost 18/10 (TL): #3 /leave mở vào ngày nghỉ hiện ngay lỗi "không có ngày làm việc"; #E2 bảng Số phép ở
// 360 px chỉ thấy 2 / 7 cột ("Còn lại" khuất); #E1 thẻ nhân viên ép cột chữ còn ~80 px. Bố cục thật đo ở E2E (jsdom
// không áp CSS) — ở đây kiểm cấu trúc + axe.

let mock: ReturnType<typeof startMockApi>;
afterEach(() => {
  cleanupApp();
  mock.stop();
  vi.unstubAllGlobals();
});

function start(iso: string) {
  mock = startMockApi({ now: () => Date.parse(iso) });
  const f = seedBoard(mock);
  const open = (path: string) => {
    f.signInAs(f.owner);
    openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  };
  return { f, open };
}

describe('sửa sau thăm dò (#3, #E1, #E2)', () => {
  it('#3 /leave mở vào Chủ nhật 18/10: ô ngày để trống, KHÔNG có dòng lỗi "không có ngày làm việc"; a11y', async () => {
    const { open } = start('2026-10-18T03:00:00.000Z');
    open('/leave');
    const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    expect(within(form).getByLabelText<HTMLInputElement>(/^Từ ngày/).value).toBe('');
    expect(within(form).getByLabelText<HTMLInputElement>(/^Đến ngày/).value).toBe('');
    await new Promise((r) => setTimeout(r, 700)); // quá debounce xem trước (400 ms)
    expect(screen.queryByText(/không có ngày làm việc/i)).toBeNull();
    await expectNoA11yViolations();
    // Gửi khi chưa chọn ngày ⇒ câu lỗi tiếng Việt dưới ô (không phải thông điệp mặc định của zod).
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent
      .setup({ delay: null })
      .click(within(form).getByRole('button', { name: 'Gửi đơn' }));
    const from = within(form).getByLabelText(/^Từ ngày/);
    expect(from.getAttribute('aria-invalid')).toBe('true');
    const message =
      document.getElementById(from.getAttribute('aria-describedby')?.split(' ').at(-1) ?? '')
        ?.textContent ?? '';
    expect(message).toBe('Chọn ngày bắt đầu nghỉ.');
  });

  it('#3 ngày làm việc (T5 15/10) ⇒ mặc định hôm nay như cũ', async () => {
    const { open } = start('2026-10-15T03:00:00.000Z');
    open('/leave');
    const form = await screen.findByRole('form', { name: 'Gửi đơn nghỉ' });
    expect(within(form).getByLabelText<HTMLInputElement>(/^Từ ngày/).value).toBe('2026-10-15');
  });

  it('#E2 Số phép < md: thẻ có "Còn 12 ngày" ngay hàng đầu + nút Chỉnh (không bảng); a11y', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { f, open } = start('2026-10-15T03:00:00.000Z');
    f.setCompanyAccess(f.owner, 'HR');
    f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
    open('/hr?tab=balances');
    const list = await screen.findByRole('list', { name: 'Số phép năm 2026 của từng nhân viên' });
    const an = within(list).getByRole('listitem', { name: 'Nguyễn An' });
    expect(within(an).getByText('Còn 12 ngày')).toBeTruthy();
    expect(within(an).getByRole('button', { name: 'Chỉnh số phép của Nguyễn An' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoA11yViolations();
  });

  it('#E1 thẻ nhân viên: khối chữ chiếm cả hàng dưới sm (nút xuống dòng)', async () => {
    const { f, open } = start('2026-10-15T03:00:00.000Z');
    f.setCompanyAccess(f.owner, 'HR');
    f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    open('/hr/employees');
    const row = await screen.findByRole('listitem', { name: 'Mia Trần' });
    const info = within(row).getByText('Mia Trần').closest('div');
    expect(info?.className).toContain('basis-full');
    expect(info?.className).toContain('sm:flex-1');
  });
});
