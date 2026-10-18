import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-050 (payroll.md §5.2): hồ sơ lương — thêm phiên bản (tháng, cấp bậc, lương cơ bản dán "8,000,000"), lịch sử, ngày vào
// công ty chỉ đọc, hồ sơ của chính kế toán chỉ đọc, mức thâm niên / năm. Số bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

describe('/payroll/profiles (T-050)', () => {
  it('thêm phiên bản lương ⇒ dòng hiện cấp bậc + lương; của chính kế toán chỉ đọc; đổi mức thâm niên; a11y', async () => {
    const f = seedBoard(mock);
    mock.db.company.setAccess(f.owner.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
    f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
    mock.payroll.hireDateOf = () => '2021-05-01';
    f.signInAs(f.owner);
    openApp(
      '/payroll/profiles',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = userEvent.setup({ delay: null });
    const an = await screen.findByRole('listitem', { name: 'Nguyễn An' });
    expect(within(an).getByText('Chưa có hồ sơ lương')).toBeTruthy();
    expect(within(an).getByText(/Ngày vào công ty: 01\/05\/2021 — HR sửa ở Nhân sự/)).toBeTruthy();
    const mine = screen.getByRole('listitem', { name: f.owner.fullName });
    expect(within(mine).getByText('Kế toán khác hoặc Admin sửa')).toBeTruthy();
    await expectNoA11yViolations();

    await u.click(within(an).getByRole('button', { name: 'Đổi lương của Nguyễn An' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hồ sơ lương — Nguyễn An' });
    const month = within(dialog).getByLabelText(/^Áp dụng từ tháng/);
    await u.clear(month);
    await u.type(month, '2026-01');
    await u.type(within(dialog).getByLabelText(/^Cấp bậc/), 'L2');
    await u.click(within(dialog).getByLabelText(/^Lương cơ bản/));
    await u.paste('8,000,000');
    await u.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(an).findByText('L2 · 8.000.000 ₫ (từ 01/2026)')).toBeTruthy();

    const rate = screen.getByLabelText(/^Mức mỗi năm/);
    await u.clear(rate);
    await u.type(rate, '600000');
    await u.click(screen.getByRole('button', { name: 'Lưu mức' }));
    expect(await screen.findByText(/Đã lưu mức thâm niên/)).toBeTruthy();
    expect(mock.payroll.settings.seniorityPerYear).toBe(600_000);
  });
});
