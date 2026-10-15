import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, newUser, registerViaUi, test } from '../support/fixtures';

// E2E-12 (frontend.md §8): axe không có vi phạm serious/critical, cả sáng và tối.
// Board + drawer + thành viên: thêm khi task API (T-024) vào main.

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`E2E-12 axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('login, register', async ({ page }) => {
      for (const path of ['/login', '/register']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await seriousViolations(page), path).toEqual([]);
      }
    });

    test('/w, /account (đã đăng nhập)', async ({ page }) => {
      await registerViaUi(page, newUser(`axe-${colorScheme}`));
      for (const path of ['/w', '/account']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await seriousViolations(page), path).toEqual([]);
      }
    });
  });
}
