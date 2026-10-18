import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { adaToken, adaUser, apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test, type E2EUser } from '../support/fixtures';
import { hrCall } from '../support/hr';
import { awaiting } from '../support/pending';
import {
  PAYROLL,
  apiAddSalaryProfile,
  apiEditPayslip,
  apiHireForPayroll,
  apiOpenRun,
  apiPayslip,
  apiRun,
  apiUnblockOthers,
  linesOf,
  monthLabel,
  suitePeriod,
  tokenOf,
  vnd,
  type Payslip,
} from '../support/payroll';
import { arm, assertInert } from '../support/xss';

// E2E-PAY-01…09 (test-spec-payroll §10, Mốc 4 — H viết thay F, F soát). Selector theo web của E (feat/T-050-payroll-web
// @90e4a58: role + tên tiếng Việt). Backend T-049 chưa vào ⇒ fixme tới khi E2E_RUN_PENDING chứa T-049,T-050.
//
// Cách ly §0.4: bảng lương CẢ CÔNG TY, unique (period) ⇒ MỘT kỳ cho cả file (= tháng trước của mốc — startDate chỉ lùi
// ≤ 31 ngày), lane HR tuần tự (workers 1), tạo bảng ở beforeAll; mọi ca sửa NHÁP chạy trước, ca phát hành (03) rồi các
// ca của nhân viên (01, 04, 05) sau. Chỉ khẳng định phiếu của người do file tạo; không đổi payroll_settings.
// Ngoại lệ có chủ đích (TL duyệt 18/10): một công ty ⇒ bảng tháng trước gồm cả người của file HR (lùi startDate) thiếu
// hồ sơ lương / hireDate ⇒ PUBLISH_BLOCKED cho cả bảng; beforeAll bổ sung đúng hai thứ đó CHỈ khi thiếu
// (`apiUnblockOthers`), không đụng số liệu khác của họ.
// Lệch spec (TL duyệt 18/10): (1) chỉ có MỘT tháng có phiếu ⇒ ‹ › giữa hai tháng không dựng được bằng hộp đen — phủ ở
// test component của E (/payslips, T-050); ca 01 khẳng định không có link. (2) 02 không gắn @main (xem ca 02).

const PENDING = awaiting('T-049', 'T-050');

/** Bẫy XSS (09) — nhãn dòng / ghi chú (nháp, qua API) và lý do điều chỉnh (sau phát hành). */
const XSS = {
  label: '<img src=x onerror=__xss(61)> Thưởng',
  note: '<script>__xss(62)</script><svg onload=__xss(63)> ghi chú',
  reason: '<details open ontoggle=__xss(64)>lý do<img src=x onerror=__xss(65)>',
};

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const preview = (page: Page) => page.getByRole('region', { name: 'Tổng thực lĩnh (xem trước)' });

