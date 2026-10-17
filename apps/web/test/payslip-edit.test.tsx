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

// T-050 (payroll.md §5.2): form 1 phiếu — gõ dòng thưởng (dán "1,500,000"), tổng xem trước bằng computePayslip, Lưu;
// sửa công cần lý do (có dòng nhắc không ghi bệnh); phiếu của chính kế toán chỉ đọc; bản điều chỉnh: lý do + xem khác
// biệt rồi mới gửi. Hôm nay 2026-10-15. Số bịa.

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
  mock.payroll.hireDateOf = () => '2024-05-01';
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
  const run = mock.payroll.createRun('2026-09');
  const open = (path: string) => {
    f.signInAs(f.owner);
    openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  };
  return { f, an, run, open };
}

describe('form phiếu lương (T-050)', () => {
  it('nháp: thêm dòng thưởng (dán "1,500,000") ⇒ tổng xem trước ⇒ Lưu phiếu; a11y', async () => {
    const { an, run, open } = seed();
    open(`/payroll/2026-09/${an.id}`);
    const u = user();
    await u.click(
      await screen.findByRole('button', { name: 'Thêm dòng — (2) Thưởng doanh số theo kênh' }),
    );
    await u.type(screen.getByLabelText(/^Nhãn dòng 1/), 'Thưởng kênh online');
    const amount = screen.getByLabelText(/^Số tiền dòng 1/);
    await u.click(amount);
    await u.paste('1,500,000');
    await u.tab();
    expect((amount as HTMLInputElement).value).toBe('1.500.000');
    // Chưa chấm công ngày nào ⇒ lương theo công 0; thâm niên 2 năm × 500 000.
    const preview = screen.getByRole('region', { name: 'Tổng thực lĩnh (xem trước)' });
    expect(preview.textContent).toContain('2.500.000');
    await expectNoA11yViolations();
    await u.click(screen.getByRole('button', { name: 'Lưu phiếu' }));
    expect(await screen.findByText('Đã lưu phiếu của Nguyễn An')).toBeTruthy();
    expect(mock.payroll.current(run, an.id)).toMatchObject({
      bonusTotal: 1_500_000,
      lockVersion: 2,
    });
  });

  it('sửa công ⇒ ô lý do (nhắc không ghi bệnh) bắt buộc; quá công chuẩn ⇒ câu lỗi', async () => {
    const { an, open } = seed();
    open(`/payroll/2026-09/${an.id}`);
    const u = user();
    await u.type(await screen.findByLabelText(/^Sửa công/), '21,5');
    expect(
      screen.getByText('Nhân viên sẽ thấy lý do này — không ghi chẩn đoán/bệnh.'),
    ).toBeTruthy();
    expect(screen.getByText('Sửa công cần ghi lý do.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu phiếu' }).disabled).toBe(
      true,
    );
    const days = screen.getByLabelText(/^Sửa công/);
    await u.clear(days);
    await u.type(days, '40');
    expect(screen.getByText('Công không quá 26 ngày (công chuẩn).')).toBeTruthy();
  });

  it('phiếu của chính kế toán ⇒ chỉ đọc', async () => {
    const { f, open } = seed();
    mock.db.company.setAccess(f.owner.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
    mock.payroll.runs.delete('2026-09');
    mock.payroll.createRun('2026-09');
    open(`/payroll/2026-09/${f.owner.id}`);
    expect(await screen.findByText('Phiếu của bạn — Kế toán khác hoặc Admin sửa.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu phiếu' })).toBeNull();
  });

  it('đã phát hành ⇒ "Tạo bản điều chỉnh": lý do + xem khác biệt ⇒ gửi ⇒ bản 2', async () => {
    const { f, an, run, open } = seed();
    mock.payroll.publish(run, { id: f.owner.id, fullName: f.owner.fullName });
    open(`/payroll/2026-09/${an.id}`);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Tạo bản điều chỉnh' }));
    await u.click(screen.getByRole('button', { name: 'Thêm dòng — (3) Các khoản giảm trừ' }));
    await u.type(screen.getByLabelText(/^Nhãn dòng 1/), 'Tạm ứng');
    await u.type(screen.getByLabelText(/^Số tiền dòng 1/), '200000');
    await u.type(screen.getByLabelText(/^Lý do điều chỉnh/), 'Quên trừ tạm ứng');
    await u.click(screen.getByRole('button', { name: 'Xem khác biệt' }));
    const diff = screen.getByRole('region', { name: 'Khác biệt' });
    expect(within(diff).getByText(/\(3\) Giảm trừ: 0 ₫ →/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Gửi bản điều chỉnh' }));
    await waitFor(() => expect(mock.payroll.current(run, an.id)?.revision).toBe(2));
    expect(mock.payroll.current(run, an.id)?.revisionReason).toBe('Quên trừ tạm ứng');
  });
});
