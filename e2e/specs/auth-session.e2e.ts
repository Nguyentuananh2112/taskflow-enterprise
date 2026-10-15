import { expect, loginViaUi, newUser, registerViaUi, test } from '../support/fixtures';

// Luồng phiên trên API thật (Prisma + Valkey) + web build production. Không cần route task.

test('@main đăng ký qua UI ⇒ /w; reload vẫn giữ phiên (refresh cookie thật)', async ({ page }) => {
  const user = newUser('signup');
  await registerViaUi(page, user);
  await page.reload();
  await expect(page).toHaveURL(/\/w(\/|$)/);
  await expect(page).not.toHaveURL(/\/login/);
});

test('@main E2E-10: đăng xuất mọi thiết bị ở A ⇒ A2 (cùng user, context khác) về /login ở thao tác kế tiếp', async ({
  browser,
}) => {
  const user = newUser('logout-all');
  const a = await browser.newContext();
  const a2 = await browser.newContext();
  try {
    const pageA = await a.newPage();
    await registerViaUi(pageA, user);
    const pageA2 = await a2.newPage();
    await loginViaUi(pageA2, user);

    await pageA.goto('/account');
    await pageA.getByRole('button', { name: 'Đăng xuất mọi thiết bị' }).click();
    await pageA.getByRole('button', { name: 'Đăng xuất tất cả' }).click();
    await expect(pageA).toHaveURL(/\/login/);

    // Thao tác kế tiếp của A2: điều hướng trong app ⇒ access/refresh cũ đều bị từ chối.
    await pageA2.goto('/account');
    await expect(pageA2).toHaveURL(/\/login/);
  } finally {
    await a.close();
    await a2.close();
  }
});
