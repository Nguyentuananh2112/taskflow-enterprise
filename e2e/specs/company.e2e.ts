import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { addDays } from '../../apps/api/test/security/harness/clock';
import { apiLogin } from '../support/api';
import { adaToken, adaUser, apiCreateUser, apiNewWorkspace } from '../support/company';
import { API_URL } from '../support/env';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { addMemberViaUi } from '../support/members';
import { seedHrWorld, vnDate } from '../support/hr';
import { openAs } from '../support/users';
import { arm, assertInert } from '../support/xss';

// E2E-HR-15…19 + axe/responsive trang công ty (test-spec-company §7, T-066). Selector theo E (17/10): T-065a đã có
// (@e8b36b2: /w, header ☰, route gốc); T-065b (/activate, /hr/employees, /admin/*) và T-065c (combobox thêm thành viên)
// chưa merge ⇒ ca phụ thuộc là fixme tới khi E2E_RUN_PENDING chứa vé (không xanh giả). E2E-HR-18 gộp vào E2E-HR-03
// (hr.e2e.ts). Một công ty (ADR-140): không khẳng định số dòng tuyệt đối của danh sách toàn công ty.

const T065A = 'T-065a';
const T065B = 'T-065b';
const T065C = 'T-065c';

const REALTIME = { timeout: 5_000 };
const HOME = '/w';

const attendanceCard = (page: Page) => page.getByRole('region', { name: 'Chấm công', exact: true });
const manageBlock = (page: Page) => page.getByRole('region', { name: 'Việc quản lý' });
const shortcuts = (page: Page) =>
  page.getByRole('navigation', { name: 'Lối tắt chấm công và nghỉ phép' });
const myWorkspaces = (page: Page) => page.getByRole('region', { name: 'Workspace của bạn' });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

// ---------------------------------------------------------------- E2E-HR-15

test(`@main E2E-HR-15 [${T065A}]: Ada ⇒ /w có "Việc quản lý" (Nhân sự, Quản trị), không thẻ / lối tắt self, chỉ ws mình là thành viên; Mia ⇒ thẻ gọn + lối tắt, không "Việc quản lý"`, async ({
  page,
  browser,
  request,
}) => {
  const mia = newUser('co15-mia');
  const { accessToken: miaToken } = await apiCreateUser(request, mia);
  // Tên ws duy nhất mỗi lượt (Ada là MỘT người cho mọi project Playwright trên cùng DB).
  const run = mia.email.slice(9, 17);
  const miaName = `WS Mia co15 ${run}`;
  const adaName = `WS Ada co15 ${run}`;
  const miaWs = await apiNewWorkspace(request, miaToken, miaName);
  const adaWs = await apiNewWorkspace(request, await adaToken(request), adaName);

  await loginViaUi(page, adaUser());
  await page.goto(HOME);
  const manage = manageBlock(page);
  await expect(manage.getByRole('link', { name: /^Nhân sự/ })).toBeVisible();
  await expect(manage.getByRole('link', { name: /^Quản trị/ })).toHaveAttribute('href', '/admin');
  await expect(attendanceCard(page)).toHaveCount(0);
  await expect(shortcuts(page)).toHaveCount(0);
  // Admin KHÔNG có quyền ngầm vào ws (ADR-134): chỉ thấy ws mình là thành viên.
  const adaList = myWorkspaces(page);
  await expect(
    adaList.getByRole('link', { name: new RegExp(`^${escapeRe(adaName)}`) }),
  ).toBeVisible();
  await expect(
    adaList.getByRole('link', { name: new RegExp(`^${escapeRe(miaName)}`) }),
  ).toHaveCount(0);
  expect(miaWs.id).not.toBe(adaWs.id);

  const m = await openAs(browser, mia);
  await m.page.goto(HOME);
  await expect(attendanceCard(m.page).getByRole('button', { name: 'Chấm vào' })).toBeVisible();
  await expect(shortcuts(m.page).getByRole('link', { name: 'Bảng công của tôi' })).toHaveAttribute(
    'href',
    '/attendance',
  );
  await expect(shortcuts(m.page).getByRole('link', { name: /^Xin nghỉ/ })).toBeVisible();
  await expect(manageBlock(m.page)).toHaveCount(0);
  await expect(
    myWorkspaces(m.page).getByRole('link', { name: new RegExp(`^${escapeRe(miaName)}`) }),
  ).toBeVisible();
  await m.close();
});

// ---------------------------------------------------------------- E2E-HR-16

