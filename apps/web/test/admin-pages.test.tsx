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

// T-065b /admin/* (ADR-134): phân quyền theo dòng (expectedVersion, luôn còn ≥ 1 Admin), workspace mồ côi (giao chủ
// cho thành viên còn lại / lưu trữ khi không còn ai), tên công ty. Chỉ Quản trị viên.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

function open(path: string, access: 'ADMIN' | 'HR' = 'ADMIN') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return f;
}

describe('/admin', () => {
  it('trang chính quản trị: 3 ô; HR (không phải Admin) ⇒ chặn + lối về; a11y', async () => {
    open('/admin');
    for (const name of [/^Phân quyền/, /^Workspace/, /^Thông tin công ty/]) {
      expect(await screen.findByRole('link', { name })).toBeTruthy();
    }
    await expectNoA11yViolations();
    cleanupApp();
    open('/admin/access', 'HR');
    expect(await screen.findByText('Chỉ Quản trị viên mở được trang này')).toBeTruthy();
  });

  it('phân quyền: cấp "Quản lý nhân sự" cho Pam ⇒ lưu theo dòng; Quản trị viên ⇒ ô quyền tắt; hạ Admin cuối cùng ⇒ câu rõ ràng', async () => {
    const f = open('/admin/access');
    const pam = f.addUser('Pam', `pam-${crypto.randomUUID()}@example.com`, 'MEMBER');
    cleanupApp();
    f.signInAs(f.owner);
    openApp(
      '/admin/access',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = userEvent.setup({ delay: null });
    const row = await screen.findByRole('listitem', { name: 'Pam' });
    const save = within(row).getByRole('button', { name: 'Lưu quyền của Pam' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await u.click(within(row).getByRole('checkbox', { name: 'Quản lý nhân sự — Pam' }));
    await u.click(save);
    expect(await screen.findByText('Đã lưu quyền của Pam')).toBeTruthy();
    expect(mock.db.company.row(pam.id)?.grants).toEqual(['HR_MANAGE']);

    const me = screen.getByRole('listitem', { name: f.owner.fullName });
    // Quản trị viên đã có mọi quyền ⇒ cả nhóm ô "quyền cấp thêm" bị tắt (fieldset disabled).
    const grant = within(me).getByRole('checkbox', {
      name: `Quản lý nhân sự — ${f.owner.fullName}`,
    });
    expect(grant.closest('fieldset')?.hasAttribute('disabled')).toBe(true);
    await u.selectOptions(
      within(me).getByRole('combobox', { name: `Vai trò của ${f.owner.fullName}` }),
      'EMPLOYEE',
    );
    await u.click(within(me).getByRole('button', { name: `Lưu quyền của ${f.owner.fullName}` }));
    expect(await screen.findByText('Phải còn ít nhất một Quản trị viên.')).toBeTruthy();
    expect(mock.db.company.row(f.owner.id)?.role).toBe('ADMIN');
  });

  it('workspace mồ côi lên đầu: còn thành viên ⇒ "Giao chủ sở hữu"; không còn ai ⇒ "Lưu trữ"', async () => {
    const f = seedBoard(mock);
    f.setCompanyAccess(f.owner, 'ADMIN');
    const vic = f.addUser('Vic', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
    act(() => mock.db.workspaces.removeMember(f.wsId, f.owner.id)); // OWNER duy nhất rời ⇒ mồ côi, Vic còn lại
    const empty = mock.db.createWorkspace('Phòng trống', undefined, vic.id);
    act(() => mock.db.workspaces.removeMember(empty, vic.id));
    f.signInAs(f.owner);
    openApp(
      '/admin/workspaces',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = userEvent.setup({ delay: null });
    const list = await screen.findByRole('list', { name: 'Danh sách workspace' });
    const orphan = within(list).getAllByRole('listitem')[0];
    expect(orphan?.textContent).toContain('Mồ côi');
    const wsName = mock.db.workspaces.all().find((w) => w.id === f.wsId)?.name ?? '';
    const row = within(list).getByRole('listitem', { name: wsName });
    await u.click(within(row).getByRole('button', { name: `Giao chủ sở hữu cho ${wsName}` }));
    const dialog = await screen.findByRole('dialog', { name: `Giao chủ sở hữu — ${wsName}` });
    await u.selectOptions(within(dialog).getByRole('combobox', { name: 'Người nhận' }), vic.id);
    await u.click(within(dialog).getByRole('button', { name: 'Giao' }));
    await waitFor(() => expect(within(row).getByText(/Chủ sở hữu: Vic/)).toBeTruthy());
    expect(mock.db.workspaces.member(f.wsId, vic.id)?.role).toBe('OWNER');

    const bare = within(list).getByRole('listitem', { name: 'Phòng trống' });
    await u.click(within(bare).getByRole('button', { name: 'Lưu trữ Phòng trống' }));
    const confirm = await screen.findByRole('dialog', { name: 'Lưu trữ Phòng trống?' });
    await u.click(within(confirm).getByRole('button', { name: 'Lưu trữ' }));
    await waitFor(() => expect(within(bare).getByText('Đã lưu trữ')).toBeTruthy());
  });

  it('tên công ty: đổi ⇒ lưu, header đổi theo /auth/me', async () => {
    open('/admin/company');
    const u = userEvent.setup({ delay: null });
    const input = await screen.findByLabelText(/^Tên công ty/);
    await u.clear(input);
    await u.type(input, 'Công ty ABC');
    await u.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã lưu tên công ty')).toBeTruthy();
    expect(mock.db.company.name).toBe('Công ty ABC');
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Công ty ABC'));
  });
});
