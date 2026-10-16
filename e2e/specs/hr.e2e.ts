import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { expect, loginViaUi, test } from '../support/fixtures';
import {
  apiAdjust,
  apiCheckIn,
  apiDecideLeave,
  apiMyToday,
  apiPutHoliday,
  apiSubmitLeave,
  ddMm,
  hrCall,
  refreshed,
  seedHrWorld,
  vnDate,
  vnHm,
  vnWorkday,
  type HrWorld,
} from '../support/hr';
import { openAs } from '../support/users';
import { arm, assertInert } from '../support/xss';

// E2E-HR-* (docs/design/test-spec-hr.md §9, T-042). Thân viết theo UI THẬT của nhánh web (T-041a/b/c @ feat/T-041c-hr-web
// 6733a06; E soát a/b trên 268c7d4/7817d42, H soát c trên f26425c — nhãn/vai trò tiếng Việt, không có data-testid) và contract thật (attendance T-038 0fb023f, leave T-039,
// grants T-037). Đã bỏ fixme mọi ca: T-041a (01, 04, 05, 07, 08, 09), T-041b (02b, 04b, 07b, 08b, 09b), T-041c (02, 03, 06, 07c, 08c). Hậu tố b/c = phần cần /leave (T-041b) hoặc /hr (T-041c); nhãn vé
// trong tên ca giữ lại để biết ca thuộc màn nào.
//   T-041a: thẻ Chấm công ở /projects, /attendance, chuông thông báo, nút gọn trên header
//   T-041b: /leave (số dư, form gửi đơn, đơn của tôi)
//   T-041c: /hr (Hôm nay, Bảng công tháng + Xuất CSV, Đơn nghỉ, Lịch & ngày lễ, Số phép), công tắc grant ở Thành viên
// Dữ liệu dựng qua API công khai (support/hr.ts). Lịch mặc định S0: T2–T7 08:00–17:30, Asia/Ho_Chi_Minh.
// Server luôn METRICS_PORT=0 (playwright.config.ts) — không đụng dev/prod của người dùng ở 3001/4000.

const T041A = 'T-041a';
const T041B = 'T-041b';
const T041C = 'T-041c';

/** Realtime (notification:new, member:grants-changed) — spec: < 2 s; nới cho máy CI bận như REALTIME của collaboration. */
const REALTIME = { timeout: 5_000 };

const projectsPath = (w: HrWorld) => `/w/${w.olivia.workspaceId}/projects`;
const wsPath = (w: HrWorld, sub: string) => `/w/${w.olivia.workspaceId}/${sub}`;

/** Thẻ "Chấm công" — `<section aria-labelledby>` ⇒ role region. */
const attendanceCard = (page: Page) => page.getByRole('region', { name: 'Chấm công', exact: true });

/** Ô `<dd>` ngay sau `<dt>` có nhãn `term` trong thẻ chấm công ("Ca", "Trạng thái", "Vào / Ra"). */
const cardValue = (card: Locator, term: string) =>
  card.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');

const bell = (page: Page) => page.getByRole('button', { name: /^Thông báo/ });

/** Hàng của ngày `date` trong bảng công tháng — tiêu đề hàng là nút "Th 5, 15/10" (Intl vi-VN) ⇒ chỉ neo đuôi dd/MM. */
const dayRow = (table: Locator, date: string) =>
  table
    .getByRole('row')
    .filter({ has: table.page().getByRole('rowheader', { name: new RegExp(`${ddMm(date)}$`) }) });

/** Hai "HH:mm" cách nhau ≤ 1 phút (qua nửa đêm cũng được) — đồng hồ thẻ chạy theo serverNow, test đọc giờ máy test. */
function withinAMinute(a: string, b: string): boolean {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const d = Math.abs(m(a) - m(b));
  return Math.min(d, 1440 - d) <= 1;
}

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll, `${where}: cuộn ngang trang`).toBeLessThanOrEqual(inner);
}

// ---------------------------------------------------------------- E2E-HR-01

