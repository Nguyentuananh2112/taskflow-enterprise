import {
  apiAddMember,
  apiAssign,
  apiCreateProject,
  apiCreateTask,
  apiDeleteWorkspace,
  apiRegister,
  apiRenameWorkspace,
  boardPath,
} from '../support/api';
import { card, column, waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { openAs } from '../support/users';
import { arm, assertInert } from '../support/xss';

// SEC-49 (security.md): nội dung người dùng nhập — tiêu đề/mô tả task, họ tên, tên workspace/project — luôn hiển thị dạng TEXT,
// không bao giờ thành HTML/JS ở board, drawer (sửa + chỉ đọc), realtime client khác, toast, danh sách
// thành viên. Dữ liệu đi qua API THẬT (không chèn DOM giả). Bắt XSS theo 4 lớp độc lập:
//   1. hàm bẫy `__xss(n)` được gọi (payload chạy được);
//   2. hộp thoại `alert/confirm/prompt` xuất hiện;
//   3. phần tử nguy hiểm lọt vào DOM (img[src=x], svg/onload, a[href^=javascript:], thuộc tính on*);
//   4. vi phạm CSP (fixture `noCspViolations` + `openAs().close()`) — CSP nonce chặn handler inline nhưng
//      vẫn báo vi phạm ⇒ HTML bị chèn dù không chạy được cũng làm test đỏ.

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

/** ≤ 100 ký tự (WorkspaceName / ProjectName, một dòng). */
const EVIL_WS = '<img src=x onerror=__xss(12)>"><svg onload=alert(13)> WS';
const EVIL_PROJECT = '<script>__xss(14)</script><a href="javascript:__xss(15)">p</a> PJ';

test('SEC-49: tên workspace + project chứa payload ⇒ picker /w, danh sách project, board, cài đặt project/ws, thành viên, khu Đã xóa chỉ hiển thị text', async ({
  page,
  context,
  request,
}) => {
  const dialogs = await arm(context);
  const a = newUser('xss-names');
  const sa = await apiRegister(request, a);
  await apiRenameWorkspace(request, sa, EVIL_WS);
  const project = await apiCreateProject(request, sa, EVIL_PROJECT, 'XSSP');
  const sp = { ...sa, projectId: project.id };
  await loginViaUi(page, a);

  const visits: [string, string, string][] = [
    ['picker /w', '/w', EVIL_WS],
    ['danh sách project', `/w/${sa.workspaceId}/projects`, EVIL_PROJECT],
    ['board', boardPath(sp), EVIL_PROJECT],
    ['cài đặt project', `${boardPath(sp)}/settings`, EVIL_PROJECT],
    ['thành viên', `/w/${sa.workspaceId}/settings/members`, EVIL_WS],
  ];
  for (const [where, path, text] of visits) {
    await page.goto(path);
    await expect(
      page.getByText(text, { exact: false }).filter({ visible: true }).first(),
      where,
    ).toBeVisible();
    await assertInert(page, dialogs, where);
  }

  // Cài đặt workspace: tên nằm trong ô nhập (value) — nguyên văn, DOM vẫn trơ.
  await page.goto(`/w/${sa.workspaceId}/settings`);
  await expect(page.getByLabel('Tên workspace')).toHaveValue(EVIL_WS);
  await assertInert(page, dialogs, 'cài đặt workspace');

  // Khu "Đã xóa" ở /w liệt kê ws đã xóa mềm theo tên (đường render riêng).
  // Trang đang mở là của ws vừa xóa ⇒ app tự về /w (realtime workspace:access-revoked). Tự `goto` chồng
  // lên lần điều hướng đó làm Firefox hủy một navigation (NS_BINDING_ABORTED, CI) ⇒ chờ app về /w.
  await apiDeleteWorkspace(request, sa);
  // Không tự về trong 10 s ⇒ không còn navigation nào đang chạy ⇒ `goto` an toàn.
  await page.waitForURL(/\/w\/?(\?.*)?$/, { timeout: 10_000 }).catch(() => page.goto('/w'));
  await page.getByText(/Đã xóa — khôi phục được/).click();
  await expect(page.getByRole('button', { name: `Khôi phục ${EVIL_WS}` })).toBeVisible();
  await expect(
    page.getByText(EVIL_WS, { exact: false }).filter({ visible: true }).first(),
  ).toBeVisible();
  await assertInert(page, dialogs, 'khu Đã xóa');
});
