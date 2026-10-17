import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { adaToken, adaUser } from '../support/company';
import { checkinPrompt, expect, loginViaUi, test } from '../support/fixtures';
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
  reserveDate,
  seedHrWorld,
  vnDate,
  vnHm,
  vnWorkday,
  type HrWorld,
} from '../support/hr';
import { openAs } from '../support/users';
import { arm, assertInert } from '../support/xss';

// E2E-HR-* (test-spec-hr §9, T-042) chuyển sang Mốc 3.5 "cấp công ty" (test-spec-company §6.3, T-066): chấm công /
// nghỉ phép / HR thuộc công ty — route gốc /attendance, /leave, /hr; trang chính /w có thẻ chấm công GỌN + dialog nhắc
// (E T-065a @e8b36b2: /w/:ws/projects không còn thẻ); quyền HR cấp ở /admin/access (T-065b). Selector theo E (17/10,
// role + tên tiếng Việt, không data-testid). Nhãn vé trong tên ca giữ để biết ca thuộc màn nào:
//   T-041a: thẻ Chấm công (nay ở /w), /attendance, chuông thông báo, nút gọn trên header
//   T-041b: /leave (số dư, form gửi đơn, đơn của tôi)
//   T-041c: /hr (Hôm nay, Bảng công tháng + Xuất CSV, Đơn nghỉ, Lịch & ngày lễ, Số phép)
//   T-065b: /admin/access (chưa merge ⇒ fixme tới khi E2E_RUN_PENDING chứa vé)
// Một công ty (ADR-140): HR thấy mọi ca ⇒ không khẳng định số chưa đọc / số dòng tuyệt đối của HR; ngày lễ chỉ qua
// reserveDate(); không đổi lịch công ty. Dữ liệu dựng qua API công khai (support/hr.ts, support/company.ts).
// Server luôn METRICS_PORT=0 (playwright.config.ts) — không đụng dev/prod của người dùng ở 3001/4000.

const T041A = 'T-041a';
const T041B = 'T-041b';
const T041C = 'T-041c';
const T045 = 'T-045';
const T065A = 'T-065a';
const T065B = 'T-065b';

/** Realtime (notification:new, company:access-changed) — spec: < 2 s; nới cho máy CI bận như REALTIME của collaboration. */
const REALTIME = { timeout: 5_000 };

/** Trang chính công ty — thẻ chấm công gọn, dialog nhắc T-045, "Việc quản lý", "Workspace của bạn". */
const HOME = '/w';

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

/** "d/M" không số 0 đầu — nhãn ô lịch T-046 ("Ngày 8/10, …"). */
const dM = (date: string) =>
  `${String(Number(date.slice(8, 10)))}/${String(Number(date.slice(5, 7)))}`;

/**
 * Nút ngày trong LỊCH tháng (T-046, mặc định ở /attendance và lịch từng người ở /hr): aria-label = "Ngày d/M"
 * [, "hôm nay"], nhãn, dòng phụ — nối bằng ", ". Ngày tương lai không có gì biết trước ⇒ đúng "Ngày d/M".
 */
const dayCell = (scope: Locator, date: string) =>
  scope.getByRole('button', { name: new RegExp(`^Ngày ${dM(date)}(,|$)`) });

/** Phút đi muộn ⇒ chữ của T-046: "37 phút", "2 giờ", "1 giờ 5 phút". */
function lateText(min: number): string {
  if (min < 60) return `${String(min)} phút`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${String(h)} giờ ${String(m)} phút` : `${String(h)} giờ`;
}

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

  test(`@main E2E-HR-01 [${T041A}]: thẻ Chấm công ở /w ⇒ Chấm vào ⇒ Chấm ra; giờ theo serverNow + múi giờ lịch; tab cũ bấm vào lần 2 ⇒ 409 already_checked_in`, async ({
    page,
    context,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr01');
    await loginViaUi(page, w.mia.user);
    await page.goto(HOME);
    const card = attendanceCard(page);
    await expect(card.getByRole('heading', { name: 'Chấm công' })).toBeVisible();

    // 31d7e86: <p> có tiền tố sr-only "Giờ hiện tại theo máy chủ: " (trước đó là aria-label) ⇒ khớp theo text.
    const clock = card.getByRole('paragraph').filter({ hasText: 'Giờ hiện tại theo máy chủ' });
    await expect(clock).toHaveText(/: \d{2}:\d{2}:\d{2}$/);
    const shown = ((await clock.textContent()) ?? '').slice(-8);
    // So với giờ NGHIỆP VỤ của server (mốc thứ Ba 10:00 VN + thời gian trôi), không với giờ máy test.
    const serverHm = async () =>
      vnHm((await apiMyToday(request, await refreshed(request, w.mia))).serverNow);
    const atLoad = await serverHm();
    expect(
      withinAMinute(shown, atLoad),
      `đồng hồ ${shown} ≠ giờ server ${atLoad} VN (máy: New York)`,
    ).toBe(true);

    // Tab thứ hai mở TRƯỚC khi chấm ⇒ vẫn hiện "Chấm vào" (dữ liệu cũ) — dùng để bấm vào lần 2 qua UI. Phải bấm trong
    // 60 s kể từ lúc tab này tải (staleTime của useAttendanceToday, E) và KHÔNG bringToFront ⇒ không refetch.
    const stale = await context.newPage();
    await stale.goto(HOME);
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
    const atIn = await serverHm();
    expect(withinAMinute(firstIn, atIn), `giờ vào ${firstIn} ≠ giờ server ${atIn} VN`).toBe(true);
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
    const today = await apiMyToday(request, mia);
    expect(today.timezone).toBe('Asia/Ho_Chi_Minh');
    const { events } = await hrCall<{ events: { kind: string; voidedAt: string | null }[] }>(
      request,
      'GET',
      `/attendance/me/events?date=${vnDate()}`,
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
  const w = await seedHrWorld(request, 'hr02', { hanaIsHr: true });
  const day = vnWorkday(3);
  await loginViaUi(page, w.mia.user);
  const hana = await openAs(browser, w.hana.user);
  await hana.page.goto('/hr?tab=leave');
  await expect(hana.page.getByRole('tab', { name: 'Đơn nghỉ', selected: true })).toBeVisible();

  // Mia gửi đơn qua form thật (Nghỉ ốm — không phụ thuộc số dư phép năm).
  await page.goto('/leave');
  const form = page.getByRole('form', { name: 'Gửi đơn nghỉ' });
  await form.getByLabel('Loại nghỉ').selectOption({ label: 'Nghỉ ốm' });
  await form.getByLabel('Từ ngày').fill(day);
  await form.getByLabel('Đến ngày').fill(day);
  await expect(page.getByText(/^Đơn này: 1 ngày làm việc/)).toBeVisible();
  const submitted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/leave/requests'),
  );
  await form.getByRole('button', { name: 'Gửi đơn' }).click();
  expect((await submitted).status()).toBe(201);
  await expect(page.getByText(/^Đã gửi đơn — 1 ngày, chờ duyệt/)).toBeVisible();
  const mine = page.getByRole('region', { name: 'Đơn của tôi' });
  await expect(mine.getByText('Chờ duyệt')).toBeVisible();

  // HR: chuông có chưa đọc qua notification:new, hàng đợi tự tải lại — không reload. Một công ty ⇒ không đếm tuyệt
  // đối; khẳng định đúng thông báo của ca (tên Mia + ngày) ở popover.
  await expect(bell(hana.page)).toHaveAccessibleName(/^Thông báo, \d+ chưa đọc$/, REALTIME);
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

  await page.goto(`/attendance?month=${day.slice(0, 7)}`);
  const table = page.getByRole('table', { name: /^Bảng công tháng/ });
  // T-046: ngày tương lai vẫn hiện phép đã duyệt — "Ngày d/M, Nghỉ phép, cả ngày".
  await expect(dayCell(table, day)).toHaveAccessibleName(`Ngày ${dM(day)}, Nghỉ phép, cả ngày`);
  await hana.close();
});

test(`E2E-HR-02b [${T041B}]: nhân viên offline lúc HR từ chối ⇒ online lại ⇒ chuông + danh sách đơn tải lại (thông báo bền)`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr02b', { hanaIsHr: true });
  const day = vnWorkday(4);
  const leave = await apiSubmitLeave(request, w.mia, {
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
  await page.goto('/leave');
  // Khoanh trong 'Đơn của tôi': dòng số dư cũng có 'đang chờ duyệt' (getByText không phân biệt hoa thường).
  const mine = page.getByRole('region', { name: 'Đơn của tôi' });
  await expect(mine.getByText('Chờ duyệt')).toBeVisible();
  expect(sockets.length, 'socket của Mia đi qua route').toBeGreaterThan(0);

  offline = true;
  await page.context().setOffline(true);
  for (const ws of sockets.splice(0)) await ws.close({ code: 1006, reason: 'e2e offline' });
  await apiDecideLeave(request, await refreshed(request, w.hana), leave, 'reject', 'Thiếu giấy tờ');
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

// ---------------------------------------------------------------- E2E-HR-03 (+ E2E-HR-18)

test(`E2E-HR-03 / E2E-HR-18 [${T065B}]: Ada cấp "Quản lý nhân sự" cho Mia ở /admin/access ⇒ /w của Mia hiện ô "Nhân sự" không tải lại (company:access-changed); thu lại ⇒ /hr của Mia báo không có quyền ngay`, async ({
  page,
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr03', { hanaIsHr: false });
  const miaName = w.mia.user.fullName;
  const mia = await openAs(browser, w.mia.user);
  await mia.page.goto(HOME);
  const manage = mia.page.getByRole('region', { name: 'Việc quản lý' });
  await expect(attendanceCard(mia.page).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await expect(manage).toHaveCount(0);

  await loginViaUi(page, adaUser());
  await page.goto('/admin/access');
  const row = page
    .getByRole('list', { name: 'Phân quyền' })
    .getByRole('listitem', { name: miaName, exact: true });
  const hr = row.getByRole('checkbox', { name: `Quản lý nhân sự — ${miaName}` });
  const save = async () => {
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/admin/access/${w.mia.userId}`),
    );
    await row.getByRole('button', { name: `Lưu quyền của ${miaName}` }).click();
    expect((await saved).status()).toBe(200);
  };
  await expect(hr).not.toBeChecked();
  await hr.check();
  await save();

  await expect(manage.getByRole('link', { name: /^Nhân sự/ })).toBeVisible(REALTIME);
  await expect(
    mia.page.getByText('Quyền của bạn trong công ty vừa thay đổi').first(),
  ).toBeVisible();
  await manage.getByRole('link', { name: /^Nhân sự/ }).click();
  await expect(mia.page.getByRole('heading', { level: 1, name: 'Nhân sự' })).toBeVisible();
  await expect(mia.page.getByRole('tablist', { name: 'Quản lý nhân sự' })).toBeVisible();

  // Thu quyền ⇒ trang /hr đang mở của Mia đổi sang "không có quyền" không reload (cache ['company','hr',…] bị xóa).
  await hr.uncheck();
  await save();
  await expect(mia.page.getByText('Bạn không có quyền Quản lý nhân sự')).toBeVisible(REALTIME);
  await expect(mia.page.getByRole('tablist', { name: 'Quản lý nhân sự' })).toHaveCount(0);
  await mia.close();
});