test.describe.serial('E2E-PAY bảng lương / phiếu lương', () => {
  test.fixme(PENDING, '[PENDING T-049/T-050] backend + web phiếu lương chưa vào nhánh tích hợp');

  const { period } = suitePeriod();
  let kay: E2EUser; // Kế toán (PAYROLL_MANAGE), nhiệm kỳ từ hôm nay ⇒ KHÔNG có phiếu kỳ này
  let mia: E2EUser & { userId: string }; // nhân viên xem phiếu (01, 04, 05, 09)
  let lee: E2EUser & { userId: string }; // phiếu Kế toán sửa ở 360 px (02, 07)
  let bo: E2EUser & { userId: string }; // thực lĩnh âm ⇒ chặn phát hành (03)

  test.beforeAll(async ({ request }) => {
    const { startDate } = suitePeriod();
    const y = Number(period.slice(0, 4));
    kay = newUser('pay-kay');
    await apiCreateUser(request, kay, { grants: ['PAYROLL_MANAGE'] });
    [mia, lee, bo] = await Promise.all([
      apiHireForPayroll(request, 'pay-mia', { startDate, hireDate: `${String(y - 2)}-03-10` }),
      apiHireForPayroll(request, 'pay-lee', { startDate, hireDate: `${String(y - 1)}-01-05` }),
      apiHireForPayroll(request, 'pay-bo', { startDate, hireDate: `${String(y - 3)}-06-20` }),
    ]);
    for (const [who, base] of [
      [mia, 12_000_000],
      [lee, 9_000_000],
      [bo, 8_000_000],
    ] as const) {
      await apiAddSalaryProfile(request, kay, who.userId, period, base);
    }
    await apiOpenRun(request, kay, period);
    const mine = new Set([mia.userId, lee.userId, bo.userId]);
    const run = await apiUnblockOthers(request, kay, period, mine);
    for (const id of mine) {
      expect(run.payslips.find((r) => r.user.id === id)?.blockReasons, id).toEqual([]);
    }
    // Bo: giảm trừ > thu nhập ⇒ NEGATIVE_NET_PAY (03). Mia: nhãn + ghi chú chứa bẫy XSS (09).
    await apiEditPayslip(request, kay, period, bo.userId, () => ({
      lines: [{ section: 'DEDUCTION', label: 'Tạm ứng', amount: 99_000_000 }],
    }));
    await apiEditPayslip(request, kay, period, mia.userId, () => ({
      lines: [{ section: 'BONUS', label: XSS.label, amount: 1_500_000 }],
      note: XSS.note,
    }));
  });

  test('E2E-PAY-06: Admin không có lối tắt "Phiếu lương"; Kế toán thấy "Bảng lương"', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginViaUi(page, adaUser());
    await page.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('navigation', { name: 'Menu' });
    await expect(menu.getByRole('link', { name: 'Quản trị' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Phiếu lương' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Phiếu lương', exact: true })).toHaveCount(0);
    await page.goto('/payslips');
    await expect(page.getByText('Tài khoản Quản trị không có phiếu lương')).toBeVisible();

    await page.context().clearCookies();
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginViaUi(page, kay);
    await expect(
      page.getByRole('navigation', { name: 'Công ty' }).getByRole('link', { name: 'Bảng lương' }),
    ).toBeVisible();
    const tiles = page.getByRole('region', { name: 'Việc quản lý' });
    await tiles.getByRole('link', { name: /^Bảng lương/ }).click();
    await expect(page).toHaveURL(/\/payroll$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bảng lương' })).toBeVisible();
  });

  // Spec ghi @main cho 02 — KHÔNG gắn: lane firefox / mobile chạy @main sẽ dựng người SAU khi bảng đã có (§0.4), và
  // payroll chỉ chạy ở chromium-hr (playwright.config.ts). 360 px đã phủ bằng setViewportSize.
  test('E2E-PAY-02: Kế toán 360 px — thẻ ⇒ form ⇒ gõ / dán tiền ⇒ tổng xem trước ⇒ Lưu khớp API', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginViaUi(page, kay);
    await page.goto(`/payroll/${period}`);
    const cards = page.getByRole('list', { name: 'Phiếu lương' });
    await cards.getByRole('link', { name: new RegExp(lee.fullName) }).click();
    await expect(page).toHaveURL(new RegExp(`/payroll/${period}/${lee.userId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(lee.fullName);

    await page.getByRole('button', { name: 'Thêm dòng — (2) Thưởng doanh số theo kênh' }).click();
    await page.getByLabel('Nhãn — Thưởng, dòng 1', { exact: true }).fill('Thưởng kênh Shopee');
    const typed = page.getByLabel('Số tiền — Thưởng, dòng 1', { exact: true });
    await typed.pressSequentially('7000000');
    await expect(typed).toHaveValue('7.000.000');

    await page.getByRole('button', { name: 'Thêm dòng — (1) Tiền lương chi tiết' }).click();
    await page.getByLabel('Nhãn — Lương, dòng 1', { exact: true }).fill('Phụ cấp xăng xe');
    const pasted = page.getByLabel('Số tiền — Lương, dòng 1', { exact: true });
    await pasted.fill('7,000,000'); // một lần input cả chuỗi = dán
    await expect(pasted).toHaveValue('7.000.000');

    const before = await apiPayslip(request, kay, period, lee.userId);
    const expected = before.netPay + 14_000_000;
    await expect(preview(page)).toContainText(vnd(expected));

    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(PAYROLL.payslip(period, lee.userId)) && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Lưu phiếu' }).click();
    expect((await saved).status()).toBe(200);
    const after = await apiPayslip(request, kay, period, lee.userId);
    expect(after.netPay).toBe(expected);
    expect(linesOf(after)).toEqual(
      expect.arrayContaining([
        { section: 'BONUS', label: 'Thưởng kênh Shopee', amount: 7_000_000 },
        { section: 'INCOME', label: 'Phụ cấp xăng xe', amount: 7_000_000 },
      ]),
    );
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('E2E-PAY-07: 409 khi lưu (sửa song song qua API) ⇒ giữ số đã gõ + "Tải bản mới"', async ({
    page,
    request,
  }) => {
    await loginViaUi(page, kay);
    await page.goto(`/payroll/${period}/${lee.userId}`);
    await page.getByRole('button', { name: 'Thêm dòng — (3) Các khoản giảm trừ' }).click();
    const label = page.getByLabel('Nhãn — Giảm trừ, dòng 1', { exact: true });
    const amount = page.getByLabel('Số tiền — Giảm trừ, dòng 1', { exact: true });
    await label.fill('Tạm ứng tháng');
    await amount.pressSequentially('500000');

    // Admin (ngầm có payroll:manage) sửa cùng phiếu ⇒ lockVersion tăng.
    const token = await adaToken(request);
    const current = await hrCall<Payslip>(request, 'GET', PAYROLL.payslip(period, lee.userId), {
      token,
      expected: 200,
    });
    await hrCall(request, 'PUT', PAYROLL.payslip(period, lee.userId), {
      token,
      body: {
        lines: [...linesOf(current), { section: 'BONUS', label: 'Sửa song song', amount: 1_000 }],
        note: current.note,
        overrideHalfDays: null,
        overrideReason: null,
        expectedLockVersion: current.lockVersion,
      },
      expected: 200,
    });

    await page.getByRole('button', { name: 'Lưu phiếu' }).click();
    await expect(page.getByText(/Phiếu vừa được người khác sửa/)).toBeVisible();
    await expect(label).toHaveValue('Tạm ứng tháng');
    await expect(amount).toHaveValue('500.000');
    await page.getByRole('button', { name: 'Tải bản mới' }).click();
    await expect
      .poll(() =>
        page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
      )
      .toContain('Sửa song song');
    await expect(page.getByLabel('Nhãn — Giảm trừ, dòng 1', { exact: true })).toHaveCount(0);
  });

  test('E2E-PAY-08a: axe + 360/768/1280 — /payroll/YYYY-MM, form 1 người, /payroll/profiles', async ({
    page,
  }) => {
    await loginViaUi(page, kay);
    for (const path of [
      `/payroll/${period}`,
      `/payroll/${period}/${lee.userId}`,
      '/payroll/profiles',
    ]) {
      for (const width of [360, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('status', { name: /^Đang tải/ })).toHaveCount(0);
        expect(await seriousViolations(page), `${path} @${String(width)}`).toEqual([]);
        expect(await noHorizontalScroll(page), `${path} @${String(width)} cuộn ngang`).toBe(true);
      }
    }
  });

  test('E2E-PAY-09a: XSS ở nhãn dòng / ghi chú (form Kế toán) ⇒ chỉ là chữ', async ({
    page,
    context,
  }) => {
    const dialogs = await arm(context);
    await loginViaUi(page, kay);
    await page.goto(`/payroll/${period}/${mia.userId}`);
    await expect(page.getByLabel('Nhãn — Thưởng, dòng 1', { exact: true })).toHaveValue(XSS.label);
    await expect(page.getByLabel('Ghi chú')).toHaveValue(XSS.note);
    await assertInert(page, dialogs, 'form phiếu (Kế toán)');
  });

  test('E2E-PAY-03: Phát hành bắt tick "Tôi đã kiểm tra"; bị chặn ⇒ ghi rõ người + lý do; hết chặn ⇒ phát hành', async ({
    page,
    request,
  }) => {
    await loginViaUi(page, kay);
    await page.goto(`/payroll/${period}`);
    await page.getByRole('button', { name: 'Phát hành', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: `Phát hành bảng lương tháng ${monthLabel(period)}?`,
    });
    const publish = dialog.getByRole('button', { name: 'Phát hành', exact: true });
    await expect(publish).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Tôi đã kiểm tra' }).check();
    await expect(publish).toBeEnabled();
    await publish.click();
    const blocked = dialog.getByRole('alert').filter({ hasText: 'Chưa phát hành được' });
    await expect(blocked).toContainText(`${bo.fullName}: thực lĩnh âm`);
    expect((await apiRun(request, kay, period)).status).toBe('DRAFT');

    // Sửa phiếu của Bo (bỏ giảm trừ) ⇒ phát hành lại trong cùng hộp thoại.
    await apiEditPayslip(request, kay, period, bo.userId, () => ({ lines: [] }));
    await publish.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText(`Đã phát hành bảng lương tháng ${monthLabel(period)}`).first(),
    ).toBeVisible();
    expect((await apiRun(request, kay, period)).status).toBe('PUBLISHED');
  });

  test('E2E-PAY-01: /payslips mở thẳng phiếu mới nhất; tên công ty ở đầu phiếu; title không tiền, không tên', async ({
    page,
    request,
  }) => {
    const mine = await hrCall<Payslip>(request, 'GET', PAYROLL.mySlip(period), {
      token: await tokenOf(request, mia),
      expected: 200,
    });
    await loginViaUi(page, mia);
    await page.goto('/payslips');
    await expect(page).toHaveURL(/\/payslips$/);
    const sheet = page.getByRole('article', { name: 'Phiếu lương' });
    expect(mine.companyName, 'tên công ty chụp lúc phát hành').toBeTruthy();
    await expect(sheet.locator('header')).toContainText(mine.companyName ?? '');
    await expect(sheet.locator('header')).toContainText(
      `Tháng ${period.slice(5, 7)} năm ${period.slice(0, 4)}`,
    );
    await expect(page.getByRole('region', { name: 'Tổng thực lĩnh' })).toContainText(
      vnd(mine.netPay),
    );
    await expect(page).toHaveTitle(`Phiếu lương tháng ${monthLabel(period)}`);
    const title = await page.title();
    expect(title).not.toContain(mia.fullName);
    expect(title).not.toMatch(/\d{1,3}(\.\d{3})+/);
    // Một tháng có phiếu ⇒ không có ‹ / › (hạn chế hộp đen — xem đầu file).
    await expect(
      page.getByRole('navigation', { name: 'Chọn tháng' }).getByRole('link'),
    ).toHaveCount(0);
  });

  test('E2E-PAY-04: đăng xuất ⇒ Back ⇒ không thấy số tiền', async ({ page, request }) => {
    const mine = await hrCall<Payslip>(request, 'GET', PAYROLL.mySlip(period), {
      token: await tokenOf(request, mia),
      expected: 200,
    });
    await loginViaUi(page, mia);
    await page.goto(`/payslips/${period}`);
    const money = page.getByText(vnd(mine.netPay)).first();
    await expect(money).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Tài khoản' })
      .getByRole('button', { name: 'Đăng xuất', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).not.toContainText(vnd(mine.netPay));
    expect(await page.content()).not.toContain(String(mine.netPay));
  });

  test('E2E-PAY-05 + 09b: bản cũ in "BẢN CŨ — đã được thay thế"; lý do điều chỉnh / nhãn / ghi chú là chữ', async ({
    page,
    request,
    context,
  }) => {
    const current = await apiPayslip(request, kay, period, mia.userId);
    await hrCall(request, 'POST', PAYROLL.revisions(period, mia.userId), {
      token: await tokenOf(request, kay),
      body: {
        lines: [...linesOf(current), { section: 'BONUS', label: 'Bù thưởng', amount: 200_000 }],
        note: current.note,
        overrideHalfDays: null,
        overrideReason: null,
        expectedRevision: current.revision,
        reason: XSS.reason,
      },
      expected: 201,
    });

    const dialogs = await arm(context);
    await loginViaUi(page, mia);
    await page.goto(`/payslips/${period}`);
    await expect(page.getByText(/Đã điều chỉnh lần 1/)).toContainText(XSS.reason);
    const sheet = page.getByRole('article', { name: 'Phiếu lương' });
    await expect(sheet).toContainText(XSS.label);
    await expect(sheet).toContainText(XSS.note);
    await assertInert(page, dialogs, '/payslips (bản điều chỉnh)');

    await page.getByRole('link', { name: 'Xem bản 1' }).click();
    await expect(page).toHaveURL(new RegExp(`/payslips/${period}\\?rev=1$`));
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByText('BẢN CŨ — đã được thay thế')).toBeVisible();
    await expect(page.getByRole('button', { name: 'In / Lưu PDF' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await assertInert(page, dialogs, '/payslips?rev=1');
  });

  test('E2E-PAY-08b: axe + 360/768/1280 — /payslips', async ({ page }) => {
    await loginViaUi(page, mia);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/payslips');
      await expect(page.getByRole('article', { name: 'Phiếu lương' })).toBeVisible();
      expect(await seriousViolations(page), `/payslips @${String(width)}`).toEqual([]);
      expect(await noHorizontalScroll(page), `/payslips @${String(width)} cuộn ngang`).toBe(true);
    }
  });
});
