import type { APIRequestContext, Browser, Page } from '@playwright/test';

import {
  apiAddMember,
  apiArchiveProject,
  apiAssign,
  apiChangeRole,
  apiCreateTask,
  apiDeleteWorkspace,
  apiRegister,
  apiRemoveMember,
  apiRestoreWorkspace,
  boardPath,
  type Seeded,
} from '../support/api';
import { card, column, waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { openAs } from '../support/users';

// frontend.md §8 — nhiều người, realtime thật (Socket.io qua API). Di chuyển dùng menu "Thao tác với …"
// (kéo thả có kịch bản riêng ở kanban.e2e.ts). Ngưỡng realtime theo T-026: < 2s.
const REALTIME = { timeout: 2_000 };

async function openBoard(page: Page, s: Seeded): Promise<void> {
  await page.goto(boardPath(s));
  await waitBoardReady(page);
  await expect(page.getByText('Trực tuyến')).toBeVisible();
}

async function moveViaMenu(page: Page, key: string, target: string): Promise<void> {
  await page.getByRole('button', { name: `Thao tác với ${key}` }).click();
  await page.getByRole('menuitem', { name: `Chuyển tới ${target}` }).click();
}

/** A (OWNER, đăng nhập ở `page`) + B (role tùy chọn) trong context riêng, cả hai mở cùng board. */
async function ownerAndMember(
  page: Page,
  browser: Browser,
  request: APIRequestContext,
  role: 'MEMBER' | 'VIEWER' | 'PM',
) {
  const a = newUser('owner');
  const b = newUser(role.toLowerCase());
  const sa = await apiRegister(request, a);
  const sb = await apiRegister(request, b);
  await apiAddMember(request, sa, b, role);
  await loginViaUi(page, a);
  await openBoard(page, sa);
  const userB = await openAs(browser, b);
  await openBoard(userB.page, sa);
  return { a, b, sa, bId: sb.userId, userB };
}

test('E2E-05: realtime 2 người (< 2s) + workspace khác không nhận gì', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  const task = await apiCreateTask(request, sa, 'Realtime A→B');
  await expect(card(column(userB.page, 'TODO'), 'Realtime A→B')).toBeVisible(REALTIME);

  // Người ngoài (workspace khác) nghe mọi frame socket của chính mình: không được thấy dữ liệu của A.
  const outsider = newUser('outsider');
  const so = await apiRegister(request, outsider);
  const userC = await openAs(browser, outsider);
  const frames: string[] = [];
  userC.page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  await openBoard(userC.page, so);

  await moveViaMenu(page, task.key, 'Đang làm');
  await expect(card(column(userB.page, 'IN_PROGRESS'), 'Realtime A→B')).toBeVisible(REALTIME);

  await userB.page.getByLabel('Task mới', { exact: true }).fill('Realtime B→A');
  await userB.page.getByRole('button', { name: 'Tạo task' }).click();
  await expect(card(column(page, 'TODO'), 'Realtime B→A')).toBeVisible(REALTIME);

  expect(frames.join('\n')).not.toMatch(/Realtime A→B|Realtime B→A/);
  await userC.close();
  await userB.close();
});

test('E2E-06: xung đột sửa tiêu đề ⇒ B thấy khối hòa giải; sửa mô tả sau khi A chỉ kéo ⇒ tự rebase', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  const task = await apiCreateTask(request, sa, 'Bản gốc');
  await expect(card(column(userB.page, 'TODO'), 'Bản gốc')).toBeVisible(REALTIME);
  await expect(card(column(page, 'TODO'), 'Bản gốc')).toBeVisible(REALTIME);

  const openDrawer = (p: Page, status: 'TODO' | 'IN_PROGRESS', title: string) =>
    card(column(p, status), title).getByRole('button', { name: title }).click();
  const patchOf = (p: Page) =>
    p.waitForResponse(
      (res) => res.url().endsWith(`/tasks/${task.id}`) && res.request().method() === 'PATCH',
    );
  // Drawer là dialog modal ⇒ nền bị ẩn khỏi cây a11y: kiểm thẻ sau khi đóng drawer (nút Đóng).
  const closeDrawer = (p: Page) =>
    p.getByRole('dialog').getByRole('button', { name: 'Đóng' }).click();
  await openDrawer(page, 'TODO', 'Bản gốc');
  await openDrawer(userB.page, 'TODO', 'Bản gốc');

  const savedA = patchOf(page);
  await page.getByRole('dialog').getByLabel('Tiêu đề', { exact: true }).fill('Tiêu đề của A');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  expect((await savedA).ok()).toBe(true);
  await closeDrawer(page);
  await expect(card(column(page, 'TODO'), 'Tiêu đề của A')).toBeVisible();

  // B vẫn cầm version cũ ⇒ 409 + khối hòa giải nêu đúng trường "Tiêu đề".
  const conflict = patchOf(userB.page);
  await userB.page.getByRole('dialog').getByLabel('Tiêu đề', { exact: true }).fill('Tiêu đề của B');
  await userB.page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  expect((await conflict).status()).toBe(409);
  const banner = userB.page.getByRole('alert').filter({ hasText: 'vừa được người khác sửa' });
  await expect(banner).toContainText('"Tiêu đề"');
  const kept = patchOf(userB.page);
  await banner.getByRole('button', { name: 'Giữ bản của tôi' }).click();
  expect((await kept).ok()).toBe(true);
  await closeDrawer(userB.page);
  await expect(card(column(page, 'TODO'), 'Tiêu đề của B')).toBeVisible(REALTIME);

  // B mở drawer (version hiện tại), rồi A chỉ di chuyển task (status/rank) ⇒ B sửa mô tả lưu thẳng,
  // KHÔNG có khối hòa giải (tự rebase vì không trùng trường).
  await openDrawer(userB.page, 'TODO', 'Tiêu đề của B');
  await moveViaMenu(page, task.key, 'Đang làm');
  await expect(card(column(page, 'IN_PROGRESS'), 'Tiêu đề của B')).toBeVisible();
  // Tự rebase có thể là 409 rồi web tự gửi lại ⇒ chờ PATCH THÀNH CÔNG (không chấp nhận 409 cuối cùng).
  const rebased = userB.page.waitForResponse(
    (res) =>
      res.url().endsWith(`/tasks/${task.id}`) && res.request().method() === 'PATCH' && res.ok(),
  );
  await userB.page.getByRole('dialog').getByLabel('Mô tả', { exact: true }).fill('Mô tả của B');
  await userB.page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await rebased;
  await expect(userB.page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  await expect(
    userB.page.getByRole('alert').filter({ hasText: 'vừa được người khác sửa' }),
  ).toHaveCount(0);
  await userB.close();
});

