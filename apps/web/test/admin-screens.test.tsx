import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard, type BoardFixture } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-034: màn quản trị workspace / thành viên / project trên mock API khắt khe như server + socket giả
// (phòng user:{id}, membership thật). Quyền ẩn/hiện theo role; server vẫn là chốt chặn.

let mock: ReturnType<typeof startMockApi>;
let fx: BoardFixture;
let hub: FakeRealtimeHub;

beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function fresh() {
  fx = seedBoard(mock);
  hub = new FakeRealtimeHub(mock.board, mock.db);
  return fx;
}
const user = () => userEvent.setup({ delay: null });
const tabFor = (userId: string) => hub.client(getClientId(), userId);
const toastText = () =>
  [...document.querySelectorAll('[role="status"], li')]
    .map((el) => el.textContent ?? '')
    .join(' | ');

describe('cài đặt workspace', () => {
  it('OWNER đổi tên; slug chữ hoa bị chặn ở client; slug dành riêng ⇒ lỗi tại field (R19); a11y', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings`, tabFor(f.owner.id));
    const name = await screen.findByLabelText<HTMLInputElement>(/^Tên workspace/);
    await expectNoA11yViolations();
    const u = user();
    await u.clear(name);
    await u.type(name, 'Phòng Kỹ thuật');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mock.db.workspaces.active(f.wsId)?.name).toBe('Phòng Kỹ thuật'));

    const slug = screen.getByLabelText<HTMLInputElement>(/^Slug/);
    await u.clear(slug);
    await u.type(slug, 'Phong-KT');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(slug.getAttribute('aria-invalid')).toBe('true'));
    expect(mock.db.workspaces.active(f.wsId)?.slug).not.toBe('Phong-KT');

    await u.clear(slug);
    await u.type(slug, 'admin');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Slug đã được dùng hoặc là tên dành riêng.')).toBeTruthy();
  });

  it('xóa: phải gõ ĐÚNG slug (không trim/lowercase) ⇒ về /w; khu "Đã xóa" cho OWNER khôi phục được', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings`, tabFor(f.owner.id));
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Xóa workspace' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('xóa vĩnh viễn sau 30 ngày');
    const slug = mock.db.workspaces.active(f.wsId)?.slug ?? '';
    const confirmBtn = within(dialog).getByRole('button', { name: 'Xóa workspace' });
    await u.type(within(dialog).getByRole('textbox'), ` ${slug.toUpperCase()}`);
    expect(confirmBtn).toHaveProperty('disabled', true);
    await u.clear(within(dialog).getByRole('textbox'));
    await u.type(within(dialog).getByRole('textbox'), slug);
    await u.click(confirmBtn);
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(mock.db.workspaces.active(f.wsId)).toBeUndefined();

    // /w: khu đã xóa (OWNER) ⇒ khôi phục.
    cleanupApp();
    f.signInAs(f.owner);
    openApp('/w', tabFor(f.owner.id));
    const section = await screen.findByText(/Đã xóa — khôi phục được \(1\)/);
    await u.click(section);
    await u.click(await screen.findByRole('button', { name: /^Khôi phục/ }));
    await waitFor(() => expect(mock.db.workspaces.active(f.wsId)).toBeDefined());
    await expectNoA11yViolations();
  });

  it('MEMBER: chỉ xem — ô chỉ đọc, không nút Lưu, không vùng nguy hiểm', async () => {
    const f = fresh();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.signInAs(an);
    openApp(`/w/${f.wsId}/settings`, tabFor(an.id));
    expect((await screen.findByLabelText<HTMLInputElement>(/^Tên workspace/)).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
    expect(screen.queryByText('Vùng nguy hiểm')).toBeNull();
  });
});

