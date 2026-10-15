import type { Page } from '@playwright/test';

import {
  apiAddMember,
  apiAssign,
  apiCreateTask,
  apiGetTask,
  apiGetWorkspace,
  apiRegister,
  boardPath,
} from '../support/api';
import { waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { openAs } from '../support/users';

// T-034 — màn quản trị workspace / thành viên / dự án (frontend.md §8 + TL). Thao tác qua UI thật,
// seed qua API công khai. Tên nút trùng nhau (Xóa workspace, Xóa, Rời) ⇒ luôn khoanh trong dialog.
const toast = (page: Page, text: string | RegExp) =>
  page
    .getByRole('region', { name: /Thông báo/ })
    .getByText(text)
    .first();
const membersPath = (ws: string) => `/w/${ws}/settings/members`;

test('T-034: thêm thành viên theo email (+ email lạ ⇒ thông báo chung, không lộ tồn tại)', async ({
  page,
  request,
}) => {
  const a = newUser('adm-add');
  const b = newUser('adm-add-b');
  const sa = await apiRegister(request, a);
  await apiRegister(request, b);
  await loginViaUi(page, a);
  await page.goto(membersPath(sa.workspaceId));

  const form = page.getByRole('form', { name: 'Thêm thành viên' });
  await form.getByLabel('Email').fill(`nobody-${String(Date.now())}@e2e.example`);
  await form.getByRole('button', { name: 'Thêm' }).click();
  await expect(form.getByRole('alert')).toContainText('Không thể thêm người này');

  await form.getByLabel('Email').fill(b.email);
  await form.getByLabel('Vai trò').selectOption({ label: 'Thành viên' });
  await form.getByRole('button', { name: 'Thêm' }).click();
  await expect(toast(page, `Đã thêm ${b.fullName}`)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(b.fullName) })).toBeVisible();
});

test('T-034: hạ thành viên xuống Người xem ⇒ hộp xác nhận, task của họ bị bỏ giao', async ({
  page,
  request,
}) => {
  const a = newUser('adm-role');
  const b = newUser('adm-role-b');
  const sa = await apiRegister(request, a);
  const sb = await apiRegister(request, b);
  await apiAddMember(request, sa, b, 'MEMBER');
  const task = await apiAssign(
    request,
    sa,
    await apiCreateTask(request, sa, 'Giao cho B'),
    sb.userId,
  );
  await loginViaUi(page, a);
  await page.goto(membersPath(sa.workspaceId));

  await page
    .getByRole('combobox', { name: `Vai trò của ${b.fullName}` })
    .selectOption({ label: 'Người xem' });
  await page
    .getByRole('dialog', { name: `Hạ ${b.fullName} xuống Người xem?` })
    .getByRole('button', { name: 'Đổi vai trò' })
    .click();
  await expect(toast(page, 'Đã đổi vai trò')).toBeVisible();
  await expect(page.getByText('1 task được bỏ giao').first()).toBeVisible();
  const after = (await apiGetTask(request, sa, task.id)) as unknown as {
    assigneeId: string | null;
  };
  expect(after.assigneeId).toBeNull();
});

test('T-034: OWNER duy nhất tự hạ quyền ⇒ LAST_OWNER, vai trò giữ nguyên', async ({
  page,
  request,
}) => {
  const a = newUser('adm-last');
  const sa = await apiRegister(request, a);
  await loginViaUi(page, a);
  await page.goto(membersPath(sa.workspaceId));
  await page
    .getByRole('combobox', { name: `Vai trò của ${a.fullName}` })
    .selectOption({ label: 'Thành viên' });
  await page
    .getByRole('dialog', { name: 'Đổi vai trò của bạn thành Thành viên?' })
    .getByRole('button', { name: 'Đổi vai trò' })
    .click();
  await expect(toast(page, 'Workspace phải còn ít nhất một Chủ sở hữu')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: `Vai trò của ${a.fullName}` })).toHaveValue(
    'OWNER',
  );
});

