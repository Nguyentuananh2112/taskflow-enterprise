import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { COMPANY_SCOPE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-058c (ADR-130/131): chính sách phép (form theo năm, ví dụ sống, xác nhận, người âm phép), phân rã số phép ở /leave
// và tab Số phép (thâm niên, chuyển sang + hạn), báo cáo nghỉ phép .xlsx. Hôm nay theo mock: 2026-10-15. Dữ liệu bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup({ delay: null });
const by = { id: '00000000-0000-4000-8000-000000000001', fullName: 'HR cũ' };

function seed() {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, 'HR');
  const an = f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const open = (url: string, who: { id: string } = f.owner) => {
    const u = mock.db.getUser(who.id);
    if (!u) throw new Error('user?');
    f.signInAs(u);
    openApp(url, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), who.id));
  };
  return { f, an, open };
}

describe('chính sách phép + phân rã (T-058c)', () => {
  it('/leave: "Phép năm 12 + thâm niên 1 = 13 · Phép năm trước chuyển sang 2 (dùng trước 31/03)…"', async () => {
    const { an, open } = seed();
    mock.db.company.profiles.set(an.id, { hireDate: '2019-03-01' });
    mock.leave.policies.set(
      2025,
      { ...mock.leave.policies.fields(2025), carryOverEnabled: true, carryOverMaxDays: 2 },
      by,
      '2025-01-01T00:00:00.000Z',
    );
    open('/leave', an);
    const region = await screen.findByRole('region', { name: /Phép năm 2026/ });
    await waitFor(() =>
      expect(region.textContent).toContain('Phép năm 12 ngày + thâm niên 1 ngày = 13 ngày'),
    );
    // Hạn dùng (31/03) đã qua ở 15/10 ⇒ phần chuyển sang không còn dùng được: còn 13.
    expect(region.textContent).toContain('Phép năm trước chuyển sang 2 ngày (dùng trước 31/03)');
    expect(region.textContent).toContain('Còn 13 ngày');
  });

  it('HR: "Cài chính sách phép" — ví dụ sống, Lưu ⇒ xác nhận ⇒ người âm phép được liệt kê; a11y', async () => {
    const { an, open } = seed();
    mock.leave.adjustments.set(`${COMPANY_SCOPE}|${an.id}|2026`, -12.5);
    open('/hr?tab=balances');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Cài chính sách phép' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chính sách phép năm' });
    const annual = await within(dialog).findByLabelText<HTMLInputElement>(/^Số ngày phép năm/);
    expect(annual.value).toBe('12');
    expect(within(dialog).getByText(/Năm 2026 chưa đặt — đang dùng mức luật/)).toBeTruthy();
    await u.clear(annual);
    await u.type(annual, '14');
    expect(within(dialog).getByText(/vào 01\/03\/2019 có 15 ngày phép năm 2026/)).toBeTruthy();
    await u.click(within(dialog).getByLabelText('Cho chuyển phép chưa dùng sang năm sau'));
    expect(within(dialog).getByLabelText(/^Dùng trước hết tháng/)).toBeTruthy();
    await expectNoA11yViolations();

    await u.clear(annual);
    await u.type(annual, '12');
    await u.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(within(dialog).getByText('Lưu cho cả công ty, năm 2026?')).toBeTruthy();
    await u.click(within(dialog).getByRole('button', { name: 'Xác nhận lưu' }));
    expect(
      await within(dialog).findByText(/Nguyễn An \(-0,5 ngày\)|Nguyễn An \(−0,5 ngày\)/),
    ).toBeTruthy();
    expect(mock.leave.policies.dto(2026)).toMatchObject({ source: 'SET', carryOverEnabled: true });
  });

  it('HR: dưới mức luật ⇒ không cho lưu; năm sau dùng kế thừa', async () => {
    const { open } = seed();
    open('/hr?tab=balances');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Cài chính sách phép' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chính sách phép năm' });
    const annual = await within(dialog).findByLabelText(/^Số ngày phép năm/);
    await u.clear(annual);
    await u.type(annual, '11');
    expect(within(dialog).getByText(/Có ô chưa hợp lệ/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Lưu' }).disabled).toBe(
      true,
    );
    await u.click(within(dialog).getByRole('button', { name: 'Năm sau (2027)' }));
    expect(await within(dialog).findByText(/Năm 2027 chưa đặt/)).toBeTruthy();
  });

  it('HR: "Tải báo cáo nghỉ phép" ⇒ chọn khoảng trong năm ⇒ tải nghi-phep-2026.xlsx', async () => {
    const { open } = seed();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
    );
    open('/hr?tab=balances');
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Tải báo cáo nghỉ phép' }));
    const dialog = await screen.findByRole('dialog', { name: 'Báo cáo nghỉ phép năm 2026' });
    await u.click(within(dialog).getByRole('button', { name: 'Tải Excel' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('nghi-phep-2026.xlsx');
    vi.unstubAllGlobals();
  });
});
