import type { Locator, Page } from '@playwright/test';

import { apiCreateTask, apiRegister, boardPath } from '../support/api';
import { card, column, dragByMouse, waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';

// feat/card-drag-whole (yêu cầu người dùng): kéo bằng CẢ THẺ, không chỉ tay cầm ⠿.
// Chuột: dời ≥ 6 px mới kéo ⇒ bấm-thả tại chỗ vẫn mở drawer. Cảm ứng: giữ 250 ms mới kéo ⇒ vuốt vẫn
// cuộn. Nút "⋯" không bao giờ khởi động kéo. Bàn phím không đổi (E2E-03 trong kanban.e2e.ts).

async function setup(
  page: Page,
  request: Parameters<typeof apiRegister>[0],
  label: string,
  title: string,
) {
  const user = newUser(label);
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, title);
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);
  return { s, task, todoCard: card(column(page, 'TODO'), title) };
}

const watchPatches = (page: Page) => {
  const patches: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/tasks/')) patches.push(req.url());
  });
  return patches;
};

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('không lấy được vị trí');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('@main CD-01: chuột nắm GIỮA thẻ (không phải ⠿) kéo Cần làm → Đang làm', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'chuột — dự án mobile kiểm bằng cảm ứng (CD-04)');
  const { task, todoCard } = await setup(page, request, 'cd01', 'Nắm giữa thẻ');
  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}/move`) && res.request().method() === 'PATCH',
  );
  // dragByMouse nắm tâm của locator truyền vào — ở đây là TÂM THẺ (trúng tiêu đề), không phải tay cầm.
  await dragByMouse(page, todoCard, column(page, 'IN_PROGRESS'));
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Nắm giữa thẻ')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // kéo xong không mở drawer
});

test('CD-02: bấm-thả tại chỗ trên tiêu đề (kể cả giữ lâu) ⇒ mở drawer, KHÔNG kéo', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'chuột');
  const { todoCard } = await setup(page, request, 'cd02', 'Bấm để mở');
  const patches = watchPatches(page);
  const at = await centerOf(todoCard.getByRole('button', { name: 'Bấm để mở' }));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 3, at.y + 2, { steps: 3 }); // run tay < 6 px
  await page.waitForTimeout(400); // giữ lâu hơn ngưỡng 200 ms mặc định của dnd-kit (đã bỏ)
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/[?&]task=/);
  await page.waitForLoadState('networkidle');
  expect(patches).toEqual([]);
});

test('CD-03: nhấn trên nút "⋯" rồi rê 60 px ⇒ KHÔNG kéo; nút vẫn mở menu', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'chuột');
  const { task, todoCard } = await setup(page, request, 'cd03', 'Menu không kéo');
  const patches = watchPatches(page);
  const menu = page.getByRole('button', { name: `Thao tác với ${task.key}` });
  const at = await centerOf(menu);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 10, { steps: 10 });
  await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0);
  await page.mouse.up();
  await expect(todoCard).toBeVisible();
  await menu.click();
  await expect(page.getByRole('menuitem', { name: /Chuyển tới Đang làm/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(patches).toEqual([]);
});

/** Cảm ứng thật của Chromium (CDP): giữ `holdMs` rồi di chuyển — dự án mobile (hasTouch). */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs: number,
) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await touch('touchStart', from);
  if (holdMs > 0) await page.waitForTimeout(holdMs); // hành vi cần kiểm CHÍNH LÀ thời gian giữ
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', {
      x: from.x + ((to.x - from.x) * i) / 12,
      y: from.y + ((to.y - from.y) * i) / 12,
    });
  }
  return { end: () => touch('touchEnd') };
}

test('@main CD-04: cảm ứng — giữ ~300 ms rồi kéo thẻ sang cột kế ⇒ di chuyển', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile' || browserName !== 'chromium',
    'cảm ứng: chỉ dự án mobile (Chromium)',
  );
  const { task, todoCard } = await setup(page, request, 'cd04', 'Giữ để kéo');
  const target = column(page, 'IN_PROGRESS');
  await target.scrollIntoViewIfNeeded();
  await todoCard.scrollIntoViewIfNeeded();
  const from = await centerOf(todoCard);
  const box = await target.boundingBox();
  if (!box) throw new Error('không thấy cột đích');
  const vw = page.viewportSize()?.width ?? 400;
  const to = { x: Math.min(box.x + 40, vw - 20), y: box.y + 60 };
  const moved = page.waitForResponse(
    (res) => res.url().includes(`/tasks/${task.id}/move`) && res.request().method() === 'PATCH',
  );
  const drag = await touchDrag(page, from, to, 350);
  await expect(target).toHaveClass(/ring-2/);
  await drag.end();
  expect((await moved).ok()).toBe(true);
  await expect(card(column(page, 'IN_PROGRESS'), 'Giữ để kéo')).toBeVisible();
});

test('@main CD-05: cảm ứng — vuốt nhanh trên thẻ (không giữ) ⇒ KHÔNG kéo (để cuộn board)', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile' || browserName !== 'chromium',
    'cảm ứng: chỉ dự án mobile (Chromium)',
  );
  const { todoCard } = await setup(page, request, 'cd05', 'Vuốt qua');
  const patches = watchPatches(page);
  const from = await centerOf(todoCard);
  const drag = await touchDrag(page, from, { x: Math.max(10, from.x - 200), y: from.y }, 0);
  await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0);
  await drag.end();
  await expect(card(column(page, 'TODO'), 'Vuốt qua')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  expect(patches).toEqual([]);
});
