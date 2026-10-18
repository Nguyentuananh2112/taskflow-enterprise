import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-050 (payroll.md §5.1): "Phiếu lương của tôi" — mở THẲNG phiếu mới nhất, ‹ › giữa các tháng có phiếu, tên công ty ở
// đầu phiếu, thẻ Tổng thực lĩnh, "—" đọc "0 đồng", bản điều chỉnh có lý do + BẢN CŨ, title không tiền / tên; Admin không
// có phiếu. Số tiền bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

const admin = { id: '00000000-0000-4000-8000-0000000000ad', fullName: 'Kế toán' };

function seed() {
  const f = seedBoard(mock);
  const me = { id: f.owner.id, fullName: f.owner.fullName };
  mock.payroll.profiles.set(f.owner.id, [
    {
      id: crypto.randomUUID(),
      effectiveFrom: '2026-01',
      level: 'L2',
      baseSalary: 8_000_000,
      createdBy: admin,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  for (const period of ['2026-08', '2026-09']) {
    const run = mock.payroll.createRun(period);
    const slip = mock.payroll.build(run, me, {
      lines: [
        { section: 'BONUS', label: 'Thưởng kênh online', amount: 1_500_000 },
        { section: 'DEDUCTION', label: 'BHXH', amount: 840_000 },
      ],
    });
    run.slips.set(me.id, [slip]);
    mock.payroll.publish(run, admin);
  }
  const open = (path: string) => {
    f.signInAs(f.owner);
    openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  };
  return { f, me, open };
}

describe('/payslips (T-050)', () => {
  it('mở thẳng phiếu mới nhất (09/2026): tên công ty, thẻ thực lĩnh, bảng theo mẫu, title không tiền; a11y', async () => {
    const { open } = seed();
    open('/payslips');
    const sheet = await screen.findByRole('article', { name: 'Phiếu lương' });
    expect(within(sheet).getByText('Công ty Mẫu')).toBeTruthy();
    expect(within(sheet).getByText('Tháng 09 năm 2026')).toBeTruthy();
    expect(within(sheet).getByRole('rowheader', { name: 'Thưởng kênh online' })).toBeTruthy();
    expect(
      within(sheet).getByRole('rowheader', { name: '(4) Tổng thực lĩnh = (1) + (2) − (3)' }),
    ).toBeTruthy();
    // Không có lượt chấm nào ⇒ lương theo công 0 ⇒ "—" đọc "0 đồng".
    const zero = within(sheet).getAllByText('0 đồng');
    expect(zero.length).toBeGreaterThan(0);
    expect(zero[0]?.className).toContain('sr-only');
    expect(zero[0]?.previousElementSibling?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('region', { name: 'Tổng thực lĩnh' }).textContent).toContain('660.000');
    await waitFor(() => expect(document.title).toBe('Phiếu lương tháng 9/2026'));
    expect(document.title).not.toMatch(/\d{3}\.\d{3}/);
    await expectNoA11yViolations();
    expect(screen.getByRole('link', { name: '‹ Tháng 8/2026' }).getAttribute('href')).toBe(
      '/payslips/2026-08',
    );
  });

  it('bản điều chỉnh: dải "Đã điều chỉnh lần 1 … lý do"; ?rev=1 ⇒ "BẢN CŨ — đã được thay thế"', async () => {
    const { me, open } = seed();
    const run = mock.payroll.runs.get('2026-09');
    if (!run) throw new Error('run?');
    const next = mock.payroll.build(run, me, { note: 'Bổ sung thưởng' });
    mock.payroll.revise(run, me, next, 'Thiếu thưởng tháng 9');
    open('/payslips/2026-09');
    expect(
      await screen.findByText(/Đã điều chỉnh lần 1 .*lý do: Thiếu thưởng tháng 9/),
    ).toBeTruthy();
    cleanupApp();
    open('/payslips/2026-09?rev=1');
    expect(await screen.findByText('BẢN CŨ — đã được thay thế')).toBeTruthy();
    // Chờ mọi request của trang xong — request dở trả về sau khi test kết thúc sẽ chạm mock của test sau.
    expect(await screen.findByRole('region', { name: 'Các tháng' })).toBeTruthy();
    await screen.findByRole('article', { name: 'Phiếu lương' });
  });

  it('tháng chưa có phiếu ⇒ câu lời thường; Admin ⇒ không có phiếu lương', async () => {
    const { f, open } = seed();
    open('/payslips/2026-10');
    expect(
      await screen.findByText(
        'Phiếu lương tháng 10/2026 sẽ có trước ngày 10/11.',
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    cleanupApp();
    f.setCompanyAccess(f.owner, 'ADMIN');
    open('/payslips');
    expect(await screen.findByText('Tài khoản Quản trị không có phiếu lương')).toBeTruthy();
  });
});