test('T-034: OWNER xóa thành viên; thành viên tự rời ⇒ về /w', async ({
  page,
  browser,
  request,
}) => {
  const a = newUser('adm-rm');
  const b = newUser('adm-rm-b');
  const c = newUser('adm-rm-c');
  const sa = await apiRegister(request, a);
  await apiRegister(request, b);
  await apiRegister(request, c);
  await apiAddMember(request, sa, b, 'MEMBER');
  await apiAddMember(request, sa, c, 'MEMBER');
  await loginViaUi(page, a);
  await page.goto(membersPath(sa.workspaceId));
  await page.getByRole('button', { name: `Xóa ${b.fullName}` }).click();
  await page
    .getByRole('dialog', { name: `Xóa ${b.fullName} khỏi workspace?` })
    .getByRole('button', { name: 'Xóa', exact: true })
    .click();
  await expect(toast(page, 'Đã xóa')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(b.fullName) })).toHaveCount(0);

  const userC = await openAs(browser, c);
  await userC.page.goto(membersPath(sa.workspaceId));
  await userC.page.getByRole('button', { name: `Rời ${c.fullName}` }).click();
  await userC.page
    .getByRole('dialog', { name: 'Rời workspace này?' })
    .getByRole('button', { name: 'Rời', exact: true })
    .click();
  await expect(toast(userC.page, 'Bạn đã rời workspace')).toBeVisible();
  await expect(userC.page).toHaveURL(/\/w$/);
  await userC.close();
});

test('T-034: xóa workspace (gõ đúng slug) ⇒ /w; khôi phục ở khu "Đã xóa" ⇒ vào lại board', async ({
  page,
  request,
}) => {
  const a = newUser('adm-del');
  const sa = await apiRegister(request, a);
  const ws = await apiGetWorkspace(request, sa);
  await loginViaUi(page, a);
  await page.goto(`/w/${sa.workspaceId}/settings`);
  await page.getByRole('button', { name: 'Xóa workspace' }).click();
  const dialog = page.getByRole('dialog', { name: `Xóa ${ws.name}?` });
  const confirm = dialog.getByRole('button', { name: 'Xóa workspace' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Gõ "${ws.slug}" để xác nhận`).fill(ws.slug);
  await confirm.click();
  await expect(toast(page, `Đã xóa ${ws.name}`)).toBeVisible();
  await expect(page).toHaveURL(/\/w$/);

  await page.getByText(/Đã xóa — khôi phục được/).click();
  await page.getByRole('button', { name: `Khôi phục ${ws.name}` }).click();
  await expect(toast(page, `Đã khôi phục ${ws.name}`)).toBeVisible();
  await page.goto(boardPath(sa));
  await waitBoardReady(page);
});

test('T-034 + E2E-08: lưu trữ dự án qua UI ⇒ tab của người khác chuyển chỉ đọc ngay', async ({
  page,
  browser,
  request,
}) => {
  const a = newUser('adm-arc');
  const b = newUser('adm-arc-b');
  const sa = await apiRegister(request, a);
  await apiRegister(request, b);
  await apiAddMember(request, sa, b, 'MEMBER');
  const userB = await openAs(browser, b);
  await userB.page.goto(boardPath(sa));
  await waitBoardReady(userB.page);
  await expect(userB.page.getByRole('form', { name: 'Tạo task mới' })).toBeVisible();

  await loginViaUi(page, a);
  await page.goto(`${boardPath(sa)}/settings`);
  await page.getByRole('button', { name: 'Lưu trữ dự án' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu trữ', exact: true }).click();
  await expect(toast(page, 'Đã lưu trữ dự án')).toBeVisible();

  await expect(userB.page.getByText(/Dự án đã (được )?lưu trữ — chỉ đọc/).first()).toBeVisible({
    timeout: 2_000,
  });
  await expect(userB.page.getByRole('form', { name: 'Tạo task mới' })).toHaveCount(0);
  await userB.close();
});
