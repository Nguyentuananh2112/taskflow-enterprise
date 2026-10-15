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
}

export function newUser(label: string): E2EUser {
  const id = randomUUID();
  return {
    fullName: `E2E ${label}`,
    email: `${label}-${id}@e2e.example`,
    password: `e2e-${id.slice(0, 8)}-long-passphrase`,
  };
}

/** Đăng ký qua UI thật và chờ request tới đúng API (không phải mock — APP_MOCK_API không đặt). */
export async function registerViaUi(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Họ tên').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Mật khẩu').fill(user.password);
  const registered = page.waitForResponse(
    (res) => res.url() === `${API_URL}/auth/register` && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /tạo tài khoản|đăng ký/i }).click();
  expect((await registered).status()).toBe(201);
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

export const test = base.extend<{ cleanRateLimits: undefined; noCspViolations: undefined }>({
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
