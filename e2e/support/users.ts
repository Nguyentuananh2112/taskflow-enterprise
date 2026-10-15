import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { loginViaUi, type E2EUser } from './fixtures';

/**
 * Người dùng thứ hai/ba trong context riêng (realtime nhiều người). Có cùng bộ bắt vi phạm CSP như
 * context mặc định (fixture `noCspViolations` chỉ phủ context mặc định) — gọi `close()` để kiểm + đóng.
 */
export async function openAs(
  browser: Browser,
  user: E2EUser,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__e2eCsp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__e2eCsp?.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const page = await context.newPage();
  await loginViaUi(page, user);
  return {
    context,
    page,
    close: async () => {
      try {
        for (const p of context.pages()) {
          if (p.isClosed()) continue;
          const found = await p.evaluate(() => window.__e2eCsp ?? []).catch(() => []);
          expect(found, `vi phạm CSP (${user.email}) trên ${p.url()}`).toEqual([]);
        }
      } finally {
        await context.close();
      }
    },
  };
}