test.describe('E2E-HR-01 múi giờ trình duyệt khác lịch', () => {
  // Giờ trên thẻ theo serverNow + múi giờ LỊCH (Asia/Ho_Chi_Minh), không theo máy người dùng.
  test.use({ timezoneId: 'America/New_York' });

  test(`@main E2E-HR-01 [${T041A}]: thẻ Chấm công ở /projects ⇒ Chấm vào ⇒ Chấm ra; giờ theo serverNow + múi giờ lịch; tab cũ bấm vào lần 2 ⇒ 409 already_checked_in`, async ({
    page,
    context,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr01');
    await loginViaUi(page, w.mia.user);
    await page.goto(projectsPath(w));
    const card = attendanceCard(page);
    await expect(card.getByRole('heading', { name: 'Chấm công' })).toBeVisible();

    // 31d7e86: <p> có tiền tố sr-only "Giờ hiện tại theo máy chủ: " (trước đó là aria-label) ⇒ khớp theo text.
    const clock = card.getByRole('paragraph').filter({ hasText: 'Giờ hiện tại theo máy chủ' });
    await expect(clock).toHaveText(/: \d{2}:\d{2}:\d{2}$/);
    const shown = ((await clock.textContent()) ?? '').slice(-8);
    expect(
      withinAMinute(shown, vnHm()),
      `đồng hồ ${shown} ≠ giờ VN ${vnHm()} (máy: New York)`,
    ).toBe(true);

    // Tab thứ hai mở TRƯỚC khi chấm ⇒ vẫn hiện "Chấm vào" (dữ liệu cũ) — dùng để bấm vào lần 2 qua UI. Phải bấm trong
    // 60 s kể từ lúc tab này tải (staleTime của useAttendanceToday, E) và KHÔNG bringToFront ⇒ không refetch.
    const stale = await context.newPage();
    await stale.goto(projectsPath(w));
    await expect(attendanceCard(stale).getByRole('button', { name: 'Chấm vào' })).toBeVisible();

    const punched = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/attendance/check-in'),
    );
    await card.getByRole('button', { name: 'Chấm vào' }).click();
    expect((await punched).status()).toBe(201);
    await expect(page.getByText('Đã chấm vào', { exact: true })).toBeVisible();
    await expect(cardValue(card, 'Trạng thái')).toContainText('Đang làm');
    const inOut = cardValue(card, 'Vào / Ra');
    await expect(inOut).toHaveText(/^\d{2}:\d{2} \/ —$/);
    const firstIn = ((await inOut.textContent()) ?? '').slice(0, 5);
    expect(withinAMinute(firstIn, vnHm()), `giờ vào ${firstIn} hiển thị theo giờ VN`).toBe(true);
    await expect(card.getByRole('button', { name: 'Chấm ra' })).toBeVisible();

    // Tab cũ bấm "Chấm vào" ⇒ 409 already_checked_in ⇒ toast lỗi, thẻ tải lại thành "Chấm ra"; không thêm lượt IN.
    const again = stale.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/attendance/check-in'),
    );
    await attendanceCard(stale).getByRole('button', { name: 'Chấm vào' }).click();
    expect((await again).status()).toBe(409);
    await expect(stale.getByText('Hôm nay bạn đã chấm vào rồi.', { exact: true })).toBeVisible();
    await expect(attendanceCard(stale).getByRole('button', { name: 'Chấm ra' })).toBeVisible();

    // KHÔNG chờ sang phút: vào và ra thường rơi CÙNG phút ⇒ ca này phủ luôn SD-44 ở tầng E2E (A sửa 08e3772 — so
    // lượt theo occurredAt ms; trước đó OUT cùng phút bị bỏ, thẻ vẫn "— " dù toast "Đã chấm ra", cổng T-041a).
    // Đúng 1 request OUT, lượt đầu ⇒ 201 (200 chỉ là replay cùng Idempotency-Key — A).
    const outs: number[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().endsWith('/attendance/check-out'))
        outs.push(r.status());
    });
    const out = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/attendance/check-out'),
    );
    await card.getByRole('button', { name: 'Chấm ra' }).click();
    expect((await out).status(), 'chấm ra lần đầu').toBe(201);
    await expect(page.getByText('Đã chấm ra', { exact: true })).toBeVisible();
    await expect(inOut).toHaveText(/^\d{2}:\d{2} \/ \d{2}:\d{2}$/);
    await expect(cardValue(card, 'Trạng thái')).not.toContainText('Đang làm');
    await expect(card.getByRole('button', { name: 'Chấm ra lại' })).toBeVisible();
    expect(outs, 'một lần bấm ⇒ đúng một request check-out').toEqual([201]);

    const mia = await refreshed(request, w.mia);
    const today = await apiMyToday(request, w.olivia, mia);
    expect(today.timezone).toBe('Asia/Ho_Chi_Minh');
    const { events } = await hrCall<{ events: { kind: string; voidedAt: string | null }[] }>(
      request,
      'GET',
      `/workspaces/${w.olivia.workspaceId}/attendance/me/events?date=${vnDate()}`,
      { token: mia.accessToken, expected: 200 },
    );
    expect(events.filter((e) => e.kind === 'IN')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'OUT')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- E2E-HR-02