// ---------------------------------------------------------------- E2E-HR-04

test(`E2E-HR-04 [${T065A}]: VIEWER dự án vẫn là nhân viên ⇒ có thẻ chấm công ở /w; Admin (Ada) không có thẻ / nút header / lối tắt self, /attendance báo "Tài khoản Quản trị", API check-in ⇒ 403`, async ({
  page,
  browser,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr04');
  const vic = await openAs(browser, w.vic.user);
  await vic.page.goto(HOME);
  await expect(attendanceCard(vic.page).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await vic.close();

  await loginViaUi(page, adaUser());
  await page.goto(HOME);
  await expect(page.getByRole('region', { name: 'Việc quản lý' })).toBeVisible();
  await expect(attendanceCard(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Chấm (vào|ra)/ })).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' }),
  ).toHaveCount(0);

  await page.goto('/attendance');
  await expect(page.getByText('Tài khoản Quản trị không chấm công')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Về trang chính' })).toBeVisible();
  await expect(page.getByRole('table', { name: /^Bảng công tháng/ })).toHaveCount(0);

  await apiCheckIn(request, await adaToken(request), 403);
});

test(`E2E-HR-04b [${T065A}]: Admin mở /leave ⇒ "không xin nghỉ phép", không có form; gửi đơn qua API ⇒ 403`, async ({
  page,
  request,
}) => {
  await loginViaUi(page, adaUser());
  await page.goto('/leave');
  await expect(page.getByText('Tài khoản Quản trị không xin nghỉ phép')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Gửi đơn nghỉ' })).toHaveCount(0);
  await hrCall(request, 'POST', '/leave/requests', {
    token: await adaToken(request),
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

  // Mốc thứ Ba 10:00 VN: ngày làm việc, không lễ, trong ca, chưa vào ⇒ banner PHẢI hiện. Biên khác (sau 17:30
  // ⇒ ABSENT, Chủ nhật ⇒ OFF) kiểm ở hộp đen CLK-HR-01/04 với process API riêng.
  await loginViaUi(page, w.mia.user);
  await page.goto(HOME);
  const card = attendanceCard(page);
  await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await expect(
    card.getByRole('status').filter({ hasText: 'Bạn chưa chấm vào hôm nay.' }),
  ).toBeVisible();

  await page.reload();
  await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  const again = await openAs(browser, w.mia.user); // đăng nhập lại ở context mới
  await again.page.goto(HOME);
  await expect(attendanceCard(again.page).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await again.close();

  const after = await apiMyToday(request, await refreshed(request, w.mia));
  expect(after.firstIn, 'đăng nhập / reload không được tự tạo lượt IN').toBeNull();
});

// ---------------------------------------------------------------- E2E-HR-06

test(`E2E-HR-06 [${T041C}]: HR xuất CSV tháng (fetch + Blob, Bearer) ⇒ tên file theo tháng, có BOM`, async ({
  page,
  request,
}) => {
  const w = await seedHrWorld(request, 'hr06', { hanaIsHr: true });
  await apiCheckIn(request, w.mia.accessToken);
  await loginViaUi(page, w.hana.user);
  await page.goto('/hr?tab=timesheet');
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

    test(`E2E-HR-07 [${T041A}]: /attendance dạng LỊCH (T-046, mặc định) và DANH SÁCH: <table> có caption, cột T2…CN / Ngày…, hôm nay theo server, nhãn chữ; axe 0 serious/critical ở cả hai dạng, hộp ngày, /w, chuông (${colorScheme})`, async ({
      page,
      request,
    }) => {
      const w = await seedHrWorld(request, `hr07-${colorScheme}`);
      const punched = await apiCheckIn(request, w.mia.accessToken);
      await loginViaUi(page, w.mia.user);

      await page.goto('/attendance');
      const month = vnDate().slice(0, 7);
      const table = page.getByRole('table', {
        name: `Bảng công tháng ${String(Number(month.slice(5)))}/${month.slice(0, 4)}`,
      });
      await expect(table).toBeVisible();
      // LỊCH (mặc định): cột T2…CN, mỗi ngày là một nút trong <td>.
      for (const col of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) {
        await expect(table.getByRole('columnheader', { name: col, exact: true })).toBeVisible();
      }
      // "Hôm nay" theo serverNow (mốc): đúng một ô aria-current, là ô của ngày mốc. Mốc thứ Ba 10:00, ca 08:00,
      // grace 0 ⇒ "Đi muộn …" tính từ firstIn THẬT của server (thời gian trôi từ lúc API lên), chưa chấm ra ⇒ "…".
      const todayCell = table.locator('td[aria-current="date"]');
      await expect(todayCell).toHaveCount(1);
      const inHm = vnHm(punched.firstIn ?? '');
      const lateMin = Number(inHm.slice(0, 2)) * 60 + Number(inHm.slice(3, 5)) - 8 * 60;
      const inShort = `${String(Number(inHm.slice(0, 2)))}:${inHm.slice(3, 5)}`;
      await expect(todayCell.getByRole('button')).toHaveAccessibleName(
        `Ngày ${dM(vnDate())}, hôm nay, Đi muộn ${lateText(lateMin)}, ${inShort}–…`,
      );
      expect(await seriousViolations(page), `/attendance lịch (${colorScheme})`).toEqual([]);
      await dayCell(table, vnDate()).click();
      await expect(page.getByRole('dialog', { name: /^Ngày / })).toBeVisible();
      expect(await seriousViolations(page), `/attendance hộp ngày (${colorScheme})`).toEqual([]);
      await page.keyboard.press('Escape');

      // DANH SÁCH: rowheader "Th x, dd/MM", hôm nay = tr[aria-current]; lựa chọn được nhớ qua tải lại.
      const views = page.getByRole('group', { name: 'Cách xem' });
      await views.getByRole('button', { name: 'Danh sách', exact: true }).click();
      await expect(views.getByRole('button', { name: 'Danh sách', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      for (const col of ['Ngày', 'Trạng thái', 'Giờ vào', 'Giờ ra', 'Số giờ làm']) {
        await expect(table.getByRole('columnheader', { name: col, exact: true })).toBeVisible();
      }
      const todayRow = table.locator('tr[aria-current="date"]');
      await expect(todayRow).toHaveCount(1);
      await expect(todayRow.getByRole('rowheader')).toHaveAccessibleName(
        new RegExp(`${ddMm(vnDate())}$`),
      );
      await expect(dayRow(table, vnDate())).toContainText(`Đi muộn ${lateText(lateMin)}`);
      expect(await seriousViolations(page), `/attendance danh sách (${colorScheme})`).toEqual([]);
      await page.reload();
      await expect(views.getByRole('button', { name: 'Danh sách', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await views.getByRole('button', { name: 'Lịch', exact: true }).click();

      await page.goto(HOME);
      await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();
      expect(await seriousViolations(page), `/w thẻ chấm công (${colorScheme})`).toEqual([]);
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
      await page.goto('/leave');
      await expect(page.getByRole('form', { name: 'Gửi đơn nghỉ' })).toBeVisible();
      expect(await seriousViolations(page), `/leave (${colorScheme})`).toEqual([]);
    });

    test(`E2E-HR-07c [${T041C}]: axe 0 serious/critical ở mọi tab /hr (${colorScheme})`, async ({
      browser,
      request,
    }) => {
      const w = await seedHrWorld(request, `hr07c-${colorScheme}`, { hanaIsHr: true });
      await apiCheckIn(request, w.mia.accessToken);
      const hana = await openAs(browser, w.hana.user);
      await hana.page.emulateMedia({ colorScheme });
      for (const tab of ['today', 'timesheet', 'leave', 'calendar', 'balances']) {
        await hana.page.goto(`/hr?tab=${tab}`);
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
  await apiAdjust(request, w.hana, w.mia.userId, {
    kind: 'IN',
    date: vnDate(),
    time: '08:00',
    reason: P.adjust,
  });
  const holiday = reserveDate();
  await apiPutHoliday(request, w.hana, holiday, P.holiday);
  return holiday;
}

test(`E2E-HR-08 [${T041A}]: XSS (mở rộng SEC-49) — lý do ADJUSTMENT, tên ngày lễ chứa payload ⇒ chỉ là text ở chuông, hộp lượt chấm, bảng công /attendance`, async ({
  page,
  context,
  request,
}) => {
  const dialogsMia = await arm(context);
  const w = await seedHrWorld(request, 'hr08', { hanaIsHr: true });
  const holiday = await seedXssAttendance(request, w);

  await loginViaUi(page, w.mia.user);
  await page.goto(HOME);
  // ATTENDANCE_ADJUSTED ⇒ Mia có 1 thông báo (text không chứa lý do, nhưng vẫn kiểm cả popover).
  await expect(bell(page)).toHaveAccessibleName('Thông báo, 1 chưa đọc');
  await bell(page).click();
  await expect(
    page.getByRole('dialog', { name: 'Thông báo' }).getByRole('listitem').first(),
  ).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia chuông');
  await page.keyboard.press('Escape');

  await page.goto('/attendance');
  const table = page.getByRole('table', { name: /^Bảng công tháng/ });
  await dayCell(table, vnDate()).click();
  const punches = page.getByRole('dialog', { name: /^Ngày / }); // T-046: "Ngày Th x, dd/MM"
  await expect(punches.getByText(P.adjust)).toBeVisible();
  await assertInert(page, dialogsMia, 'Mia lượt chấm (ADJUSTMENT)');
  await page.keyboard.press('Escape');
  await page.goto(`/attendance?month=${holiday.slice(0, 7)}`);
  // Tên lễ nằm ở aria-label (thuộc tính) VÀ chữ hiển thị của ô — cả hai chỉ là text.
  const holidayCell = dayCell(page.getByRole('table', { name: /^Bảng công tháng/ }), holiday);
  await expect(holidayCell).toHaveAccessibleName(`Ngày ${dM(holiday)}, Ngày lễ, ${P.holiday}`);
  await expect(holidayCell).toContainText(P.holiday);
  await assertInert(page, dialogsMia, 'Mia bảng công (ngày lễ)');
});

test(`E2E-HR-08b [${T041B}]: XSS — lý do đơn, ghi chú HR chứa payload ⇒ chỉ là text ở /leave`, async ({
  page,
  context,
  request,
}) => {
  const dialogsMia = await arm(context);
  const w = await seedHrWorld(request, 'hr08b', { hanaIsHr: true });
  const rejected = await apiSubmitLeave(request, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(3),
    endDate: vnWorkday(3),
    reason: P.reason,
  });
  await apiDecideLeave(request, w.hana, rejected, 'reject', P.note);
  await apiSubmitLeave(request, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(5),
    endDate: vnWorkday(5),
    reason: P.pending,
  });
  await loginViaUi(page, w.mia.user);
  await page.goto('/leave');
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
  const w = await seedHrWorld(request, 'hr08c', { hanaIsHr: true });
  const holiday = await seedXssAttendance(request, w);
  const rejected = await apiSubmitLeave(request, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(3),
    endDate: vnWorkday(3),
    reason: P.reason,
  });
  await apiDecideLeave(request, w.hana, rejected, 'reject', P.note);
  await apiSubmitLeave(request, w.mia, {
    type: 'SICK',
    startDate: vnWorkday(5),
    endDate: vnWorkday(5),
    reason: P.pending,
  });

  const hana = await openAs(browser, w.hana.user);
  const dialogsHana = await arm(hana.context);
  await hana.page.goto('/hr?tab=leave');
  // Một công ty: hàng đợi có cả đơn cùng payload của ca khác (HR-08b) ⇒ khoanh trong đơn của Mia ca này.
  const miaLeaves = hana.page.getByRole('listitem', { name: `Đơn của ${w.mia.user.fullName}` });
  await expect(miaLeaves.getByText(P.pending)).toBeVisible();
  await hana.page.getByLabel('Trạng thái').selectOption({ label: 'Tất cả' });
  await expect(miaLeaves.getByText(P.reason)).toBeVisible();
  await assertInert(hana.page, dialogsHana, 'Hana /hr Đơn nghỉ');
  await hana.page.goto(`/hr?tab=calendar`);
  if (holiday.slice(0, 4) !== vnDate().slice(0, 4)) {
    await hana.page.getByRole('button', { name: `${holiday.slice(0, 4)} ›` }).click();
  }
  // Một công ty: danh sách ngày lễ có cả lễ cùng tên của HR-08 (ngày khác, reserveDate) ⇒ khoanh theo ngày của ca này
  // (dòng "Thứ x, dd/mm/yyyy · <tên>").
  const holidayDmy = `${holiday.slice(8, 10)}/${holiday.slice(5, 7)}/${holiday.slice(0, 4)}`;
  await expect(hana.page.getByText(`${holidayDmy} · ${P.holiday}`)).toBeVisible();
  await assertInert(hana.page, dialogsHana, 'Hana /hr Lịch & ngày lễ');
  await hana.page.goto('/hr?tab=timesheet');
  // Một công ty (§0.4): bảng công tháng có MỌI nhân viên của lượt chạy, phân trang "Tải thêm", không có ô tìm ⇒ tải tới
  // khi thấy Mia (không dựa trang 1 — đỏ ở 5840a31 khi DB E2E đã tích lũy > 48 người).
  const miaBtn = hana.page.getByRole('button', { name: w.mia.user.fullName, exact: true });
  const more = hana.page.getByRole('button', { name: 'Tải thêm' });
  // Chờ bảng có dữ liệu (thấy Mia hoặc nút "Tải thêm") rồi mới đếm — đếm sớm ra 0 khi bảng còn đang tải.
  await expect(miaBtn.or(more).first()).toBeVisible();
  for (let i = 0; i < 30 && (await miaBtn.count()) === 0; i += 1) {
    await expect(more, `không thấy ${w.mia.user.fullName} và hết "Tải thêm"`).toBeVisible();
    await more.click();
    await expect(more.or(miaBtn).first()).toBeVisible();
  }
  await miaBtn.click();
  const sheet = hana.page.getByRole('region', { name: `Bảng công của ${w.mia.user.fullName}` });
  // T-046: lịch T2…CN như /attendance — đúng một ô hôm nay (theo server), là ô của ngày mốc.
  await expect(sheet.locator('td[aria-current="date"]')).toHaveCount(1);
  await expect(sheet.locator('td[aria-current="date"]').getByRole('button')).toHaveAccessibleName(
    new RegExp(`^Ngày ${dM(vnDate())}, hôm nay, `),
  );
  await dayCell(sheet, vnDate()).click();
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
    await page.goto(HOME);
    const card = attendanceCard(page);
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeInViewport();
    // Nút gọn trên header chỉ từ sm (≥ 640 px) — dưới đó chỉ còn nút trong thẻ.
    const headerBtn = page
      .getByRole('navigation', { name: 'Tài khoản' })
      .getByRole('button', { name: 'Chấm vào' });
    if (width < 640) await expect(headerBtn).toBeHidden();
    else await expect(headerBtn).toBeVisible();
    await noHorizontalScroll(page, `/w @${String(width)}`);

    await page.goto('/attendance');
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
    await page.goto('/leave');
    const send = page.getByRole('button', { name: 'Gửi đơn' });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    await noHorizontalScroll(page, `/leave @${String(width)}`);
  }
});

// ---------------------------------------------------------------- E2E-HR-10..12 (T-045: dialog nhắc chấm công)

test.describe('T-045 dialog nhắc chấm công', () => {
  // Ca kiểm CHÍNH dialog ⇒ không để fixture tự bấm "Để sau".
  test.use({ checkinPrompt: 'keep' });

  test(`@main E2E-HR-10 [${T045}]: mốc thứ Ba 10:00, chưa chấm ⇒ dialog "Chào buổi sáng" ⇒ "Chấm công vào" ⇒ toast giờ server; tải lại không hiện nữa`, async ({
    page,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr10');
    await loginViaUi(page, w.mia.user);
    await expect(page).toHaveURL(/\/w$/); // Đăng nhập đáp thẳng xuống /w, nơi dialog nhắc mở và ghi "đã hiện" ngay ⇒ KHÔNG goto lại (tải lại = dialog đã dùng).
    const dialog = checkinPrompt(page);
    await expect(dialog).toBeVisible();
    // 10:00 < 11:00 ⇒ "buổi sáng"; tên = từ cuối của họ tên.
    await expect(dialog).toHaveAccessibleName(
      `Chào buổi sáng, ${w.mia.user.fullName.trim().split(/\s+/).at(-1) ?? ''}!`,
    );
    await expect(dialog.getByText('Hôm nay bạn chưa chấm công.', { exact: true })).toBeVisible();
    await expect(dialog).toContainText('Ca làm hôm nay: 08:00–17:30');
    const main = dialog.getByRole('button', { name: 'Chấm công vào', exact: true });
    await expect(main).toBeFocused();

    const punched = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/attendance/check-in'),
    );
    await main.click();
    const res = await punched;
    expect(res.status()).toBe(201);
    const card = (await res.json()) as { data: { firstIn: string } };
    const toast = page.getByText(/^Đã chấm vào lúc \d{2}:\d{2}$/);
    await expect(toast).toBeVisible();
    // Giờ trong toast = giờ VN của firstIn server trả về (giờ nghiệp vụ theo mốc), không phải giờ máy.
    await expect(toast).toHaveText(`Đã chấm vào lúc ${vnHm(card.data.firstIn)}`);
    await expect(dialog).toHaveCount(0);
    await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();

    await page.reload();
    await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test(`E2E-HR-11 [${T045}]: "Để sau" ⇒ đóng, không tự chấm; tải lại / tab mới cùng phiên không hiện lại trong ngày`, async ({
    page,
    context,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr11');
    await loginViaUi(page, w.mia.user);
    await expect(page).toHaveURL(/\/w$/); // Đăng nhập đáp thẳng xuống /w, nơi dialog nhắc mở và ghi "đã hiện" ngay ⇒ KHÔNG goto lại (tải lại = dialog đã dùng).
    const dialog = checkinPrompt(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Để sau', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const card = attendanceCard(page);
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
    await expect(
      card.getByRole('status').filter({ hasText: 'Bạn chưa chấm vào hôm nay.' }),
    ).toBeVisible();

    await page.reload();
    await expect(card.getByRole('button', { name: 'Chấm vào' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const tab = await context.newPage();
    await tab.goto(HOME);
    await expect(attendanceCard(tab).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
    await expect(checkinPrompt(tab)).toHaveCount(0);

    const today = await apiMyToday(request, await refreshed(request, w.mia));
    expect(today.firstIn, 'dialog không được tự chấm').toBeNull();
  });

  test(`E2E-HR-12 [${T045}]: không hiện cho Admin (không chấm công), cũng không hiện cho người đã chấm vào`, async ({
    page,
    browser,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr12');
    await apiCheckIn(request, w.mia.accessToken);

    await loginViaUi(page, w.mia.user);
    await page.goto(HOME);
    // Thẻ đã tải dữ liệu hôm nay (nút "Chấm ra") ⇒ dialog nếu có thì đã phải hiện.
    await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();
    await expect(checkinPrompt(page)).toHaveCount(0);

    const ada = await openAs(browser, adaUser(), { checkinPrompt: 'keep' });
    await ada.page.goto(HOME);
    // /w dựng cả trang sau một lần /auth/me (E) ⇒ thấy "Việc quản lý" là trang đã xong.
    await expect(ada.page.getByRole('region', { name: 'Việc quản lý' })).toBeVisible();
    await expect(attendanceCard(ada.page)).toHaveCount(0);
    await expect(checkinPrompt(ada.page)).toHaveCount(0);
    await ada.close();
  });

  test(`E2E-HR-13 [${T045}]: đăng xuất rồi đăng nhập lại trong ngày ⇒ dialog hiện lại (45d8b36 xóa khóa "đã hiện" khi đăng xuất — hành vi chấp nhận)`, async ({
    page,
    request,
  }) => {
    const w = await seedHrWorld(request, 'hr13');
    await loginViaUi(page, w.mia.user);
    await expect(page).toHaveURL(/\/w$/); // Đăng nhập đáp thẳng xuống /w, nơi dialog nhắc mở và ghi "đã hiện" ngay ⇒ KHÔNG goto lại (tải lại = dialog đã dùng).
    const dialog = checkinPrompt(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Để sau', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Tài khoản' })
      .getByRole('button', { name: 'Đăng xuất', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await loginViaUi(page, w.mia.user);
    await expect(page).toHaveURL(/\/w$/); // Đăng nhập đáp thẳng xuống /w, nơi dialog nhắc mở và ghi "đã hiện" ngay ⇒ KHÔNG goto lại (tải lại = dialog đã dùng).
    await expect(dialog).toBeVisible();
    // Vẫn không tự chấm.
    const today = await apiMyToday(request, await refreshed(request, w.mia));
    expect(today.firstIn).toBeNull();
  });
});

// ---------------------------------------------------------------- E2E-HR-14 (ổn định bố cục trang chính /w)

declare global {
  interface Window {
    __layoutShifts?: {
      value: number;
      hadRecentInput: boolean;
      moves: { node: string; dy: number }[];
    }[];
  }
}

/** Độ dịch DỌC lớn nhất cho phép của một phần tử trong <main> (TL d9 chốt: 8 px, tính cả entry có hadRecentInput). */
const MAX_SHIFT_PX = 8;

test.describe('Ổn định bố cục /w', () => {
  // Đi trọn luồng thật: dialog nhắc ⇒ "Chấm công vào" ⇒ banner nhắc biến mất (chính chỗ từng kéo danh sách lên 49 px).
  test.use({ checkinPrompt: 'keep' });

  // Ba bề rộng: thẻ Chấm công đổi bố cục theo breakpoint (360: xếp dọc, cao ~457 px) ⇒ chỗ giữ phải đúng ở từng cỡ.
  // Mia (nhân viên: thẻ gọn + lối tắt + Workspace) ở 3 bề rộng + Hana (hr:manage ⇒ thêm khối "Việc quản lý") ở 360.
  const cases = [
    { width: 360, who: 'mia' },
    { width: 768, who: 'mia' },
    { width: 1280, who: 'mia' },
    { width: 360, who: 'hana' },
  ] as const;
  for (const { width, who } of cases) {
    test(`E2E-HR-14 [${T065A}] @${String(width)}px ${who}: /w — thẻ Chấm công tải, dialog nhắc, chấm vào: không phần tử nào trong <main> dịch dọc > ${String(MAX_SHIFT_PX)} px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      // Gắn TRƯỚC khi tải trang (buffered) ⇒ bắt cả lúc thẻ xuất hiện và lúc dữ liệu thẻ về.
      await page.addInitScript(() => {
        const describe = (n: Node | null | undefined): string => {
          if (!(n instanceof Element)) return String(n?.nodeName ?? 'null');
          const label = n.getAttribute('aria-label');
          const cls =
            typeof n.className === 'string' ? n.className.split(/\s+/).slice(0, 3).join('.') : '';
          return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${label ? `[${label}]` : ''}`;
        };
        window.__layoutShifts = [];
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as {
              value: number;
              hadRecentInput: boolean;
              sources?: {
                node?: Node;
                previousRect: DOMRectReadOnly;
                currentRect: DOMRectReadOnly;
              }[];
            }[]) {
              const moves = (e.sources ?? [])
                // Chỉ nội dung trang: dialog, toast, header nằm ngoài <main>.
                .filter((src) => src.node instanceof Element && src.node.closest('main') !== null)
                .map((src) => ({
                  node: describe(src.node),
                  dy: Math.round(src.currentRect.y - src.previousRect.y),
                }));
              window.__layoutShifts?.push({
                value: e.value,
                hadRecentInput: e.hadRecentInput,
                moves,
              });
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          // Trình duyệt không có Layout Instability API (Firefox) ⇒ mảng rỗng; ca chỉ có ý nghĩa ở Chromium.
        }
      });

      const w = await seedHrWorld(request, `hr14-${String(width)}-${who}`, {
        hanaIsHr: who === 'hana',
      });
      await loginViaUi(page, w[who].user);
      await expect(page).toHaveURL(/\/w$/); // Đăng nhập đáp thẳng xuống /w, nơi dialog nhắc mở và ghi "đã hiện" ngay ⇒ KHÔNG goto lại (tải lại = dialog đã dùng).
      const card = attendanceCard(page);
      const prompt = checkinPrompt(page);
      await expect(prompt).toBeVisible();
      await prompt.getByRole('button', { name: 'Chấm công vào', exact: true }).click();
      await expect(prompt).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Chấm ra' })).toBeVisible();
      await expect(
        card.getByRole('status').filter({ hasText: 'Bạn chưa chấm vào hôm nay.' }),
      ).toHaveCount(0);
      // 8ef85ed (E): ô nhắc không biến mất mà đổi chữ ⇒ không còn cú kéo lên khi chấm.
      await expect(
        card.getByRole('status').filter({ hasText: /^Đã chấm vào lúc \d{1,2}:\d{2}\.$/ }),
      ).toBeVisible();
      // Chờ khung hình sau thay đổi cuối (banner biến mất) để observer kịp ghi.
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
      );

      const shifts = (await page.evaluate(() => window.__layoutShifts)) ?? [];
      const moves = shifts.flatMap((e) =>
        e.moves.map((m) => ({ ...m, hadRecentInput: e.hadRecentInput })),
      );
      const big = moves.filter((m) => Math.abs(m.dy) > MAX_SHIFT_PX);
      expect(
        big,
        `@${String(width)}px ${who} — phần tử trong <main> dịch > ${String(MAX_SHIFT_PX)} px: ${JSON.stringify(big)}`,
      ).toEqual([]);
    });
  }
});
