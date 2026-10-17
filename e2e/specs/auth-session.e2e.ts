import {
  dismissCheckinPrompt,
  expect,
  loginViaUi,
  newUser,
  activateViaUi,
  test,
} from '../support/fixtures';
import { apiCreatePending, apiCreateUser } from '../support/company';

// Luồng phiên trên API thật (Prisma + Valkey) + web build production. Không cần route task.

// Mốc 3.5: không còn tự đăng ký — người mới vào bằng link kích hoạt HR gửi (ADR-137).
test('@main kích hoạt qua UI ⇒ /w; reload vẫn giữ phiên (refresh cookie thật)', async ({
  page,
  request,
}) => {
  const user = newUser('signup');
  const { token } = await apiCreatePending(request, user);
  await activateViaUi(page, user, token);
  await page.reload();
  await expect(page).toHaveURL(/\/w(\/|$)/);
  await expect(page).not.toHaveURL(/\/login/);
});

test('@main E2E-10: đăng xuất mọi thiết bị ở A ⇒ A2 (cùng user, context khác) về /login ở thao tác kế tiếp', async ({
  browser,
  request,
}) => {
  const user = newUser('logout-all');
  await apiCreateUser(request, user);
  const a = await browser.newContext();
  const a2 = await browser.newContext();
  try {
    const pageA = await a.newPage();
    await dismissCheckinPrompt(pageA); // context riêng ⇒ tự gắn (dialog T-045)
    await loginViaUi(pageA, user);
    const pageA2 = await a2.newPage();
    await dismissCheckinPrompt(pageA2);
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