describe('thành viên', () => {
  it('OWNER thêm theo email; email lạ và người đã là thành viên cùng MỘT câu chung (§6.5); a11y', async () => {
    const f = fresh();
    mock.db.createUser({ email: 'hoa@example.com', password: 'x', fullName: 'Mai Hoa' });
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings/members`, tabFor(f.owner.id));
    const form = await screen.findByRole('form', { name: 'Thêm thành viên' });
    await expectNoA11yViolations();
    const u = user();
    await u.type(within(form).getByLabelText('Email'), 'hoa@example.com');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect((await screen.findAllByRole('cell', { name: /Mai Hoa/ })).length).toBeGreaterThan(0);

    const generic = /Không thể thêm người này/;
    await u.type(within(form).getByLabelText('Email'), 'khong-co@example.com');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(generic);
    await u.clear(within(form).getByLabelText('Email'));
    await u.type(within(form).getByLabelText('Email'), 'hoa@example.com');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toMatch(generic));
  });

  it('PM: chỉ cấp Thành viên/Người xem; không đổi role; không có nút xóa OWNER', async () => {
    const f = fresh();
    const pm = f.addUser('Quản Lý', 'pm@example.com', 'PM');
    f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.signInAs(pm);
    openApp(`/w/${f.wsId}/settings/members`, tabFor(pm.id));
    const role = await screen.findByRole('combobox', { name: 'Vai trò' });
    expect([...(role as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Thành viên',
      'Người xem',
    ]);
    await screen.findByRole('cell', { name: /Nguyễn An/ });
    expect(screen.queryByRole('combobox', { name: /^Vai trò của/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa Trần Lan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xóa Nguyễn An' })).toBeTruthy();
  });

  it('hạ xuống Người xem: xác nhận trước, báo số task được bỏ giao (ADR-044); OWNER cuối ⇒ LAST_OWNER', async () => {
    const f = fresh();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    for (const title of ['Việc một', 'Việc hai']) {
      await f.apiAs(f.owner, 'POST', f.tasksPath, { title, assigneeId: an.id });
    }
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings/members`, tabFor(f.owner.id));
    const u = user();
    await u.selectOptions(
      await screen.findByRole('combobox', { name: 'Vai trò của Nguyễn An' }),
      'VIEWER',
    );
    const dialog = await screen.findByRole('dialog', { name: /Hạ Nguyễn An xuống Người xem/ });
    expect(dialog.textContent).toMatch(/bị bỏ giao/);
    await u.click(within(dialog).getByRole('button', { name: 'Đổi vai trò' }));
    expect(await screen.findByText('2 task được bỏ giao')).toBeTruthy();
    expect(mock.db.workspaces.member(f.wsId, an.id)?.role).toBe('VIEWER');

    await u.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Trần Lan' }), 'PM');
    expect(await screen.findByText('Workspace phải còn ít nhất một Chủ sở hữu')).toBeTruthy();
    expect(mock.db.workspaces.member(f.wsId, f.owner.id)?.role).toBe('OWNER');
  });

  it('tự rời ⇒ về /w, đúng MỘT thông báo (không toast trùng từ realtime)', async () => {
    const f = fresh();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.signInAs(an);
    const tab = tabFor(an.id);
    openApp(`/w/${f.wsId}/settings/members`, tab);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Rời Nguyễn An' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Rời' }));
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(await screen.findByText('Bạn đã rời workspace')).toBeTruthy();
    expect(screen.queryByText('Bạn không còn truy cập được workspace này')).toBeNull();
    expect(mock.db.workspaces.member(f.wsId, an.id)).toBeUndefined();
  });

  it('realtime: bị OWNER xóa khi đang ở màn thành viên ⇒ về /w + toast; bị hạ role ⇒ quyền đổi ngay', async () => {
    const f = fresh();
    const pm = f.addUser('Quản Lý', 'pm@example.com', 'PM');
    f.signInAs(pm);
    const tab = tabFor(pm.id);
    openApp(`/w/${f.wsId}/settings/members`, tab);
    await screen.findByRole('form', { name: 'Thêm thành viên' });
    await act(() =>
      f.apiAs(f.owner, 'PATCH', `/workspaces/${f.wsId}/members/${pm.id}`, { role: 'MEMBER' }),
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Thêm thành viên' })).toBeNull());

    await act(() => f.apiAs(f.owner, 'DELETE', `/workspaces/${f.wsId}/members/${pm.id}`));
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(await screen.findByText('Bạn không còn truy cập được workspace này')).toBeTruthy();
    expect(tab.rooms.has(`user:${pm.id}`)).toBe(true);
    expect(toastText()).toBeTruthy();
  });
});

