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
 * Ca phụ thuộc nhánh web/API chưa merge: chạy khi `E2E_RUN_PENDING` (phân cách dấu phẩy, hoặc `all`) chứa vé — như
 * `SEC_RUN_PENDING` của suite bảo mật. Dùng `test.fixme(awaiting('T-065b'), '[PENDING T-065b] …')` ⇒ không xanh giả.
 */
export function awaiting(ticket: string): boolean {
  const tags = (process.env.E2E_RUN_PENDING ?? '').split(',').map((t) => t.trim());
  return !tags.includes('all') && !tags.includes(ticket);
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
    await dialog.getByRole('button', { name: 'Để sau', exact: true }).click();
  });
}

export const test = base.extend<{
  cleanRateLimits: undefined;
  noCspViolations: undefined;
  /** `'keep'` cho ca kiểm chính dialog T-045 (`test.use({ checkinPrompt: 'keep' })`). */
  checkinPrompt: 'dismiss' | 'keep';
  autoDismissCheckinPrompt: undefined;
}>({
  checkinPrompt: ['dismiss', { option: true }],
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