test(`@main E2E-HR-02 [${T041B}]: gửi đơn ⇒ HR thấy chuông realtime ⇒ duyệt ⇒ nhân viên thấy chuông + bảng công "Nghỉ phép"`, async ({
  page,
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr02');
  const day = vnWorkday(3);
  await loginViaUi(page, w.mia.user);
  const hana = await openAs(browser, w.hana.user);
  await hana.page.goto(wsPath(w, 'hr?tab=leave'));
  await expect(hana.page.getByRole('tab', { name: 'Đơn nghỉ', selected: true })).toBeVisible();
  await expect(bell(hana.page)).toHaveAccessibleName('Thông báo');

  // Mia gửi đơn qua form thật (Nghỉ ốm — không phụ thuộc số dư phép năm).
  await page.goto(wsPath(w, 'leave'));
  const form = page.getByRole('form', { name: 'Gửi đơn nghỉ' });
  await form.getByLabel('Loại nghỉ').selectOption({ label: 'Nghỉ ốm' });
  await form.getByLabel('Từ ngày').fill(day);
  await form.getByLabel('Đến ngày').fill(day);
  await expect(page.getByText(/^Đơn này: 1 ngày làm việc/)).toBeVisible();
  const submitted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/leave-requests'),
  );
  await form.getByRole('button', { name: 'Gửi đơn' }).click();
  expect((await submitted).status()).toBe(201);
  await expect(page.getByText(/^Đã gửi đơn — 1 ngày, chờ duyệt/)).toBeVisible();
  const mine = page.getByRole('region', { name: 'Đơn của tôi' });
  await expect(mine.getByText('Chờ duyệt')).toBeVisible();

  // HR: chuông +1 qua notification:new, hàng đợi tự tải lại — không reload.
  await expect(bell(hana.page)).toHaveAccessibleName('Thông báo, 1 chưa đọc', REALTIME);
  const miaName = w.mia.user.fullName;
  await expect(hana.page.getByRole('listitem', { name: `Đơn của ${miaName}` })).toBeVisible(
    REALTIME,
  );
  await bell(hana.page).click();
  await expect(
    hana.page.getByRole('link', {
      name: new RegExp(`^Chưa đọc: ${miaName} gửi đơn nghỉ ốm ${ddMm(day)}`),
    }),
  ).toBeVisible();
  await hana.page.keyboard.press('Escape');

  await hana.page.getByRole('button', { name: `Duyệt đơn của ${miaName}` }).click();
  const dialog = hana.page.getByRole('dialog', { name: `Duyệt đơn của ${miaName}?` });
  await dialog.getByLabel(/^Ghi chú/).fill('Chúc mau khỏe');
  await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await expect(hana.page.getByText(`Đã duyệt đơn của ${miaName}`, { exact: true })).toBeVisible();

  // Mia: chuông +1, đơn "Đã duyệt" + ghi chú HR, bảng công ngày đó "Nghỉ phép".
  await expect(bell(page)).toHaveAccessibleName('Thông báo, 1 chưa đọc', REALTIME);
  await expect(mine.getByText('Đã duyệt')).toBeVisible(REALTIME);
  await expect(mine.getByText('Ghi chú của HR: Chúc mau khỏe')).toBeVisible();
  await bell(page).click();
  await page
    .getByRole('link', {
      name: new RegExp(`^Chưa đọc: Đơn nghỉ ốm ${ddMm(day)} của bạn đã được duyệt`),
    })
    .click();
  await expect(page).toHaveURL(/\/leave$/);
  await expect(bell(page)).toHaveAccessibleName('Thông báo');

  await page.goto(wsPath(w, `attendance?month=${day.slice(0, 7)}`));
  const table = page.getByRole('table', { name: /^Bảng công tháng/ });
  await expect(dayRow(table, day)).toContainText('Nghỉ phép');
  await hana.close();
});

