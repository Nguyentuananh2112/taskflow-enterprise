import { randomUUID } from 'node:crypto';

import { expect, test as base, type Page } from '@playwright/test';
import { createClient } from 'redis';

import { API_URL, E2E_REDIS_URL } from './env';

/** Xóa bộ đếm rate limit (Valkey db riêng của E2E): mọi user đăng ký từ cùng IP 127.0.0.1. */
export async function flushValkey(): Promise<void> {
  if (!/\/(?:[1-9]|1[0-5])$/.test(E2E_REDIS_URL)) {
    throw new Error(`Từ chối FLUSHDB trên ${E2E_REDIS_URL}: E2E chỉ dùng db 1–15 riêng`);
  }
  const client = createClient({ url: E2E_REDIS_URL });
  await client.connect();
  try {
    await client.flushDb();
  } finally {
    await client.close();
  }
}

export interface E2EUser {
  fullName: string;
  email: string;
  password: string;
  /** Gán khi tạo qua API (`apiCreateUser` / `apiRegister`) — `apiAddMember` thêm theo id (Mốc 3.5). */
  userId?: string;
}

export function newUser(label: string): E2EUser {
  const id = randomUUID();
  return {
    fullName: `E2E ${label}`,
    email: `${label}-${id}@e2e.example`,
    password: `e2e-${id.slice(0, 8)}-long-passphrase`,
  };
}

/**
 * Mốc 3.5 thay `registerViaUi` (trang /register bỏ — ADR-137): mở link kích hoạt (token ở fragment) ⇒ đặt mật khẩu
 * ⇒ `/w`. Trang `/activate` thuộc T-065b (E, selector 17/10).
 */
export async function activateViaUi(page: Page, user: E2EUser, token: string): Promise<void> {
  await page.goto(`/activate#t=${token}`);
  await expect(
    page.getByRole('heading', { level: 1, name: `Chào ${user.fullName}!` }),
  ).toBeVisible();
  // Fragment bị xóa ngay khi mở (ADR-137): token không nằm lại trên thanh địa chỉ / lịch sử.
  expect(await page.evaluate(() => location.hash)).toBe('');
  await page.getByLabel('Mật khẩu mới').fill(user.password);
  const activated = page.waitForResponse(
    (res) => res.url() === `${API_URL}/auth/activate` && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Kích hoạt tài khoản' }).click();
  expect((await activated).status()).toBe(200);
  await expect(page).toHaveURL(/\/w(\/|$)/);
}

export async function loginViaUi(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Mật khẩu').fill(user.password);
  const loggedIn = page.waitForResponse(
    (res) => res.url() === `${API_URL}/auth/login` && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  expect((await loggedIn).status()).toBe(200);
  await expect(page).toHaveURL(/\/w(\/|$)/);
}

declare global {
  interface Window {
    __e2eCsp?: string[];
  }
}

/** Dialog nhắc chấm công của T-045 ("Chào buổi …!") — modal, che thẻ Chấm công tới khi đóng. */
export const checkinPrompt = (page: Page) => page.getByRole('dialog', { name: /^Chào buổi/ });

/**
 * T-045: dialog hiện khi vào trang chính /w (Mốc 3.5, E T-065a; trước là /projects) nếu hôm nay (theo server) phải chấm mà chưa chấm — với mốc thứ Ba 10:00 thì
 * gần như mọi ca đều gặp. Handler bấm "Để sau" mỗi khi dialog hiện ra (Playwright chạy handler trước hành động /
 * khẳng định kế tiếp). Dialog ghi "đã hiện trong ngày" ngay lúc mở ⇒ đóng thế nào cũng không hiện lại trong ngày.
 */
export async function dismissCheckinPrompt(page: Page): Promise<void> {
  await page.addLocatorHandler(checkinPrompt(page), async (dialog) => {
    // Dialog thuộc trang /w: nếu `me/today` về đúng lúc ca điều hướng đi (vd bấm "Tài khoản" ngay sau đăng nhập), dialog
    // mở rồi TỰ unmount theo trang ⇒ click chờ một nút không còn tới hết giờ test (E2E-11, cổng Mốc 6 18/10). Trần 2 s;
    // dialog đã tự đóng thì bỏ qua — còn hiện thì Playwright gọi lại handler ở hành động kế tiếp.
    await dialog
      .getByRole('button', { name: 'Để sau', exact: true })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  });
}

/** T-075: thông báo quyền riêng tư "lần đầu" — modal ở /attendance, /leave, /chat, /payslips khi chưa xác nhận. */
export const privacyPrompt = (page: Page) =>
  page.getByRole('dialog', { name: 'Thông báo về xử lý dữ liệu cá nhân' });

/**
 * Mọi người E2E mới tạo đều CHƯA xác nhận ⇒ hộp thoại che các màn trên. Handler bấm "Để sau" (nhớ trong phiên của tab)
 * như dialog nhắc chấm công; ca kiểm chính hộp thoại dùng `test.use({ privacyPrompt: 'keep' })`.
 */
export async function dismissPrivacyPrompt(page: Page): Promise<void> {
  await page.addLocatorHandler(privacyPrompt(page), async (dialog) => {
    await dialog
      .getByRole('button', { name: 'Để sau', exact: true })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  });
}

export const test = base.extend<{
  cleanRateLimits: undefined;
  noCspViolations: undefined;
  /** `'keep'` cho ca kiểm chính dialog T-045 (`test.use({ checkinPrompt: 'keep' })`). */
  checkinPrompt: 'dismiss' | 'keep';
  autoDismissCheckinPrompt: undefined;
  /** `'keep'` cho ca kiểm chính thông báo quyền riêng tư (T-075). */
  privacyPrompt: 'dismiss' | 'keep';
  autoDismissPrivacyPrompt: undefined;
}>({
  checkinPrompt: ['dismiss', { option: true }],
  privacyPrompt: ['dismiss', { option: true }],
  autoDismissPrivacyPrompt: [
    async ({ context, page, privacyPrompt: mode }, use) => {
      if (mode === 'dismiss') {
        await dismissPrivacyPrompt(page);
        context.on('page', (p) => void dismissPrivacyPrompt(p));
      }
      await use(undefined);
    },
    { auto: true },
  ],
  autoDismissCheckinPrompt: [
    async ({ context, page, checkinPrompt: mode }, use) => {
      if (mode === 'dismiss') {
        await dismissCheckinPrompt(page);
        context.on('page', (p) => void dismissCheckinPrompt(p));
      }
      await use(undefined);
    },
    { auto: true },
  ],
  /**
   * Mọi kịch bản chạy trên build prod với CSP thật (TL, sau lỗi dnd-kit chèn <style>): ghi mọi
   * `securitypolicyviolation` của context mặc định; còn vi phạm khi test kết thúc ⇒ test đỏ.
   * Context tự tạo (browser.newContext) không được phủ — test đó tự kiểm nếu cần.
   */
  noCspViolations: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        window.__e2eCsp = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__e2eCsp?.push(
            `${e.violatedDirective} ${e.blockedURI} @ ${e.sourceFile}:${String(e.lineNumber)}`,
          );
        });
      });
      await use(undefined);
      for (const p of context.pages()) {
        if (p.isClosed()) continue;
        const found = await p.evaluate(() => window.__e2eCsp ?? []).catch(() => []);
        expect(found, `vi phạm CSP trên ${p.url()}`).toEqual([]);
      }
    },
    { auto: true },
  ],
  cleanRateLimits: [
    // Playwright bắt buộc tham số đầu là object destructuring (đọc tên fixture phụ thuộc từ mã nguồn).
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await flushValkey();
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };
