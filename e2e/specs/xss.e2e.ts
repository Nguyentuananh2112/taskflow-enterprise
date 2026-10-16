import type { BrowserContext, Page } from '@playwright/test';

import { apiAddMember, apiAssign, apiCreateTask, apiRegister, boardPath } from '../support/api';
import { card, column, waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { openAs } from '../support/users';

// SEC-49 (security.md): nội dung người dùng nhập — tiêu đề/mô tả task, họ tên — luôn hiển thị dạng TEXT,
// không bao giờ thành HTML/JS ở board, drawer (sửa + chỉ đọc), realtime client khác, toast, danh sách
// thành viên. Dữ liệu đi qua API THẬT (không chèn DOM giả). Bắt XSS theo 4 lớp độc lập:
//   1. hàm bẫy `__xss(n)` được gọi (payload chạy được);
//   2. hộp thoại `alert/confirm/prompt` xuất hiện;
//   3. phần tử nguy hiểm lọt vào DOM (img[src=x], svg/onload, a[href^=javascript:], thuộc tính on*);
//   4. vi phạm CSP (fixture `noCspViolations` + `openAs().close()`) — CSP nonce chặn handler inline nhưng
//      vẫn báo vi phạm ⇒ HTML bị chèn dù không chạy được cũng làm test đỏ.

declare global {
  interface Window {
    __xssHits?: number[];
    __xss?: (n: number) => void;
  }
}

/** Mỗi payload ≤ 150 ký tự, một dòng (TaskTitle). `n` khác nhau ⇒ biết payload nào chạy. */
const TITLES = [
  '<script>__xss(1)</script> T1',
  '<img src=x onerror=__xss(2)> T2',
  '<svg onload=__xss(3)><circle r=1></svg> T3',
  '<a href="javascript:__xss(4)">bấm</a> T4',
  '"><img src=x onerror=__xss(5)> T5',
  'javascript:__xss(6) T6',
  '<img src=x onerror=alert(7)> T7',
] as const;
const DESCRIPTION = [...TITLES, '<iframe srcdoc="<script>parent.__xss(8)</script>"></iframe>'].join(
  '\n',
);
/** ≤ 100 ký tự, không ký tự điều khiển (luật họ tên). */
const EVIL_NAME = '<img src=x onerror=__xss(9)>"><svg onload=alert(10)>';
const EDITED_TITLE = '<details open ontoggle=__xss(11)>T11';

/** Phần tử/thuộc tính không bao giờ được xuất hiện nếu nội dung người dùng chỉ là text. */
const DANGEROUS =
  'img[src="x"], svg[onload], a[href^="javascript:"], iframe[srcdoc], details[ontoggle], [onerror], [onload], [ontoggle]';

async function arm(context: BrowserContext): Promise<string[]> {
  await context.addInitScript(() => {
    window.__xssHits = [];
    window.__xss = (n: number) => window.__xssHits?.push(n);
  });
  const dialogs: string[] = [];
  context.on('dialog', (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  // Trang mở sau khi gắn (context.on chỉ phủ page mới) — gắn cho page đang có.
  for (const p of context.pages()) {
    p.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
  }
  return dialogs;
}

async function assertInert(page: Page, dialogs: readonly string[], where: string): Promise<void> {
  expect(await page.evaluate(() => window.__xssHits ?? []), `${where}: payload đã chạy`).toEqual(
    [],
  );
  expect(dialogs, `${where}: có hộp thoại`).toEqual([]);
  expect(
    await page.locator(DANGEROUS).evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 120))),
    `${where}: phần tử nguy hiểm trong DOM`,
  ).toEqual([]);
}

test('SEC-49: payload XSS ở tiêu đề + mô tả task (API thật) ⇒ board, drawer sửa/chỉ đọc, realtime 2 client chỉ hiển thị text', async ({
  page,
  context,
  browser,
  request,
}) => {
  const dialogsA = await arm(context);
  const a = newUser('xss-owner');
  const v = newUser('xss-viewer');
  const sa = await apiRegister(request, a);
  await apiRegister(request, v);
  await apiAddMember(request, sa, v, 'VIEWER');

  await loginViaUi(page, a);
  await page.goto(boardPath(sa));
  await waitBoardReady(page);
  const viewer = await openAs(browser, v);
  const dialogsV = await arm(viewer.context);
  await viewer.page.goto(boardPath(sa));
  await waitBoardReady(viewer.page);
  await expect(viewer.page.getByText('Trực tuyến')).toBeVisible();

  // Tạo SAU khi cả hai đã mở board ⇒ thẻ tới viewer qua realtime (đường render riêng của event socket).
  for (const title of TITLES) await apiCreateTask(request, sa, title, DESCRIPTION);
  for (const p of [page, viewer.page]) {
    for (const title of TITLES) await expect(card(column(p, 'TODO'), title)).toBeVisible();
  }
  await assertInert(page, dialogsA, 'board A');
  await assertInert(viewer.page, dialogsV, 'board viewer (realtime)');

  // Drawer A (form sửa): giá trị input đúng nguyên văn.
  const [first] = TITLES;
  await card(column(page, 'TODO'), first).getByRole('button', { name: first }).click();
  const drawerA = page.getByRole('dialog');
  await expect(drawerA.getByRole('textbox', { name: 'Tiêu đề', exact: true })).toHaveValue(first);
  await expect(drawerA.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveValue(
    DESCRIPTION,
  );
  await assertInert(page, dialogsA, 'drawer sửa A');

  // Drawer viewer (chỉ đọc — mô tả là <p> text, không phải input): text nguyên văn.
  await card(column(viewer.page, 'TODO'), first).getByRole('button', { name: first }).click();
  const drawerV = viewer.page.getByRole('dialog');
  await expect(drawerV.getByRole('heading', { name: first })).toBeVisible();
  await expect(drawerV.getByText('<iframe srcdoc=', { exact: false })).toBeVisible();
  await assertInert(viewer.page, dialogsV, 'drawer chỉ đọc viewer');

  // A sửa tiêu đề qua UI ⇒ viewer nhận bản mới qua realtime, vẫn là text.
  await drawerA.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill(EDITED_TITLE);
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/tasks\/[^/]+$/.test(res.url()),
  );
  await drawerA.getByRole('button', { name: 'Lưu thay đổi' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(drawerV.getByRole('heading', { name: EDITED_TITLE })).toBeVisible();
  await assertInert(page, dialogsA, 'sau khi A lưu');
  await assertInert(viewer.page, dialogsV, 'viewer nhận realtime bản sửa');

  await viewer.close();
});

test('SEC-49: họ tên chứa payload ⇒ toast "Đã thêm …", danh sách thành viên, người được giao trên thẻ chỉ hiển thị text', async ({
  page,
  context,
  request,
}) => {
  const dialogs = await arm(context);
  const a = newUser('xss-admin');
  const evil = { ...newUser('xss-name'), fullName: EVIL_NAME };
  const sa = await apiRegister(request, a);
  const se = await apiRegister(request, evil);

  await loginViaUi(page, a);
  await page.goto(`/w/${sa.workspaceId}/settings/members`);
  const form = page.getByRole('form', { name: 'Thêm thành viên' });
  await form.getByLabel('Email').fill(evil.email);
  await form.getByLabel('Vai trò').selectOption({ label: 'Thành viên' });
  await form.getByRole('button', { name: 'Thêm' }).click();
  await expect(
    page.getByRole('region', { name: /Thông báo/ }).getByText(`Đã thêm ${EVIL_NAME}`),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: EVIL_NAME, exact: false }).first()).toBeVisible();
  await assertInert(page, dialogs, 'toast + danh sách thành viên');

  // Người được giao hiển thị trên thẻ / drawer.
  const task = await apiCreateTask(request, sa, 'Giao cho người tên lạ');
  await apiAssign(request, sa, task, se.userId);
  await page.goto(boardPath(sa));
  await waitBoardReady(page);
  const assigned = card(column(page, 'TODO'), 'Giao cho người tên lạ');
  await expect(assigned).toBeVisible();
  // Avatar trên thẻ đưa họ tên vào THUỘC TÍNH (aria-label + title) — vector khác với text node.
  const avatar = assigned.getByRole('img', { name: EVIL_NAME });
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('title', EVIL_NAME);
  await assertInert(page, dialogs, 'board có người được giao');
  // Drawer (OWNER ⇒ bộ chọn người phụ trách: tên nằm trong combobox/option) — DOM vẫn phải trơ.
  await assigned.getByRole('button', { name: 'Giao cho người tên lạ' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertInert(page, dialogs, 'drawer có bộ chọn người phụ trách');
});