test(`E2E-HR-02b [${T041B}]: nhân viên offline lúc HR từ chối ⇒ online lại ⇒ chuông + danh sách đơn tải lại (thông báo bền)`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr02b');
  const day = vnWorkday(4);
  const leave = await apiSubmitLeave(request, w.olivia, w.mia, {
    type: 'SICK',
    startDate: day,
    endDate: day,
  });

  // Socket của Mia đi qua route (như E2E-13) để cắt được.
  let offline = false;
  const sockets: { close: (o: { code: number; reason: string }) => Promise<void> }[] = [];
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (offline) return void ws.close({ code: 1006, reason: 'e2e offline' });
    ws.connectToServer();
    sockets.push(ws);
  });
  await loginViaUi(page, w.mia.user);
  await page.goto(wsPath(w, 'leave'));
  // Khoanh trong 'Đơn của tôi': dòng số dư cũng có 'đang chờ duyệt' (getByText không phân biệt hoa thường).
  const mine = page.getByRole('region', { name: 'Đơn của tôi' });
  await expect(mine.getByText('Chờ duyệt')).toBeVisible();
  expect(sockets.length, 'socket của Mia đi qua route').toBeGreaterThan(0);

  offline = true;
  await page.context().setOffline(true);
  for (const ws of sockets.splice(0)) await ws.close({ code: 1006, reason: 'e2e offline' });
  await apiDecideLeave(
    request,
    w.olivia,
    await refreshed(request, w.hana),
    leave,
    'reject',
    'Thiếu giấy tờ',
  );
  await expect(bell(page)).toHaveAccessibleName('Thông báo');

  offline = false;
  await page.context().setOffline(false);
  // Reconnect ⇒ invalidate thông báo; đơn tải lại khi trang lấy lại kết nối / focus.
  await expect(bell(page)).toHaveAccessibleName('Thông báo, 1 chưa đọc', { timeout: 15_000 });
  await bell(page).click();
  await expect(
    page.getByRole('link', {
      name: new RegExp(`^Chưa đọc: Đơn nghỉ ốm ${ddMm(day)} của bạn bị từ chối`),
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(mine.getByText('Bị từ chối')).toBeVisible();
  await expect(mine.getByText('Ghi chú của HR: Thiếu giấy tờ')).toBeVisible();
});

// ---------------------------------------------------------------- E2E-HR-03

test(`E2E-HR-03 [${T041C}]: OWNER bật "Quản lý nhân sự" cho Mia ⇒ tab của Mia hiện mục "Nhân sự" ngay (member:grants-changed); tắt ⇒ mất ngay`, async ({
  page,
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr03', { hanaIsHr: false });
  const miaName = w.mia.user.fullName;
  const mia = await openAs(browser, w.mia.user);
  await mia.page.goto(projectsPath(w));
  const miaCard = attendanceCard(mia.page);
  await expect(miaCard.getByRole('link', { name: 'Bảng công của tôi' })).toBeVisible();
  await expect(miaCard.getByRole('link', { name: 'Nhân sự' })).toHaveCount(0);

  await loginViaUi(page, w.olivia.user);
  await page.goto(wsPath(w, 'settings/members'));
  const toggle = page.getByRole('switch', { name: `Quản lý nhân sự: ${miaName}` });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // Hàng OWNER / VIEWER bị khóa.
  await expect(
    page.getByRole('switch', { name: `Quản lý nhân sự: ${w.vic.user.fullName}` }),
  ).toHaveAttribute('aria-disabled', 'true');

  await toggle.click();
  const confirm = page.getByRole('dialog', { name: `Cấp quyền Quản lý nhân sự cho ${miaName}?` });
  await confirm.getByRole('button', { name: 'Cấp quyền' }).click();
  await expect(
    page.getByText(`${miaName} đã có quyền Quản lý nhân sự`, { exact: true }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await expect(miaCard.getByRole('link', { name: 'Nhân sự' })).toBeVisible(REALTIME);
  await expect(mia.page.getByText('Bạn được cấp quyền Quản lý nhân sự').first()).toBeVisible();
  await miaCard.getByRole('link', { name: 'Nhân sự' }).click();
  await expect(mia.page.getByRole('heading', { level: 1, name: 'Nhân sự' })).toBeVisible();
  await expect(mia.page.getByRole('tablist', { name: 'Quản lý nhân sự' })).toBeVisible();

  // Thu quyền (tắt ngay, không hỏi) ⇒ trang /hr của Mia đổi sang "không có quyền" không reload.
  await toggle.click();
  await expect(
    page.getByText(`Đã thu quyền Quản lý nhân sự của ${miaName}`, { exact: true }),
  ).toBeVisible();
  await expect(mia.page.getByText('Bạn không có quyền Quản lý nhân sự')).toBeVisible(REALTIME);
  await mia.close();
});

// ---------------------------------------------------------------- E2E-HR-04

test(`E2E-HR-04 [${T041A}]: VIEWER không thấy UI chấm công (thẻ, nút header, link); /attendance báo vai trò; gọi API check-in ⇒ 403`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr04');
  await loginViaUi(page, w.vic.user);
  await page.goto(projectsPath(w));
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  // Cả trang (E): thẻ không render với VIEWER, nút gọn header cũng ẩn ở mọi độ rộng.
  await expect(attendanceCard(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Chấm (vào|ra)/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Bảng công của tôi' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Nghỉ phép' })).toHaveCount(0);

  await page.goto(wsPath(w, 'attendance'));
  await expect(
    page.getByText('Vai trò Người xem không chấm công trong workspace này'),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: /^Bảng công tháng/ })).toHaveCount(0);

  await apiCheckIn(request, w.olivia, (await refreshed(request, w.vic)).accessToken, 403);
});

test(`E2E-HR-04b [${T041B}]: VIEWER mở /leave ⇒ báo vai trò, không có form; gửi đơn qua API ⇒ 403`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr04b');
  await loginViaUi(page, w.vic.user);
  await page.goto(wsPath(w, 'leave'));
  await expect(
    page.getByText('Vai trò Người xem không xin nghỉ trong workspace này'),
  ).toBeVisible();
  await expect(page.getByRole('form', { name: 'Gửi đơn nghỉ' })).toHaveCount(0);
  await hrCall(request, 'POST', `/workspaces/${w.olivia.workspaceId}/leave-requests`, {
    token: (await refreshed(request, w.vic)).accessToken,
    body: { type: 'SICK', startDate: vnWorkday(3), endDate: vnWorkday(3), dayPart: 'FULL' },
    expected: 403,
  });
});

// ---------------------------------------------------------------- E2E-HR-05

test(`E2E-HR-05 [${T041A}]: nhắc "chưa chấm vào" trong ngày làm việc; KHÔNG tự chấm khi đăng nhập / reload`, async ({
  page,
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr05');
  const today = await hrCall<{ isWorkday: boolean; isHoliday: boolean; status: string }>(
    request,
    'GET',
    `/workspaces/${w.olivia.workspaceId}/attendance/me/today`,
    { token: w.mia.accessToken, expected: 200 },
  );
  // Điều kiện của thẻ (T-041a): ngày làm việc, không lễ, không nghỉ, chưa vào, chưa bị chốt ABSENT (sau giờ ca).
  const remind = today.isWorkday && !today.isHoliday && today.status !== 'ABSENT';

  await loginViaUi(page, w.mia.user);
  await page.goto(projectsPath(w));
  const card = attendanceCard(page);
  await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  const banner = card.getByRole('status').filter({ hasText: 'Bạn chưa chấm vào hôm nay.' });
  if (remind) await expect(banner).toBeVisible();
  else await expect(banner).toHaveCount(0);

  await page.reload();
  await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  const again = await openAs(browser, w.mia.user); // đăng nhập lại ở context mới
  await again.page.goto(projectsPath(w));
  await expect(attendanceCard(again.page).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await again.close();

  const after = await apiMyToday(request, w.olivia, await refreshed(request, w.mia));
  expect(after.firstIn, 'đăng nhập / reload không được tự tạo lượt IN').toBeNull();
});

// ---------------------------------------------------------------- E2E-HR-06

test(`E2E-HR-06 [${T041C}]: HR xuất CSV tháng (fetch + Blob, Bearer) ⇒ tên file theo tháng, có BOM`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr06');
  await apiCheckIn(request, w.olivia, w.mia.accessToken);
  await loginViaUi(page, w.hana.user);
  await page.goto(wsPath(w, 'hr?tab=timesheet'));
  const month = vnDate().slice(0, 7);
  await expect(
    page.getByRole('heading', {
      name: `Bảng công tháng ${String(Number(month.slice(5)))}/${month.slice(0, 4)}`,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tháng sau ›' })).toBeDisabled();

  const exportBtn = page.getByRole('button', { name: 'Xuất CSV' });
  await expect(exportBtn).toHaveAttribute('title', /dữ liệu cá nhân/);
  const csvRes = page.waitForResponse((r) => r.url().includes('/attendance/export.csv'));
  const download = page.waitForEvent('download');
  await exportBtn.click();
  const res = await csvRes;
  expect(res.status()).toBe(200);
  expect(
    (await res.request().allHeaders())['authorization'],
    'CSV gọi bằng Bearer (fetch), không phải link GET trần',
  ).toMatch(/^Bearer /);
  const file = await download;
  expect(file.suggestedFilename()).toContain(month);
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const bytes = await readFile(await file.path());
  expect([...bytes.subarray(0, 3)], 'BOM UTF-8 (U+FEFF)').toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.toString('utf8')).toContain(w.mia.user.fullName);
  await expect(page.getByText('Đã xuất bảng công', { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------- E2E-HR-07

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`E2E-HR-07 a11y (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`E2E-HR-07 [${T041A}]: lịch tháng là <table> có caption + tiêu đề hàng/cột, trạng thái chữ + biểu tượng; axe 0 serious/critical ở /projects (thẻ), /attendance + hộp lượt chấm, chuông (${colorScheme})`, async ({
      page,
      request,
    }) => {
      const w = await seedHrWorld(request, `hr07-${colorScheme}`);
      await apiCheckIn(request, w.olivia, w.mia.accessToken);
      await loginViaUi(page, w.mia.user);

      await page.goto(wsPath(w, 'attendance'));
      const month = vnDate().slice(0, 7);
      const table = page.getByRole('table', {
        name: `Bảng công tháng ${String(Number(month.slice(5)))}/${month.slice(0, 4)}`,
      });
      await expect(table).toBeVisible();
      for (const col of ['Ngày', 'Trạng thái', 'Vào', 'Ra', 'Giờ làm', 'Muộn / sớm']) {
        await expect(table.getByRole('columnheader', { name: col, exact: true })).toBeVisible();
      }
      expect(await table.getByRole('rowheader').count()).toBeGreaterThanOrEqual(28);
      // Trạng thái hôm nay có CHỮ (không chỉ biểu tượng aria-hidden).
      await expect(dayRow(table, vnDate()).getByRole('cell').first()).toHaveText(
        /Có mặt|Chưa chấm ra|Đang làm|Vắng|Nghỉ phép|Ngày lễ|Không phải ngày làm|Chưa tới giờ/,
      );
      expect(await seriousViolations(page), `/attendance (${colorScheme})`).toEqual([]);
      await dayRow(table, vnDate()).getByRole('rowheader').getByRole('button').click();
      await expect(page.getByRole('dialog', { name: /^Lượt chấm/ })).toBeVisible();
      expect(await seriousViolations(page), `/attendance hộp lượt chấm (${colorScheme})`).toEqual(
        [],
      );
      await page.keyboard.press('Escape');

      await page.goto(projectsPath(w));
      await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();
      expect(await seriousViolations(page), `/projects thẻ chấm công (${colorScheme})`).toEqual([]);
      await bell(page).click();
      await expect(page.getByRole('dialog', { name: 'Thông báo' })).toBeVisible();
      expect(await seriousViolations(page), `chuông thông báo (${colorScheme})`).toEqual([]);
    });

    test(`E2E-HR-07b [${T041B}]: axe 0 serious/critical ở /leave (${colorScheme})`, async ({
      page,
      request,
    }) => {
      const w = await seedHrWorld(request, `hr07b-${colorScheme}`);
      await loginViaUi(page, w.mia.user);
      await page.goto(wsPath(w, 'leave'));
      await expect(page.getByRole('form', { name: 'Gửi đơn nghỉ' })).toBeVisible();
      expect(await seriousViolations(page), `/leave (${colorScheme})`).toEqual([]);
    });

    test(`E2E-HR-07c [${T041C}]: axe 0 serious/critical ở mọi tab /hr (${colorScheme})`, async ({
      browser,
      request,
    }) => {
      const w = await seedHrWorld(request, `hr07c-${colorScheme}`);
      await apiCheckIn(request, w.olivia, w.mia.accessToken);
      const hana = await openAs(browser, w.hana.user);
      await hana.page.emulateMedia({ colorScheme });
      for (const tab of ['today', 'timesheet', 'leave', 'calendar', 'balances']) {
        await hana.page.goto(wsPath(w, `hr?tab=${tab}`));
        await expect(hana.page.getByRole('tabpanel')).toBeVisible();
        // Không exact: chờ CẢ status của trang ("Đang tải") lẫn của tab ("Đang tải đơn"…) xong rồi mới chạy axe (H).
        await expect(hana.page.getByRole('status', { name: 'Đang tải' })).toHaveCount(0);
        expect(await seriousViolations(hana.page), `/hr?tab=${tab} (${colorScheme})`).toEqual([]);
      }
      await hana.close();
    });
  });
}

// ---------------------------------------------------------------- E2E-HR-08

/** ≤ 100 ký tự (tên ngày lễ), một dòng, không ký tự điều khiển — số khác nhau ⇒ biết chỗ nào chạy. */
const P = {
  reason: '<img src=x onerror=__xss(21)>"><svg onload=alert(22)> lý do',
  note: '<script>__xss(23)</script><img src=x onerror=__xss(24)> ghi chú',
  adjust: '<a href="javascript:__xss(25)">bấm</a><svg onload=__xss(26)> điều chỉnh',
  holiday: '<details open ontoggle=__xss(27)>Lễ<img src=x onerror=__xss(28)>',
  pending: '"><iframe srcdoc="<script>parent.__xss(29)</script>"></iframe> chờ',
} as const;

/** ADJUSTMENT (lý do) cho Mia hôm nay + ngày lễ tương lai — dữ liệu XSS của phần chấm công (T-038). */
async function seedXssAttendance(request: APIRequestContext, w: HrWorld): Promise<string> {
  await apiAdjust(request, w.olivia, w.hana, w.mia.userId, {
    kind: 'IN',
    date: vnDate(),
    time: '08:00',
    reason: P.adjust,
  });
  const holiday = vnWorkday(10);
  await apiPutHoliday(request, w.olivia, w.hana, holiday, P.holiday);
  return holiday;
}

test(`E2E-HR-08 [${T041A}]: XSS (mở rộng SEC-49) — lý do ADJUSTMENT, tên ngày lễ chứa payload ⇒ chỉ là text ở chuông, hộp lượt chấm, bảng công /attendance`, async ({
  page,
  context,
  request,
}) => {
  const dialogsMia = await arm(context);
  const w = await seedHrWorld(request, 'hr08');
  const holiday = await seedXssAttendance(request, w);

  await loginViaUi(page, w.mia.user);
  await page.goto(projectsPath(w));
  // ATTENDANCE_ADJUSTED ⇒ Mia có 1 thông báo (text không chứa lý do, nhưng vẫn kiểm cả popover).
  await expect(bell(page)).toHaveAccessibleName('Thông báo, 1 chưa đọc');
  await bell(page).click();
  await expect(
    page.getByRole('dialog', { name: 'Thông báo' }).getByRole('listitem').first(),
  ).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia chuông');
  await page.keyboard.press('Escape');

  await page.goto(wsPath(w, 'attendance'));
  const table = page.getByRole('table', { name: /^Bảng công tháng/ });
  await dayRow(table, vnDate()).getByRole('rowheader').getByRole('button').click();
  const punches = page.getByRole('dialog', { name: /^Lượt chấm/ });
  await expect(punches.getByText(P.adjust)).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia lượt chấm (ADJUSTMENT)');
  await page.keyboard.press('Escape');
  await page.goto(wsPath(w, `attendance?month=${holiday.slice(0, 7)}`));
  await expect(
    dayRow(page.getByRole('table', { name: /^Bảng công tháng/ }), holiday),
  ).toContainText(P.holiday);
  await assertInert(page, dialogsMia, 'Mia bảng công (ngày lễ)');
});

test(`E2E-HR-08b [${T041B}]: XSS — lý do đơn, ghi chú HR chứa payload ⇒ chỉ là text ở /leave`, async ({
  page,
  context,
  request,
}) => {
  const dialogsMia = await arm(context);
  const w = await seedHrWorld(request, 'hr08b');
  const rejected = await apiSubmitLeave(request, w.olivia, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(3),
    endDate: vnWorkday(3),
    reason: P.reason,
  });
  await apiDecideLeave(request, w.olivia, w.hana, rejected, 'reject', P.note);
  await apiSubmitLeave(request, w.olivia, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(5),
    endDate: vnWorkday(5),
    reason: P.pending,
  });
  await loginViaUi(page, w.mia.user);
  await page.goto(wsPath(w, 'leave'));
  await expect(page.getByText(P.reason)).toBeVisible();
  await expect(page.getByText(`Ghi chú của HR: ${P.note}`)).toBeVisible();
  await expect(page.getByText(P.pending)).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia /leave');
  await bell(page).click();
  await expect(
    page.getByRole('dialog', { name: 'Thông báo' }).getByRole('listitem').first(),
  ).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia chuông (đơn bị từ chối)');
});

test(`E2E-HR-08c [${T041C}]: XSS — lý do đơn, tên ngày lễ, lý do ADJUSTMENT chứa payload ⇒ chỉ là text ở /hr (Đơn nghỉ, Lịch & ngày lễ, lượt chấm)`, async ({
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr08c');
  const holiday = await seedXssAttendance(request, w);
  const rejected = await apiSubmitLeave(request, w.olivia, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(3),
    endDate: vnWorkday(3),
    reason: P.reason,
  });
  await apiDecideLeave(request, w.olivia, w.hana, rejected, 'reject', P.note);
  await apiSubmitLeave(request, w.olivia, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(5),
    endDate: vnWorkday(5),
    reason: P.pending,
  });

  const hana = await openAs(browser, w.hana.user);
  const dialogsHana = await arm(hana.context);
  await hana.page.goto(wsPath(w, 'hr?tab=leave'));
  await expect(hana.page.getByText(P.pending)).toBeVisible();
  await hana.page.getByLabel('Trạng thái').selectOption({ label: 'Tất cả' });
  await expect(hana.page.getByText(P.reason)).toBeVisible();
  await assertInert(hana.page, dialogsHana, 'Hana /hr Đơn nghỉ');
  await hana.page.goto(wsPath(w, `hr?tab=calendar`));
  if (holiday.slice(0, 4) !== vnDate().slice(0, 4)) {
    await hana.page.getByRole('button', { name: `${holiday.slice(0, 4)} ›` }).click();
  }
  await expect(hana.page.getByText(P.holiday)).toBeVisible();
  await assertInert(hana.page, dialogsHana, 'Hana /hr Lịch & ngày lễ');
  await hana.page.goto(wsPath(w, 'hr?tab=timesheet'));
  await hana.page.getByRole('button', { name: w.mia.user.fullName }).click();
  const sheet = hana.page.getByRole('region', { name: `Bảng công của ${w.mia.user.fullName}` });
  await dayRow(sheet, vnDate()).getByRole('rowheader').getByRole('button').click();
  await expect(hana.page.getByRole('dialog').getByText(P.adjust)).toBeVisible();
  await assertInert(hana.page, dialogsHana, 'Hana lượt chấm của Mia');
  await hana.close();
});

// ---------------------------------------------------------------- E2E-HR-09

test(`@main E2E-HR-09 [${T041A}]: responsive 360 → 1440 — thẻ chấm công, /attendance không cuộn ngang trang (chạy cả firefox + mobile qua @main)`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr09');
  await loginViaUi(page, w.mia.user);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(projectsPath(w));
    const card = attendanceCard(page);
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeInViewport();
    // Nút gọn trên header chỉ từ sm (≥ 640 px) — dưới đó chỉ còn nút trong thẻ.
    const headerBtn = page
      .getByRole('navigation', { name: 'Tài khoản' })
      .getByRole('button', { name: 'Chấm vào' });
    if (width < 640) await expect(headerBtn).toBeHidden();
    else await expect(headerBtn).toBeVisible();
    await noHorizontalScroll(page, `/projects @${String(width)}`);

    await page.goto(wsPath(w, 'attendance'));
    await expect(page.getByRole('table', { name: /^Bảng công tháng/ })).toBeVisible();
    await noHorizontalScroll(page, `/attendance @${String(width)}`);
  }
});

test(`@main E2E-HR-09b [${T041B}]: responsive 360 → 1440 — /leave không cuộn ngang, nút "Gửi đơn" tới được`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr09b');
  await loginViaUi(page, w.mia.user);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(wsPath(w, 'leave'));
    const send = page.getByRole('button', { name: 'Gửi đơn' });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    await noHorizontalScroll(page, `/leave @${String(width)}`);
  }
});
