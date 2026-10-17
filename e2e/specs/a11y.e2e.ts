import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { apiAddMember, apiCreateTask, apiRegister, boardPath } from '../support/api';
import { card, column, waitBoardReady } from '../support/board';
import { apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';

// E2E-12 (frontend.md §8): axe không có vi phạm serious/critical, cả sáng và tối.

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

    test('E2E-12b: board, drawer task, trang thành viên', async ({ page, request }) => {
      const owner = newUser(`axe-board-${colorScheme}`);
      const s = await apiRegister(request, owner);
      const member = newUser(`axe-mem-${colorScheme}`);
      await apiRegister(request, member);
      await apiAddMember(request, s, member, 'MEMBER'); // bảng thành viên có ≥ 2 dòng
      await apiCreateTask(request, s, 'Thẻ kiểm a11y');
      await loginViaUi(page, owner);
      await page.goto(boardPath(s));
      await waitBoardReady(page);
      expect(await seriousViolations(page), 'board').toEqual([]);
      await card(column(page, 'TODO'), 'Thẻ kiểm a11y')
        .getByRole('button', { name: 'Thẻ kiểm a11y' })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await seriousViolations(page), 'drawer task').toEqual([]);
      await page.goto(`/w/${s.workspaceId}/settings/members`);
      await expect(page.getByRole('heading', { name: 'Danh sách thành viên' })).toBeVisible();
      expect(await seriousViolations(page), 'thành viên').toEqual([]);
    });

    test('/w, /account (đã đăng nhập)', async ({ page, request }) => {
      const user = newUser(`axe-${colorScheme}`);
      await apiCreateUser(request, user);
      await loginViaUi(page, user);
      for (const path of ['/w', '/account']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await seriousViolations(page), path).toEqual([]);
      }
    });
  });
}
