import type { Page } from '@playwright/test';

import { apiAddMember, apiAssign, apiCreateTask, apiRegister, boardPath } from '../support/api';
import { waitBoardReady } from '../support/board';
import { apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { makePng } from '../support/images';
import { awaiting } from '../support/pending';

// E2E-CH-01 (test-spec-chat §6, avatar-chat.md ADR-142 / §7 E1–E5; selector H 17–18/10). Cần API thật của T-068
// (`PUT/DELETE me/avatar`, `/media/avatars`) ⇒ fixme tới khi E2E_RUN_PENDING chứa T-068 (không xanh giả).
// Ảnh sinh lúc chạy (makePng). Server mã hóa lại WebP ⇒ không so byte với ảnh gốc.

const T068 = 'T-068';
const AVATAR_IMG = 'img[src*="/media/avatars/"]';
const DONE = { timeout: 15_000 }; // sharp trong worker + upload

const header = (page: Page) => page.getByRole('navigation', { name: 'Tài khoản' });
const region = (page: Page) => page.getByRole('region', { name: 'Ảnh đại diện' });
/** Toast (Radix — vùng "Thông báo", như admin.e2e.ts). */
const toast = (page: Page, text: string) =>
  page
    .getByRole('region', { name: /Thông báo/ })
    .getByText(text)
    .first();

for (const viewport of [
  { width: 360, height: 780 },
  { width: 1280, height: 800 },
]) {
  test.describe(`E2E-CH-01 ảnh đại diện (${viewport.width}px)`, () => {
    test.use({ viewport });

    test.fixme(awaiting(T068), `[PENDING ${T068}] chờ API avatar thật`);

    test('cắt (slider + phím) ⇒ lưu ⇒ hiện ở /account, header, thẻ board, trang thành viên; gỡ ⇒ về chữ cái', async ({
      page,
      request,
    }) => {
      const owner = newUser(`av-${viewport.width}`);
      const s = await apiRegister(request, owner);
      const vic = newUser(`av-vic-${viewport.width}`);
      await apiCreateUser(request, vic);
      await apiAddMember(request, s, vic, 'MEMBER'); // trang thành viên có ≥ 2 dòng
      const task = await apiCreateTask(request, s, 'Thẻ có ảnh người làm');
      await apiAssign(request, s, task, s.userId);

      await loginViaUi(page, owner);
      await page.goto('/account');
      const box = region(page);
      // Chưa có ảnh ⇒ chữ cái (span role=img), không có <img> media.
      await expect(box.locator(AVATAR_IMG)).toHaveCount(0);

      await page.getByLabel('Chọn ảnh').setInputFiles({
        name: 'anh-ngang.png',
        mimeType: 'image/png',
        buffer: makePng(800, 400), // ảnh ngang ⇒ dịch ngang được cả ở zoom 1
      });
      const dialog = page.getByRole('dialog', { name: 'Cắt ảnh đại diện' });
      await expect(dialog).toBeVisible();
      const slider = dialog.getByRole('slider', { name: 'Thu phóng' });
      await slider.focus();
      await page.keyboard.press('ArrowRight'); // zoom lên ⇒ dịch được cả dọc
      await dialog.getByRole('img', { name: 'Vùng cắt ảnh' }).focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Shift+ArrowUp');
      await dialog.getByRole('button', { name: 'Lưu ảnh đại diện' }).click();
      await expect(toast(page, 'Đã cập nhật ảnh đại diện')).toBeVisible(DONE);
      await expect(dialog).toBeHidden();

      // /account: ảnh lớn KHÔNG trang trí ⇒ img alt = họ tên.
      await expect(box.getByRole('img', { name: owner.fullName })).toHaveAttribute(
        'src',
        /\/media\/avatars\/.+\/256\?/,
      );
      // Header (≥ sm) trang trí: có img media, KHÔNG đọc tên lần hai. 360 px header ẩn avatar (sm:flex).
      if (viewport.width >= 640) {
        await expect(header(page).locator(AVATAR_IMG)).toHaveCount(1);
        await expect(header(page).getByRole('img', { name: owner.fullName })).toHaveCount(0);
      }

      await page.goto(boardPath(s));
      await waitBoardReady(page);
      await expect(page.getByRole('img', { name: owner.fullName }).first()).toHaveAttribute(
        'src',
        /\/media\/avatars\//,
      );

      await page.goto(`/w/${s.workspaceId}/settings/members`);
      const row = page.getByRole('row', { name: new RegExp(owner.fullName) });
      await expect(row.locator(AVATAR_IMG)).toHaveCount(1);
      await expect(row.getByRole('img', { name: owner.fullName })).toHaveCount(0);

      await page.goto('/account');
      await region(page).getByRole('button', { name: 'Gỡ ảnh đại diện' }).click();
      await expect(toast(page, 'Đã gỡ ảnh đại diện')).toBeVisible(DONE);
      await expect(page.locator(AVATAR_IMG)).toHaveCount(0);
      await expect(region(page).getByRole('img', { name: owner.fullName })).toHaveText(
        /^[A-ZĐ]{1,2}$/,
      );
    });
  });
}
