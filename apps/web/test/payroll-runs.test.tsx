import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-050 (payroll.md §5.2): kế toán — danh sách tháng, tạo bảng tháng đã qua, việc còn lại (thiếu hồ sơ lương / ngày vào),
// phát hành bị chặn ⇒ liệt kê tên + lý do; đủ ⇒ modal bắt tick "Tôi đã kiểm tra". HR không có quyền Kế toán. Số bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

const user = () => userEvent.setup({ delay: null });

function seed() {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, 'ADMIN');
  const an = f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const open = (path: string) => {
    f.signInAs(f.owner);
    openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  };
  const giveProfile = () => {
    mock.payroll.hireDateOf = () => '2021-05-01';
    mock.payroll.profiles.set(an.id, [
      {
        id: crypto.randomUUID(),
        effectiveFrom: '2026-01',
        level: 'L1',
        baseSalary: 7_800_000,
        createdBy: { id: f.owner.id, fullName: f.owner.fullName },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  };
  return { f, an, open, giveProfile };
}

describe('/payroll (T-050)', () => {
  it('tạo bảng tháng 9 ⇒ mở bảng; thiếu hồ sơ ⇒ việc còn lại + Phát hành báo đúng tên và lý do; a11y', async () => {
    const { open } = seed();
    open('/payroll');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Tạo bảng tháng 9/2026' }));
    // Tạo xong ⇒ chuyển thẳng sang bảng tháng.
    await waitFor(() => expect(window.location.pathname).toBe('/payroll/2026-09'));
    const todo = await screen.findByRole('region', { name: 'Việc còn lại' });
    expect(within(todo).getByText(/Nguyễn An: chưa có hồ sơ lương/)).toBeTruthy();
    expect(within(todo).getByText(/Nguyễn An: thiếu ngày vào công ty/)).toBeTruthy();
    await expectNoA11yViolations();

    await u.click(screen.getByRole('button', { name: 'Phát hành' }));
    const dialog = await screen.findByRole('dialog', {
      name: /^Phát hành bảng lương tháng 9\/2026/,
    });
    const go = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Phát hành' });
    expect(go.disabled).toBe(true);
    await u.click(within(dialog).getByLabelText('Tôi đã kiểm tra'));
    await u.click(go);
    expect(
      await within(dialog).findByText(/Nguyễn An: chưa có hồ sơ lương, thiếu ngày vào công ty/),
    ).toBeTruthy();
    // Hủy rồi mở lại ⇒ ô tick về trống, danh sách bị chặn cũ không còn (H soát T-050).
    await u.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await u.click(screen.getByRole('button', { name: 'Phát hành' }));
    const again = await screen.findByRole('dialog', { name: /^Phát hành bảng lương/ });
    expect(within(again).getByLabelText<HTMLInputElement>('Tôi đã kiểm tra').checked).toBe(false);
    expect(within(again).queryByText(/Chưa phát hành được/)).toBeNull();
  });

  it('đủ hồ sơ ⇒ phát hành được: bảng thành "Đã phát hành", nhân viên thấy phiếu', async () => {
    const { an, open, giveProfile } = seed();
    giveProfile();
    mock.payroll.createRun('2026-09');
    open('/payroll/2026-09');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Phát hành' }));
    const dialog = await screen.findByRole('dialog', { name: /^Phát hành bảng lương/ });
    await u.click(within(dialog).getByLabelText('Tôi đã kiểm tra'));
    await u.click(within(dialog).getByRole('button', { name: 'Phát hành' }));
    expect(await screen.findByText('Đã phát hành bảng lương tháng 9/2026')).toBeTruthy();
    expect(await screen.findByText('Đã phát hành')).toBeTruthy();
    expect(mock.payroll.runs.get('2026-09')?.status).toBe('PUBLISHED');
    const run = mock.payroll.runs.get('2026-09');
    expect(run && mock.payroll.current(run, an.id)?.status).toBe('PUBLISHED');
  });

  it('HR (không Kế toán) ⇒ "Bạn không có quyền Kế toán"', async () => {
    const { f } = seed();
    f.setCompanyAccess(f.owner, 'HR');
    f.signInAs(f.owner);
    openApp('/payroll', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
    expect(await screen.findByText('Bạn không có quyền Kế toán')).toBeTruthy();
  });
});
