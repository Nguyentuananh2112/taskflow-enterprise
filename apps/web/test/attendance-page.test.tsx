import { screen, within } from '@testing-library/react';
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
    const wed = within(table)
      .getByRole('rowheader', { name: /14\/10/ })
      .closest('tr');
    expect(wed?.textContent).toContain('Vắng');
    const sun = within(table)
      .getByRole('rowheader', { name: /11\/10/ })
      .closest('tr');
    expect(sun?.textContent).toContain('Không phải ngày làm');
    // Biểu tượng chỉ để nhìn — trình đọc màn hình đọc chữ.
    expect(wed?.querySelector('[aria-hidden="true"]')?.textContent).toContain('✕');
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
});
