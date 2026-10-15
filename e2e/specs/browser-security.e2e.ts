import type { Page } from '@playwright/test';

import { expect, newUser, registerViaUi, test } from '../support/fixtures';

// SEC-48..50 (security.md): không vi phạm CSP, access token không nằm trong storage, cookie refresh HttpOnly.

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

test('SEC-48: login / register / w / account không có vi phạm CSP', async ({ page }) => {
  const consoleCsp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleCsp.push(msg.text());
  });
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await cspViolations(page), path).toEqual([]);
  }
  await registerViaUi(page, newUser('csp'));
  for (const path of ['/w', '/account']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await cspViolations(page), path).toEqual([]);
  }
  expect(consoleCsp).toEqual([]);
});

test('SEC-50: access token không nằm trong storage; cookie refresh HttpOnly, SameSite=Strict, không đọc được từ JS', async ({
  page,
  context,
}) => {
  await registerViaUi(page, newUser('storage'));
  await page.reload();
  await expect(page).toHaveURL(/\/w(\/|$)/);

  const stored = await page.evaluate(() => {
    const dump = (s: Storage) =>
      Array.from(
        { length: s.length },
        (_, i) => `${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`,
      );
    return { local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie };
  });
  const jwtLike = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
  expect(stored.local.join('\n')).not.toMatch(jwtLike);
  expect(stored.session.join('\n')).not.toMatch(jwtLike);
  expect(stored.cookie).not.toMatch(/tf_rt/);

  const refresh = (await context.cookies()).find((c) => /tf_rt$/.test(c.name));
  expect(refresh, 'phải có cookie refresh').toBeDefined();
  expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
});
