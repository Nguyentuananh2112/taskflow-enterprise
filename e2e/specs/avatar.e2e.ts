import type { APIRequestContext, Page } from '@playwright/test';

import { apiAddMember, apiAssign, apiCreateTask, boardPath } from '../support/api';
import { waitBoardReady } from '../support/board';
import { DEFAULT_PROJECT, apiCreateUser, apiNewWorkspace, type Seeded } from '../support/company';
import { API_URL, WEB_ORIGIN } from '../support/env';
import { expect, loginViaUi, newUser, test, type E2EUser } from '../support/fixtures';
import { call } from '../support/http';
import { makePng } from '../support/images';

// E2E-CH-01 (test-spec-chat §6, avatar-chat.md ADR-142 / §7 E1–E5; selector H 17–18/10). Chạy trên API thật của T-068
// (`PUT/DELETE me/avatar`, `DELETE hr/employees/:id/avatar`, `/media/avatars`). Ảnh sinh lúc chạy (makePng). Server
// mã hóa lại WebP ⇒ không so byte với ảnh gốc.

const AVATAR_IMG = 'img[src*="/media/avatars/"]';
const DONE = { timeout: 15_000 }; // sharp trong worker + upload

const header = (page: Page) => page.getByRole('navigation', { name: 'Tài khoản' });
const region = (page: Page) => page.getByRole('region', { name: 'Ảnh đại diện' });
/** Toast (Radix — vùng "Thông báo", như admin.e2e.ts / xss). */
const toast = (page: Page, text: string) =>
  page
    .getByRole('region', { name: /Thông báo/ })
    .getByText(text)
    .first();

/** Chủ workspace + project mặc định (apiCreateUser + apiNewWorkspace — không dùng alias apiRegister). */
async function seedOwner(request: APIRequestContext, user: E2EUser): Promise<Seeded> {
  const { userId, accessToken } = await apiCreateUser(request, user);
  const ws = await apiNewWorkspace(request, accessToken, `Workspace của ${user.fullName}`);
  const project = await call<{ id: string }>(
    request,
    'POST',
    `/workspaces/${ws.id}/projects`,
    accessToken,
    DEFAULT_PROJECT,
    201,
  );
  return { userId, accessToken, workspaceId: ws.id, projectId: project.id };
}

/** Đặt ảnh qua API (octet-stream + X-Upload-Name — ADR-141) cho ca không đi qua cropper. */
async function apiSetAvatar(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.fetch(`${API_URL}/me/avatar`, {
    method: 'PUT',
    headers: {
      origin: WEB_ORIGIN,
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'x-upload-name': encodeURIComponent('anh.png'),
    },
    data: makePng(300, 300),
  });
  expect(res.status(), await res.text()).toBe(200);
}

for (const viewport of [
  { width: 360, height: 780 },
  { width: 1280, height: 800 },
]) {
  test.describe(`E2E-CH-01 ảnh đại diện (${viewport.width}px)`, () => {
    test.use({ viewport });

    test('cắt (slider + phím) ⇒ lưu ⇒ hiện ở /account, header, thẻ board, trang thành viên; gỡ ⇒ về chữ cái', async ({
      page,
      request,
    }) => {
      const owner = newUser(`av-${viewport.width}`);
      const s = await seedOwner(request, owner);
      const vic = newUser(`av-vic-${viewport.width}`);
      await apiCreateUser(request, vic);
      await apiAddMember(request, s, vic, 'MEMBER'); // trang thành viên có ≥ 2 dòng
      const task = await apiCreateTask(request, s, 'Thẻ có ảnh người làm');
      await apiAssign(request, s, task, s.userId);

      await loginViaUi(page, owner);
      await page.goto('/account');
      const box = region(page);
      await expect(box.locator(AVATAR_IMG)).toHaveCount(0); // chưa có ảnh ⇒ chữ cái

      await page.getByLabel('Chọn ảnh').setInputFiles({
        name: 'anh-ngang.png',
        mimeType: 'image/png',
        buffer: makePng(800, 400), // ảnh ngang ⇒ dịch ngang được cả ở zoom 1
      });
      const dialog = page.getByRole('dialog', { name: 'Cắt ảnh đại diện' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('slider', { name: 'Thu phóng' }).focus();
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

    if (viewport.width === 360) {
      test('tệp không phải ảnh (đuôi .png) ⇒ alert lời thường, không mở dialog cắt, không có ảnh mới', async ({
        page,
        request,
      }) => {
        const mia = newUser('av-bad');
        await apiCreateUser(request, mia);
        await loginViaUi(page, mia);
        await page.goto('/account');
        await page.getByLabel('Chọn ảnh').setInputFiles({
          name: 'gia.png',
          mimeType: 'image/png',
          buffer: Buffer.from('xin chao'),
        });
        await expect(region(page).getByRole('alert')).toHaveText(
          'Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG.',
        );
        await expect(page.getByRole('dialog', { name: 'Cắt ảnh đại diện' })).toHaveCount(0);
        await expect(page.locator(AVATAR_IMG)).toHaveCount(0);
      });
    }

    if (viewport.width === 1280) {
      test('HR gỡ ảnh không phù hợp ở /hr/employees ⇒ dialog cấp trang ⇒ ảnh của nhân viên về chữ cái', async ({
        page,
        request,
      }) => {
        const hana = newUser('av-hr');
        await apiCreateUser(request, hana, { grants: ['HR_MANAGE'] });
        const vic = newUser('av-hr-vic');
        const v = await apiCreateUser(request, vic);
        await apiSetAvatar(request, v.accessToken);

        await loginViaUi(page, hana);
        await page.goto('/hr/employees');
        await page.getByLabel('Tìm theo tên hoặc email').fill(vic.fullName);
        await page.getByRole('button', { name: `Gỡ ảnh đại diện ${vic.fullName}` }).click();
        const dialog = page.getByRole('dialog', { name: 'Gỡ ảnh đại diện' });
        await dialog.getByRole('button', { name: 'Gỡ ảnh' }).click();
        await expect(toast(page, `Đã gỡ ảnh đại diện của ${vic.fullName}`)).toBeVisible(DONE);
        await expect(dialog).toBeHidden();
        // Không còn ảnh ⇒ nút gỡ biến mất (EmployeeDto.avatarUrl null); nhân viên tự xem: /auth/me không có ảnh.
        await expect(
          page.getByRole('button', { name: `Gỡ ảnh đại diện ${vic.fullName}` }),
        ).toHaveCount(0);
        const me = await call<{ user: { avatarUrl?: string | null } }>(
          request,
          'GET',
          '/auth/me',
          v.accessToken,
          undefined,
          200,
        );
        expect(me.user.avatarUrl ?? null).toBeNull();
      });
    }
  });
}