test('E2E-07: VIEWER không thấy Tạo task, không có tay kéo, drawer chỉ đọc', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'VIEWER');
  const task = await apiCreateTask(request, sa, 'Chỉ xem');
  const v = userB.page;
  await expect(card(column(v, 'TODO'), 'Chỉ xem')).toBeVisible(REALTIME);
  await expect(v.getByRole('form', { name: 'Tạo task mới' })).toHaveCount(0);
  await expect(v.getByRole('button', { name: `Kéo ${task.key}` })).toHaveCount(0);
  await expect(v.getByRole('button', { name: `Thao tác với ${task.key}` })).toHaveCount(0);
  await card(column(v, 'TODO'), 'Chỉ xem').getByRole('button', { name: 'Chỉ xem' }).click();
  await expect(v.getByRole('dialog')).toBeVisible();
  await expect(v.getByRole('form', { name: 'Sửa task' })).toHaveCount(0);
  await userB.close();
});

test('E2E-08: A lưu trữ project khi B đang mở board ⇒ B thấy banner chỉ đọc ngay', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  await expect(userB.page.getByRole('form', { name: 'Tạo task mới' })).toBeVisible();
  await apiArchiveProject(request, sa);
  await expect(userB.page.getByText('Dự án đã được lưu trữ — chỉ đọc')).toBeVisible(REALTIME);
  await expect(userB.page.getByRole('form', { name: 'Tạo task mới' })).toHaveCount(0);
  await userB.close();
});

test('E2E-09: A xóa B khỏi workspace khi B đang mở board ⇒ B về /w + toast', async ({
  page,
  browser,
  request,
}) => {
  const { sa, bId, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  await apiRemoveMember(request, sa, bId);
  await expect(userB.page).toHaveURL(/\/w$/, REALTIME);
  await expect(
    userB.page.getByText('Bạn không còn truy cập được workspace này').first(),
  ).toBeVisible();
  await userB.close();
});

test('E2E-13: offline rồi online ⇒ board tự refetch, thấy thay đổi của người khác lúc offline', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  await userB.context.setOffline(true);
  await apiCreateTask(request, sa, 'Tạo lúc B offline');
  await expect(card(column(page, 'TODO'), 'Tạo lúc B offline')).toBeVisible(REALTIME);
  await expect(card(column(userB.page, 'TODO'), 'Tạo lúc B offline')).toHaveCount(0);
  await userB.context.setOffline(false);
  await expect(card(column(userB.page, 'TODO'), 'Tạo lúc B offline')).toBeVisible({
    timeout: 15_000,
  });
  await userB.close();
});

test('E2E-14: A xóa workspace khi B mở board ⇒ B về /w + toast; khôi phục ⇒ B vào lại được', async ({
  page,
  browser,
  request,
}) => {
  const { sa, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  await apiDeleteWorkspace(request, sa);
  await expect(userB.page).toHaveURL(/\/w$/, REALTIME);
  await expect(
    userB.page.getByText('Bạn không còn truy cập được workspace này').first(),
  ).toBeVisible();
  // Khôi phục qua UI "Đã xóa" thuộc T-034 (chưa merge) ⇒ tạm qua API công khai.
  await apiRestoreWorkspace(request, sa);
  await openBoard(userB.page, sa);
  await userB.close();
});

test('E2E-15: A hạ B (MEMBER, đang được giao 2 task) xuống VIEWER ⇒ B mất tay kéo, 2 task "Chưa giao"', async ({
  page,
  browser,
  request,
}) => {
  const { sa, bId, userB } = await ownerAndMember(page, browser, request, 'MEMBER');
  const t1 = await apiAssign(request, sa, await apiCreateTask(request, sa, 'Giao B 1'), bId);
  const t2 = await apiAssign(request, sa, await apiCreateTask(request, sa, 'Giao B 2'), bId);
  await expect(userB.page.getByRole('button', { name: `Kéo ${t1.key}` })).toBeVisible(REALTIME);
  await apiChangeRole(request, sa, bId, 'VIEWER');
  for (const p of [page, userB.page]) {
    for (const title of ['Giao B 1', 'Giao B 2']) {
      await expect(card(column(p, 'TODO'), title)).toContainText('Chưa giao', REALTIME);
    }
  }
  await expect(userB.page.getByRole('button', { name: `Kéo ${t1.key}` })).toHaveCount(0);
  await expect(userB.page.getByRole('button', { name: `Kéo ${t2.key}` })).toHaveCount(0);
  await userB.close();
});
