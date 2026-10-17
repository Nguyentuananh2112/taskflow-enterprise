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

// T-065b: /hr/employees (ADR-137) — thêm nhân viên + hộp link MỘT lần, tạo lại link, cho nghỉ / hủy lịch, nhận lại; HR
// không tác động chính mình / người giữ grant. Hôm nay theo mock: thứ 5 2026-10-15.

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

function open(access: 'HR' | 'ADMIN' = 'HR') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp(
    '/hr/employees',
    new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
  );
  return f;
}

const row = (name: string) => screen.findByRole('listitem', { name });

/** Nút "Thêm nhân viên" bật khi đã có "hôm nay" của server (mặc định / giới hạn ngày vào làm). */
async function addButton() {
  const button = await screen.findByRole('button', { name: 'Thêm nhân viên' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  return button;
}

describe('/hr/employees', () => {
  it('thêm nhân viên ⇒ hộp link MỘT lần (sao chép); đóng chưa sao chép ⇒ hỏi lại; dòng "Chờ kích hoạt"; a11y', async () => {
    open();
    const u = user();
    await u.click(await addButton());
    const form = await screen.findByRole('dialog', { name: 'Thêm nhân viên' });
    await u.type(within(form).getByLabelText(/^Email/), 'nina@example.com');
    await u.type(within(form).getByLabelText(/^Họ tên/), 'Nina');
    expect(within(form).getByLabelText<HTMLInputElement>(/^Ngày vào làm/).value).toBe('2026-10-15');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));

    const box = await screen.findByRole('dialog', { name: 'Link kích hoạt cho Nina' });
    const link = within(box).getByLabelText<HTMLInputElement>('Link').value;
    expect(link).toMatch(/\/activate#t=[\w-]{40,}$/);
    await expectNoA11yViolations();
    await u.click(within(box).getByRole('button', { name: 'Xong' }));
    expect(within(box).getByText(/Bạn chưa sao chép link/)).toBeTruthy();
    await u.click(within(box).getByRole('button', { name: 'Sao chép link' }));
    // user-event cài clipboard giả của nó ⇒ đọc lại đúng thứ đã sao chép.
    expect(await navigator.clipboard.readText()).toBe(link);
    await u.click(within(box).getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(await row('Nina')).getByText('Chờ kích hoạt')).toBeTruthy();
  });

  it('ngày vào trước hôm nay ⇒ cảnh báo vắng; email đang làm ⇒ câu rõ ràng', async () => {
    const f = open();
    const u = user();
    await u.click(await addButton());
    const form = await screen.findByRole('dialog', { name: 'Thêm nhân viên' });
    const date = within(form).getByLabelText<HTMLInputElement>(/^Ngày vào làm/);
    expect([date.min, date.max]).toEqual(['2026-09-14', '2026-10-15']);
    await u.clear(date);
    await u.type(date, '2026-10-01');
    expect(within(form).getByText(/từ 01\/10\/2026 đến hôm qua sẽ tính là vắng/)).toBeTruthy();
    await u.type(within(form).getByLabelText(/^Email/), f.owner.email);
    await u.type(within(form).getByLabelText(/^Họ tên/), 'Lan 2');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect(await within(form).findByText('Email này đang là nhân viên của công ty.')).toBeTruthy();
  });

  it('cho nghỉ việc ⇒ cảnh báo workspace sẽ mồ côi; "Sắp nghỉ" ⇒ Hủy lịch nghỉ; chính mình (HR) ⇒ khóa', async () => {
    const f = open();
    const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    const u = user();
    expect(within(await row(f.owner.fullName)).getByText('Quản trị viên xử lý')).toBeTruthy();
    await u.click(
      within(await row('Mia Trần')).getByRole('button', { name: 'Cho Mia Trần nghỉ việc' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cho Mia Trần nghỉ việc' });
    await u.click(within(dialog).getByRole('button', { name: 'Lên lịch nghỉ việc' }));
    const done = await screen.findByRole('dialog', { name: 'Đã lên lịch nghỉ việc cho Mia Trần' });
    expect(done.textContent).toContain('Workspace của Mia Trần');
    await u.click(within(done).getByRole('button', { name: 'Đóng' }));
    const mine = await row('Mia Trần');
    await waitFor(() => expect(within(mine).getByText('Sắp nghỉ')).toBeTruthy());
    await u.click(within(mine).getByRole('button', { name: 'Hủy lịch nghỉ việc của Mia Trần' }));
    await waitFor(() => expect(within(mine).getByText('Đang làm')).toBeTruthy());
    expect(mock.db.company.row(mia.id)?.offboardLastDay).toBeNull();
  });

  it('đã nghỉ (có mật khẩu) ⇒ "Nhận lại" không cần link; chờ kích hoạt ⇒ "Tạo lại link" thu hồi link cũ', async () => {
    const f = open('ADMIN');
    const quinn = f.addUser('Quinn', `quinn-${crypto.randomUUID()}@example.com`, 'MEMBER');
    act(() => mock.db.company.remove(quinn.id));
    const nina = mock.db.createUser({
      email: 'nina@example.com',
      password: '',
      fullName: 'Nina',
      workspace: false,
    }).user;
    const old = mock.db.company.issueToken(nina.id, mock.db.now(), 86_400_000).token;
    const u = user();
    await u.click(within(await row('Nina')).getByRole('button', { name: 'Tạo lại link cho Nina' }));
    await screen.findByRole('dialog', { name: 'Link kích hoạt cho Nina' });
    expect(mock.db.company.lookup(old, mock.db.now())).toBe('gone');
    cleanupApp();

    f.signInAs(f.owner);
    openApp(
      '/hr/employees?status=left',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    await u.click(within(await row('Quinn')).getByRole('button', { name: 'Nhận lại Quinn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nhận lại Quinn' });
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Email/).readOnly).toBe(true);
    await u.click(within(dialog).getByRole('button', { name: 'Nhận lại' }));
    expect(await screen.findByText('Đã nhận lại Quinn')).toBeTruthy();
    expect(mock.db.company.row(quinn.id)).toBeDefined();
  });

  it('nhân viên thường ⇒ "không có quyền" + lối về', async () => {
    const f = seedBoard(mock);
    f.signInAs(f.owner);
    openApp(
      '/hr/employees',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    expect(await screen.findByText('Bạn không có quyền Quản lý nhân sự')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về trang chính' }).getAttribute('href')).toBe('/w');
  });
});
