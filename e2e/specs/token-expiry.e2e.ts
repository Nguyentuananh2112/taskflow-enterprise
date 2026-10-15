import { API_URL } from '../support/env';
import { expect, newUser, test } from '../support/fixtures';

// E2E-11 (frontend.md §8): access token hết hạn ⇒ thao tác vẫn thành công nhờ refresh trong suốt.
// Cần API nhận JWT_ACCESS_TTL_SECONDS (T-031, chỉ khi APP_ENV=test) — playwright.config.ts đặt 10s.
// Toàn bộ trong SPA (bấm link, không page.goto): goto tải lại trang ⇒ token trong bộ nhớ mất, app
// refresh lúc khởi động bất kể hết hạn hay chưa ⇒ test sẽ xanh giả.

function lifetime(jwt: string): { iat: number; exp: number } {
  const payload = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    iat: number;
    exp: number;
  };
}

test('E2E-11: access token hết hạn ⇒ sửa hồ sơ vẫn thành công (refresh trong suốt), không về /login', async ({
  page,
}) => {
  const refreshes: number[] = [];
  page.on('response', (res) => {
    if (res.url() === `${API_URL}/auth/refresh`) refreshes.push(res.status());
  });

  const user = newUser('ttl');
  await page.goto('/register');
  await page.getByLabel('Họ tên').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Mật khẩu').fill(user.password);
  const registered = page.waitForResponse((res) => res.url() === `${API_URL}/auth/register`);
  await page.getByRole('button', { name: /tạo tài khoản|đăng ký/i }).click();
  const body = (await (await registered).json()) as { data: { accessToken: string } };
  const { iat, exp } = lifetime(body.data.accessToken);
  test.skip(
    exp - iat > 60,
    `[PENDING T-031 JWT_ACCESS_TTL_SECONDS] API cấp token ${String(exp - iat)}s — chưa hỗ trợ TTL ngắn`,
  );
  await expect(page).toHaveURL(/\/w(\/|$)/);
  await page.getByRole('link', { name: 'Tài khoản' }).click();
  await expect(page).toHaveURL(/\/account/);
  const refreshesBefore = refreshes.length;

  // Chờ theo điều kiện (không waitForTimeout cố định): đồng hồ vượt exp của token cấp lúc đăng ký.
  await expect
    .poll(() => Math.floor(Date.now() / 1000), {
      timeout: (exp - iat + 15) * 1000,
      intervals: [500],
    })
    .toBeGreaterThan(exp + 1);

  const saved = page.waitForResponse(
    (res) => res.url() === `${API_URL}/auth/me` && res.request().method() === 'PATCH' && res.ok(),
  );
  await page.getByLabel('Họ tên').fill(`${user.fullName} renamed`);
  await page.getByRole('button', { name: 'Lưu họ tên' }).click();
  await saved;
  await expect(page).toHaveURL(/\/account/);
  expect(refreshes.slice(refreshesBefore), 'phải có refresh 200 sau khi token hết hạn').toContain(
    200,
  );
});