describe('project', () => {
  it('PM tạo dự án từ danh sách (keyPrefix trùng ⇒ lỗi tại field) rồi vào board', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/projects`, tabFor(f.owner.id));
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Tạo dự án' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tạo dự án' });
    await u.type(within(dialog).getByLabelText(/^Tên dự án/), 'Website');
    await u.type(within(dialog).getByLabelText(/^Mã dự án/), 'TF');
    await u.click(within(dialog).getByRole('button', { name: 'Tạo dự án' }));
    expect(await within(dialog).findByText('Mã này đã được dùng trong workspace.')).toBeTruthy();
    await u.clear(within(dialog).getByLabelText(/^Mã dự án/));
    await u.type(within(dialog).getByLabelText(/^Mã dự án/), 'WEB');
    await u.click(within(dialog).getByRole('button', { name: 'Tạo dự án' }));
    await waitFor(() =>
      expect(window.location.pathname).toMatch(new RegExp(`^/w/${f.wsId}/p/[0-9a-f-]+$`)),
    );
    expect(await screen.findByRole('heading', { level: 1, name: /Website/ })).toBeTruthy();
  });

  it('cài đặt dự án: sửa tên; lưu trữ ⇒ chỉ đọc + banner; khôi phục; MEMBER chỉ xem; a11y', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/p/${f.project.id}/settings`, tabFor(f.owner.id));
    const name = await screen.findByLabelText<HTMLInputElement>(/^Tên dự án/);
    await expectNoA11yViolations();
    const u = user();
    await u.clear(name);
    await u.type(name, 'Dự án Web');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(mock.board.getProject(f.wsId, f.project.id)?.name).toBe('Dự án Web'),
    );
    expect(screen.getByLabelText<HTMLInputElement>('Mã dự án').readOnly).toBe(true);

    await u.click(screen.getByRole('button', { name: 'Lưu trữ dự án' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lưu trữ' }),
    );
    expect(await screen.findByText(/Dự án đã lưu trữ — chỉ đọc/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Tên dự án/).readOnly).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Khôi phục dự án' }));
    await waitFor(() =>
      expect(mock.board.getProject(f.wsId, f.project.id)?.isArchived).toBe(false),
    );

    cleanupApp();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.signInAs(an);
    openApp(`/w/${f.wsId}/p/${f.project.id}/settings`, tabFor(an.id));
    expect((await screen.findByLabelText<HTMLInputElement>(/^Tên dự án/)).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /Lưu trữ dự án|Lưu thay đổi/ })).toBeNull();
  });
});

describe('tạo workspace', () => {
  it('/w ⇒ Tạo workspace ⇒ slug tự sinh ⇒ vào danh sách dự án (có sẵn "Dự án đầu tiên")', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp('/w', tabFor(f.owner.id));
    const u = user();
    // next/link không đi qua router giả ⇒ kiểm đích của link rồi mở trang đó.
    expect(await screen.findByRole('link', { name: 'Tạo workspace' })).toHaveProperty(
      'pathname',
      '/w/new',
    );
    cleanupApp();
    f.signInAs(f.owner);
    openApp('/w/new', tabFor(f.owner.id));
    await u.type(await screen.findByLabelText(/^Tên workspace/), 'Phòng Thiết kế');
    await u.click(screen.getByRole('button', { name: 'Tạo workspace' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/w\/[0-9a-f-]+\/projects$/));
    expect(await screen.findByText('Dự án đầu tiên')).toBeTruthy();
  });
});