test(`@main E2E-HR-16 [${T065A}]: Mia chấm Vào ở /w ⇒ nút header ở trang khác đã là "Chấm ra"; Hana /hr "Hôm nay" thấy Mia đang làm; Mia tạo workspace mới ⇒ không phải chấm lại`, async ({
  page,
  browser,
  request,
  isMobile,
}) => {
  const w = await seedHrWorld(request, 'co16', { hanaIsHr: true });
  await loginViaUi(page, w.mia.user);
  await page.goto(HOME);
  const card = attendanceCard(page);
  const punched = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/attendance/check-in`,
  );
  await card.getByRole('button', { name: 'Chấm vào' }).click();
  expect((await punched).status()).toBe(201);
  await expect(card.getByRole('button', { name: 'Chấm ra' })).toBeVisible();

  // Trang khác: nút gọn trên header (≥ sm) phản ánh đã vào — một trạng thái cho cả công ty.
  await page.goto('/leave');
  if (!isMobile) {
    await expect(
      page.getByRole('navigation', { name: 'Tài khoản' }).getByRole('button', { name: 'Chấm ra' }),
    ).toBeVisible();
  }

  const hana = await openAs(browser, w.hana.user);
  await hana.page.goto('/hr?tab=today');
  const sheet = hana.page.getByRole('region', { name: 'Bảng chấm công hôm nay' });
  const miaRow = sheet
    .getByRole('row')
    .filter({ has: hana.page.getByRole('rowheader', { name: w.mia.user.fullName, exact: true }) });
  await expect(miaRow).toContainText('đang làm');
  await hana.close();

  await page.goto(HOME);
  await myWorkspaces(page).getByRole('link', { name: 'Tạo workspace' }).click();
  await expect(page).toHaveURL(/\/w\/new$/);
  await page.getByLabel('Tên workspace').fill(`WS mới co16 ${w.mia.userId.slice(0, 8)}`);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/workspaces`,
  );
  await page.getByRole('button', { name: 'Tạo workspace' }).click();
  expect((await created).status()).toBe(201);
  await page.goto(HOME);
  await expect(myWorkspaces(page).getByRole('link', { name: /^WS mới co16/ })).toBeVisible();
  await expect(attendanceCard(page).getByRole('button', { name: 'Chấm ra' })).toBeVisible();
});

// ---------------------------------------------------------------- E2E-HR-17

test(`E2E-HR-17 [${T065B}]: Hana thêm nhân viên ở 360 px (tên chứa payload XSS) ⇒ hộp link ⇒ sao chép ⇒ context mới mở link ⇒ đặt mật khẩu ⇒ /w ⇒ chấm công; tên chỉ là text, fragment bị xóa, không request nào mang token trong URL`, async ({
  page,
  context,
  browser,
  browserName,
  request,
}) => {
  const w = await seedHrWorld(request, 'co17', { hanaIsHr: true });
  const dialogsHana = await arm(context);
  const name = '<img src=x onerror=__xss(41)><svg onload=__xss(42)> Nhàn';
  const email = `co17-${w.hana.userId.slice(0, 8)}@e2e.example`;

  await page.setViewportSize({ width: 360, height: 800 });
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await loginViaUi(page, w.hana.user);
  await page.goto('/hr/employees');
  await expect(page.getByRole('heading', { level: 1, name: 'Nhân viên' })).toBeVisible();
  const add = page.getByRole('button', { name: 'Thêm nhân viên' });
  await expect(add).toBeEnabled(); // bật khi đã có "hôm nay" của server (E)
  await add.click();
  const form = page.getByRole('dialog', { name: 'Thêm nhân viên' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Họ tên').fill(name);
  const hired = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/hr/employees`,
  );
  await form.getByRole('button', { name: 'Thêm', exact: true }).click();
  expect((await hired).status()).toBe(201);

  const box = page.getByRole('dialog', { name: `Link kích hoạt cho ${name}` });
  const link = await box.getByLabel('Link').inputValue();
  expect(link).toMatch(/\/activate#t=[^&\s]+$/);
  await box.getByRole('button', { name: 'Sao chép link' }).click();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  }
  await box.getByRole('button', { name: 'Xong' }).click();
  await assertInert(page, dialogsHana, 'Hana /hr/employees + hộp link');

  // Danh sách: tên chỉ là text, trạng thái "Chờ kích hoạt".
  await page.getByLabel('Tìm theo tên hoặc email').fill(email);
  const item = page
    .getByRole('list', { name: 'Danh sách nhân viên' })
    .getByRole('listitem', { name, exact: true });
  await expect(item).toContainText('Chờ kích hoạt');
  await assertInert(page, dialogsHana, 'Hana danh sách nhân viên');

  // Người mới: context riêng, mở đúng link HR gửi.
  const fresh = await browser.newContext({ viewport: { width: 360, height: 800 } });
  try {
    const dialogsNew = await arm(fresh);
    const p = await fresh.newPage();
    const token = new URL(link).hash.slice('#t='.length);
    const leaked: string[] = [];
    p.on('request', (r) => {
      if (r.url().includes(token)) leaked.push(`${r.method()} ${r.url()}`);
    });
    await p.goto(link);
    await expect(p.getByRole('heading', { level: 1, name: `Chào ${name}!` })).toBeVisible();
    expect(await p.evaluate(() => location.hash), 'fragment bị xóa ngay khi mở').toBe('');
    await expect(p.getByText(`Tên đăng nhập của bạn: ${email}`)).toBeVisible();
    await assertInert(p, dialogsNew, '/activate');
    await p.getByLabel('Mật khẩu mới').fill('co17-mat-khau-du-dai-9');
    const activated = p.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/auth/activate`,
    );
    await p.getByRole('button', { name: 'Kích hoạt tài khoản' }).click();
    expect((await activated).status()).toBe(200);
    await expect(p).toHaveURL(/\/w$/);
    // Mốc thứ Ba 10:00, người mới chưa chấm ⇒ dialog nhắc (T-045) CHẮC CHẮN mở ở /w và che thẻ — dùng nút của nó.
    const prompt = p.getByRole('dialog', { name: /^Chào buổi/ });
    await expect(prompt).toBeVisible();
    const checkIn = p.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/attendance/check-in`,
    );
    await prompt.getByRole('button', { name: 'Chấm công vào', exact: true }).click();
    expect((await checkIn).status()).toBe(201);
    expect(leaked, 'không request nào mang token trong URL').toEqual([]);
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------- E2E-HR-19

test(`E2E-HR-19 [${T065B} + ${T065C}]: Mia (OWNER W3) thêm Max bằng combobox; Hana cho Mia nghỉ với ngày làm cuối đã qua ⇒ tab Mia về /login (SESSION_REVOKED); W3 mồ côi ở /admin/workspaces; Ada giao OWNER cho Max`, async ({
  page,
  browser,
  request,
}) => {
  // lastDay (hôm qua) phải ≥ startDate (B T-062: không thì 422 LAST_DAY_OUT_OF_RANGE) ⇒ nhiệm kỳ từ 3 ngày trước.
  const w = await seedHrWorld(request, 'co19', {
    hanaIsHr: true,
    startDate: addDays(vnDate(), -3),
  });
  const max = newUser('co19-max');
  await apiCreateUser(request, max);
  const w3Name = `W3 co19 ${w.mia.userId.slice(0, 8)}`;
  const w3 = await apiNewWorkspace(
    request,
    (await apiLogin(request, w.mia.user)).accessToken,
    w3Name,
  );

  // Mia thêm Max bằng combobox (chỉ người thuộc công ty — ADR-134).
  await loginViaUi(page, w.mia.user);
  await page.goto(`/w/${w3.id}/settings/members`);
  const added = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url() === `${API_URL}/workspaces/${w3.id}/members`,
  );
  await addMemberViaUi(page, max, 'Thành viên');
  expect((await added).status()).toBe(201);

  // Hana cho Mia nghỉ, ngày làm cuối = hôm qua ⇒ hoàn tất ngay trong request (biên 06:00 ở CLK-HR-05).
  const hana = await openAs(browser, w.hana.user);
  const miaName = w.mia.user.fullName;
  await hana.page.goto('/hr/employees');
  await hana.page.getByLabel('Tìm theo tên hoặc email').fill(w.mia.user.email);
  await hana.page.getByRole('button', { name: `Cho ${miaName} nghỉ việc` }).click();
  const off = hana.page.getByRole('dialog', { name: `Cho ${miaName} nghỉ việc` });
  await off.getByLabel('Ngày làm cuối').fill(addDays(vnDate(), -1));
  await off.getByRole('button', { name: 'Lên lịch nghỉ việc' }).click();
  // E (T-065f 385bf93): ngày cuối đã qua ⇒ hoàn tất ngay ⇒ "Đã cho {tên} nghỉ việc" (lên lịch tương lai: "Đã lên lịch…").
  const done = hana.page.getByRole('dialog', { name: `Đã cho ${miaName} nghỉ việc` });
  await expect(done).toContainText(w3Name); // cảnh báo ws mồ côi
  await done.getByRole('button', { name: 'Đóng' }).click();
  await hana.close();

  // Tab của Mia: thao tác kế tiếp ⇒ 401 SESSION_REVOKED ⇒ về /login, không lặp refresh.
  const refreshes: string[] = [];
  page.on('request', (r) => {
    if (r.url() === `${API_URL}/auth/refresh`) refreshes.push(r.url());
  });
  await page.goto(HOME);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Phiên đăng nhập đã hết')).toBeVisible();
  expect(refreshes.length, 'SESSION_REVOKED không được refresh lặp').toBeLessThanOrEqual(1);

  // Ada: W3 mồ côi ⇒ giao OWNER cho Max.
  await loginViaUi(page, adaUser());
  await page.goto('/admin/workspaces');
  const row = page
    .getByRole('list', { name: 'Danh sách workspace' })
    .getByRole('listitem', { name: w3Name, exact: true });
  await expect(row).toContainText('Mồ côi');
  await row.getByRole('button', { name: `Giao chủ sở hữu cho ${w3Name}` }).click();
  const give = page.getByRole('dialog', { name: `Giao chủ sở hữu — ${w3Name}` });
  await give.getByLabel('Người nhận').selectOption({ label: max.fullName });
  await give.getByRole('button', { name: 'Giao', exact: true }).click();
  await expect(row).not.toContainText('Mồ côi', REALTIME);

  const m = await openAs(browser, max);
  await m.page.goto(HOME);
  await expect(
    myWorkspaces(m.page).getByRole('link', {
      name: new RegExp(`^${escapeRe(w3Name)}.*Chủ sở hữu`),
    }),
  ).toBeVisible();
  await m.close();
});

// ---------------------------------------------------------------- axe + responsive trang công ty

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`trang công ty a11y (${colorScheme})`, () => {
    test.use({ colorScheme });

    test(`E2E-HR-15b [${T065A}]: axe 0 serious/critical + không cuộn ngang 360/768/1280 ở /w của Ada và Mia (${colorScheme})`, async ({
      page,
      browser,
      request,
    }) => {
      const mia = newUser(`co15b-${colorScheme}`);
      await apiCreateUser(request, mia);
      await loginViaUi(page, adaUser());
      const m = await openAs(browser, mia);
      await m.page.emulateMedia({ colorScheme });
      for (const [who, p] of [
        ['Ada', page],
        ['Mia', m.page],
      ] as const) {
        for (const width of [360, 768, 1280]) {
          await p.setViewportSize({ width, height: 900 });
          await p.goto(HOME);
          await expect(p.getByRole('region', { name: 'Workspace của bạn' })).toBeVisible();
          await noHorizontalScroll(p, `/w ${who} @${String(width)}`);
        }
        expect(await seriousViolations(p), `/w ${who} (${colorScheme})`).toEqual([]);
      }
      // Menu ☰ (< md) mở được và đóng bằng Esc.
      await page.setViewportSize({ width: 360, height: 900 });
      const menuBtn = page.getByRole('button', { name: 'Menu' });
      await menuBtn.click();
      await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
      expect(await seriousViolations(page), `menu ☰ (${colorScheme})`).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menuBtn).toBeFocused();
      await m.close();
    });

    test(`E2E-HR-15c [${T065B}]: axe 0 serious/critical + không cuộn ngang ở /activate, /hr/employees, /admin/access, /admin/workspaces, /admin/company (${colorScheme})`, async ({
      page,
      browser,
      request,
    }) => {
      const w = await seedHrWorld(request, `co15c-${colorScheme}`, { hanaIsHr: true });
      const fresh = await browser.newContext({ colorScheme });
      try {
        const p = await fresh.newPage();
        await p.goto('/activate');
        expect(await seriousViolations(p), `/activate (${colorScheme})`).toEqual([]);
      } finally {
        await fresh.close();
      }
      const hana = await openAs(browser, w.hana.user);
      await hana.page.emulateMedia({ colorScheme });
      await hana.page.goto('/hr/employees');
      await expect(hana.page.getByRole('heading', { level: 1, name: 'Nhân viên' })).toBeVisible();
      expect(await seriousViolations(hana.page), `/hr/employees (${colorScheme})`).toEqual([]);
      await hana.close();

      await loginViaUi(page, adaUser());
      for (const path of ['/admin/access', '/admin/workspaces', '/admin/company']) {
        for (const width of [360, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await noHorizontalScroll(page, `${path} @${String(width)}`);
        }
        expect(await seriousViolations(page), `${path} (${colorScheme})`).toEqual([]);
      }
    });
  });
}
