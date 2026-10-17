import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-058a (ADR-128): hồ sơ nhân viên ở /hr/employees (cột, "Sửa hồ sơ", luật self), trường hồ sơ khi thêm / nhận lại,
// /my-profile chỉ đọc. Hôm nay theo mock: 2026-10-15. Dữ liệu bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

const user = () => userEvent.setup({ delay: null });
const row = (name: string) => screen.findByRole('listitem', { name });

function open(path: string, access: 'HR' | 'ADMIN' | 'EMPLOYEE' = 'HR') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
  f.signInAs(f.owner);
  const go = () =>
    openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return { f, mia, go };
}

describe('hồ sơ nhân viên (T-058a)', () => {
  it('thẻ: phòng ban · chức vụ · "Vào công ty 03/2019 — 7 năm 7 tháng"; thiếu ngày vào ⇒ nhãn chữ', async () => {
    const { f, mia, go } = open('/hr/employees');
    mock.db.company.profiles.set(mia.id, {
      hireDate: '2019-03-01',
      department: 'Kho vận',
      jobTitle: 'Thủ kho',
    });
    f.addUser('Pam', `pam-${crypto.randomUUID()}@example.com`, 'MEMBER');
    go();
    const card = await row('Mia Trần');
    expect(within(card).getByText('Kho vận · Thủ kho')).toBeTruthy();
    expect(within(card).getByText('Vào công ty 03/2019 — 7 năm 7 tháng')).toBeTruthy();
    expect(
      within(await row('Pam')).getByText(/Thiếu ngày vào công ty — cần cho lương và phép/),
    ).toBeTruthy();
  });

  it('Sửa hồ sơ: tạo lần đầu (version 0) ⇒ thẻ đổi; SĐT sai ⇒ câu chỉ đúng ô; a11y', async () => {
    const { mia, go } = open('/hr/employees');
    go();
    const u = user();
    await u.click(
      within(await row('Mia Trần')).getByRole('button', { name: 'Sửa hồ sơ của Mia Trần' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Sửa hồ sơ — Mia Trần' });
    await u.type(await within(dialog).findByLabelText(/^Phòng ban/), 'Kinh doanh');
    await u.type(within(dialog).getByLabelText(/^Số điện thoại công việc/), '12ab');
    await expectNoA11yViolations();
    await u.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByText(/cần 8–15 chữ số/)).toBeTruthy();

    const phone = within(dialog).getByLabelText(/^Số điện thoại công việc/);
    await u.clear(phone);
    await u.type(phone, '028 3822 1234');
    await u.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã lưu hồ sơ của Mia Trần')).toBeTruthy();
    expect(mock.db.company.profiles.get(mia.id)).toMatchObject({
      department: 'Kinh doanh',
      workPhone: '02838221234',
      version: 1,
    });
    expect(await within(await row('Mia Trần')).findByText('Kinh doanh')).toBeTruthy();
  });

  it('đổi ngày vào ĐÃ CÓ ⇒ phải ghi lý do; 409 ⇒ "Tải bản mới" hiện bản của người kia', async () => {
    const { mia, go } = open('/hr/employees');
    mock.db.company.profiles.set(mia.id, { hireDate: '2019-03-01' });
    go();
    const u = user();
    await u.click(
      within(await row('Mia Trần')).getByRole('button', { name: 'Sửa hồ sơ của Mia Trần' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Sửa hồ sơ — Mia Trần' });
    const date = await within(dialog).findByLabelText<HTMLInputElement>(/^Ngày vào công ty/);
    await u.clear(date);
    await u.type(date, '2019-04-01');
    const save = within(dialog).getByRole('button', { name: 'Lưu' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await u.type(within(dialog).getByLabelText(/^Lý do sửa ngày vào/), 'Nhập nhầm tháng');

    act(() => mock.db.company.profiles.set(mia.id, { department: 'Kế toán' })); // người khác vừa sửa
    await u.click(save);
    expect(await within(dialog).findByText(/vừa được người khác sửa/)).toBeTruthy();
    await u.click(within(dialog).getByRole('button', { name: 'Tải bản mới' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText<HTMLInputElement>(/^Phòng ban/).value).toBe('Kế toán'),
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Ngày vào công ty/).value).toBe(
      '2019-03-01',
    );
  });

  it('HR: thẻ của chính mình không có "Sửa hồ sơ" (luật self tuyệt đối)', async () => {
    const { f, go } = open('/hr/employees');
    go();
    const me = await row(f.owner.fullName);
    expect(within(me).queryByRole('button', { name: /^Sửa hồ sơ/ })).toBeNull();
    expect(within(me).getByText('Hồ sơ của bạn do HR khác hoặc Admin sửa')).toBeTruthy();
  });

  it('thêm nhân viên kèm hồ sơ ⇒ hồ sơ ghi cùng lúc', async () => {
    const { go } = open('/hr/employees');
    go();
    const u = user();
    const add = await screen.findByRole('button', { name: 'Thêm nhân viên' });
    await waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));
    await u.click(add);
    const form = await screen.findByRole('dialog', { name: 'Thêm nhân viên' });
    await u.type(within(form).getByLabelText(/^Email/), 'nina@example.com');
    await u.type(within(form).getByLabelText(/^Họ tên/), 'Nina');
    await u.type(within(form).getByLabelText(/^Ngày vào công ty/), '2026-10-15');
    await u.type(within(form).getByLabelText(/^Chức vụ/), 'Kế toán viên');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    await screen.findByRole('dialog', { name: 'Link kích hoạt cho Nina' });
    const nina = mock.db.findUserByEmail('nina@example.com');
    expect(nina && mock.db.company.profiles.get(nina.id)).toMatchObject({
      hireDate: '2026-10-15',
      jobTitle: 'Kế toán viên',
      department: null,
    });
  });

  it('nhận lại: hồ sơ cũ điền sẵn; "Giữ ngày vào cũ" mặc định ⇒ ngày cũ giữ nguyên', async () => {
    const { mia, go } = open('/hr/employees?status=left', 'ADMIN');
    mock.db.company.profiles.set(mia.id, { hireDate: '2019-03-01', department: 'Kho vận' });
    act(() => mock.db.company.remove(mia.id));
    go();
    const u = user();
    await u.click(within(await row('Mia Trần')).getByRole('button', { name: 'Nhận lại Mia Trần' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nhận lại Mia Trần' });
    const keep = await within(dialog).findByRole('radio', {
      name: /Giữ ngày vào cũ \(01\/03\/2019\)/,
    });
    expect((keep as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Phòng ban/).value).toBe('Kho vận');
    expect(within(dialog).queryByLabelText(/^Ngày vào công ty/)).toBeNull();
    await u.click(within(dialog).getByRole('button', { name: 'Nhận lại' }));
    expect(await screen.findByText('Đã nhận lại Mia Trần')).toBeTruthy();
    expect(mock.db.company.profiles.get(mia.id).hireDate).toBe('2019-03-01');
  });

  it('/my-profile: nhân viên thấy 4 dòng chỉ đọc + thâm niên; Admin ⇒ không có hồ sơ', async () => {
    const { f, go } = open('/my-profile', 'EMPLOYEE');
    mock.db.company.profiles.set(f.owner.id, { hireDate: '2021-10-16', workPhone: '0901234567' });
    go();
    expect(await screen.findByRole('heading', { name: 'Hồ sơ của tôi' })).toBeTruthy();
    expect(await screen.findByText('16/10/2021 (4 năm 11 tháng)')).toBeTruthy();
    expect(screen.getByText('0901234567')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    await expectNoA11yViolations();
    cleanupApp();

    f.setCompanyAccess(f.owner, 'ADMIN');
    f.signInAs(f.owner);
    go();
    expect(await screen.findByText('Tài khoản Quản trị không có hồ sơ nhân viên')).toBeTruthy();
  });
});
