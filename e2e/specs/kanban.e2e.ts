import { apiCreateTask, apiMoveTask, apiRegister, boardPath } from '../support/api';
import { card, column, dragByMouse, titlesIn, waitBoardReady } from '../support/board';
import { API_URL } from '../support/env';
import { expect, loginViaUi, newUser, registerViaUi, test } from '../support/fixtures';

// frontend.md §8 E2E-01..04 trên API thật (Prisma) + web production.

test('@main E2E-01: đăng ký → workspace → project mặc định → tạo task ⇒ ở cuối cột Cần làm', async ({
  page,
}) => {
  await registerViaUi(page, newUser('e2e01'));
  // /w ⇒ workspace mặc định ⇒ danh sách project ⇒ project mặc định (chỉ bấm, không goto).
  // Thẻ workspace (tên gồm vai trò) — từ T-034 trang /w còn có link "Tạo workspace".
  await page
    .getByRole('main')
    .getByRole('link', { name: /Chủ sở hữu/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/projects/);
  // Thẻ dự án (href /p/…) — header trang còn link "Thành viên" / "Cài đặt" (T-034).
  await page.locator('main a[href*="/p/"]').first().click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/p\/[^/]+/);
  await waitBoardReady(page);

  for (const title of ['Task thứ nhất', 'Task thứ hai']) {
    const created = page.waitForResponse(
      (res) =>
        res.url().startsWith(API_URL) &&
        /\/tasks$/.test(res.url()) &&
        res.request().method() === 'POST',
    );
    await page.getByLabel('Task mới', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Tạo task' }).click();
    expect((await created).status()).toBe(201);
    await expect(card(column(page, 'TODO'), title)).toBeVisible();
  }
  await expect.poll(() => titlesIn(page, 'TODO')).toEqual(['Task thứ nhất', 'Task thứ hai']);
});

test('@main E2E-02: kéo Cần làm → Đang làm bằng chuột; reload ⇒ vẫn đúng cột (refresh sau reload)', async ({
  page,
  request,
}) => {
  const user = newUser('e2e02');
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, 'Kéo tôi đi');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);

  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}`) && res.request().method() === 'PATCH',
  );
  await dragByMouse(
    page,
    page.getByRole('button', { name: `Kéo ${task.key}` }),
    column(page, 'IN_PROGRESS'),
  );
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Kéo tôi đi')).toBeVisible();

  await page.reload();
  await waitBoardReady(page);
  await expect(card(column(page, 'IN_PROGRESS'), 'Kéo tôi đi')).toBeVisible();
  await expect(card(column(page, 'TODO'), 'Kéo tôi đi')).toHaveCount(0);
});

test('E2E-04: kéo Cần làm → Hoàn thành bị chặn (state machine) ⇒ KHÔNG có PATCH, thẻ ở lại', async ({
  page,
  request,
}) => {
  const user = newUser('e2e04');
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, 'Không được nhảy cóc');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);

  const patches: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/tasks/')) patches.push(req.url());
  });
  // Đối chứng (không xanh giả nếu kéo không kích hoạt): giữa lúc kéo, cột Hoàn thành báo bị chặn.
  await dragByMouse(
    page,
    page.getByRole('button', { name: `Kéo ${task.key}` }),
    column(page, 'DONE'),
    () =>
      expect(column(page, 'DONE')).toHaveAttribute(
        'title',
        /Không thể chuyển từ Cần làm sang Hoàn thành/,
      ),
  );
  await expect(card(column(page, 'TODO'), 'Không được nhảy cóc')).toBeVisible();
  // Đối chứng không cần timeout cố định: request của chính trang đã hết (networkidle) mà vẫn 0 PATCH.
  await page.waitForLoadState('networkidle');
  expect(patches).toEqual([]);
});

// E2 (fix/dnd-keyboard-empty-column): trước đây đỏ tất định — sortable lấy group từ task.status nên
// SortableKeyboardPlugin tưởng thẻ chưa đổi cột và kéo về. Cổng của bản sửa.
test('E2E-03: kéo bằng BÀN PHÍM vào cột TRỐNG (Space, mũi tên phải, Space) ⇒ Cần làm → Đang làm', async ({
  page,
  request,
}) => {
  const user = newUser('e2e03');
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, 'Bàn phím');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);

  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}/move`) && res.request().method() === 'PATCH',
  );
  const handle = page.getByRole('button', { name: `Kéo ${task.key}` });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press('Space');
  // Chờ theo điều kiện từng bước (không đoán thời gian): đã nhấc ⇒ đích nhận ⇒ mới thả.
  await expect(page.locator('[data-dnd-dragging]')).not.toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  // Chờ 2 khung hình cho dnd-kit ổn định (người dùng thật không nhấn trong ~20ms): nếu không, test chỉ
  // xanh khi Space lọt vào khoảnh khắc ring nhấp nháy — trước đó đỏ 2/5 ngẫu nhiên (đã điều tra).
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.keyboard.press('Space');
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Bàn phím')).toBeVisible();
});

test('@main Menu thao tác: "Chuyển tới Đang làm" (đường thay thế không kéo) ⇒ PATCH /move, thẻ đổi cột', async ({
  page,
  request,
}) => {
  const user = newUser('menu');
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, 'Qua menu');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);

  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}/move`) && res.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: `Thao tác với ${task.key}` }).click();
  await page.getByRole('menuitem', { name: 'Chuyển tới Đang làm' }).click();
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Qua menu')).toBeVisible();
});

test('E2E-03b: kéo bằng bàn phím vào cột ĐÃ CÓ thẻ ⇒ PATCH /move, thẻ đổi cột', async ({
  page,
  request,
}) => {
  const user = newUser('e2e03b');
  const s = await apiRegister(request, user);
  await apiMoveTask(request, s, await apiCreateTask(request, s, 'Neo ở Đang làm'), 'IN_PROGRESS');
  const task = await apiCreateTask(request, s, 'Đi bằng phím');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);

  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}/move`) && res.request().method() === 'PATCH',
  );
  const handle = page.getByRole('button', { name: `Kéo ${task.key}` });
  await expect(handle).toBeEnabled();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dnd-dragging]')).not.toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.keyboard.press('Space');
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Đi bằng phím')).toBeVisible();
});
