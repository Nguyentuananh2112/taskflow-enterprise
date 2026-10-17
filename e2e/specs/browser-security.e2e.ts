import type { Page } from '@playwright/test';

import { apiCreateTask, apiRegister, boardPath } from '../support/api';
import { column, dragByMouse, waitBoardReady } from '../support/board';
import { apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';

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
      window.__cspViolations?.push(
        `${e.violatedDirective} ${e.blockedURI} @ ${e.sourceFile}:${String(e.lineNumber)}:${String(e.columnNumber)}`,
      );
    });
  });
});

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

test('SEC-48: login / activate / w / account không có vi phạm CSP', async ({ page, request }) => {
  const consoleCsp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleCsp.push(msg.text());
  });
  // Mốc 3.5: /register bỏ ⇒ trang công khai thứ hai là /activate (không token ⇒ câu hướng dẫn).
  for (const path of ['/login', '/activate']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await cspViolations(page), path).toEqual([]);
  }
  const user = newUser('csp');
  await apiCreateUser(request, user);
  await loginViaUi(page, user);
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
  request,
}) => {
  const user = newUser('storage');
  await apiCreateUser(request, user);
  await loginViaUi(page, user);
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

test('SEC-48b: board + một lần kéo thẻ (dnd-kit chèn style) không có vi phạm CSP', async ({
  page,
  request,
}) => {
  const user = newUser('csp-board');
  const s = await apiRegister(request, user);
  const task = await apiCreateTask(request, s, 'CSP kéo');
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);
  expect(await cspViolations(page), 'board vừa tải').toEqual([]);
  await dragByMouse(
    page,
    page.getByRole('button', { name: `Kéo ${task.key}` }),
    column(page, 'IN_PROGRESS'),
    async () => {
      expect(await cspViolations(page), 'giữa lúc kéo').toEqual([]);
    },
  );
});
