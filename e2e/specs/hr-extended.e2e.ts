import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
  isDateFormat,
  readXlsx,
  workbookViolations,
} from '../../apps/api/test/security/harness/xlsx-read';
import { adaUser, apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { apiAdjust, ddMm, hrCall, refreshed, vnDate, type HrPerson } from '../support/hr';
import { openAs } from '../support/users';
import { arm, assertInert } from '../support/xss';

// E2E-HR-20…25 (test-spec-hr-extended §9, Mốc 5 — giao diện của E ở feat/m5-hr T-058a/b/c; selector E 17–18/10 chép ở
// §9, bản trong code là chuẩn cuối). H viết (TL 18/10, giảm tải F), F soát. Cách ly §0.4: mỗi ca tự tạo người tên duy
// nhất; thông báo kiểm theo nội dung có tên người của ca (không đếm tuyệt đối); chính sách phép CHỈ sửa NĂM SAU và khôi
// phục ở afterAll; export khẳng định dòng của người do ca tạo. Dữ liệu dựng qua API công khai.

const REALTIME = { timeout: 5_000 };
const SLOW = { timeout: 15_000 }; // tạo file .xlsx ở server

/**
 * Toast (Radix — vùng "Thông báo"). `includeHidden`: toast bắn khi dialog modal còn mở ⇒ Radix đặt aria-hidden cho phần
 * ngoài dialog (gồm vùng toast) — vẫn hiện trên màn hình.
 */
const toast = (page: Page, text: string | RegExp) =>
  page
    .getByRole('region', { name: /Thông báo/, includeHidden: true })
    .getByText(text)
    .first();
const bell = (page: Page) => page.getByRole('button', { name: /^Thông báo/ });
/** "d/M" không số 0 đầu — nhãn nút ngày của lịch tháng ("Ngày 13/10, …"). */
const dM = (date: string) =>
  `${String(Number(date.slice(8, 10)))}/${String(Number(date.slice(5, 7)))}`;
const calendarDay = (page: Page, date: string) =>
  page.getByRole('button', { name: new RegExp(`^Ngày ${dM(date)}(,|$)`) });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ngày làm việc S0 (T2–T7) TRƯỚC "hôm nay" của mốc E2E ≥ `back` ngày. */
function pastWorkday(back: number): string {
  const d = new Date(`${vnDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Ngày làm việc S0 ngay trước `date`. */
function workdayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Người thuộc công ty (tên duy nhất). `startDate` lùi ⇒ ngày quá khứ thuộc nhiệm kỳ (MISSING_OUT hợp lệ). */
async function person(
  request: APIRequestContext,
  label: string,
  opts: { hr?: boolean; startDate?: string } = {},
): Promise<HrPerson> {
  const user = newUser(`${label}-${randomUUID().slice(0, 4)}`);
  const s = await apiCreateUser(request, user, {
    ...(opts.hr ? { grants: ['HR_MANAGE'] } : {}),
    ...(opts.startDate ? { startDate: opts.startDate } : {}),
  });
  return { user, userId: s.userId, accessToken: s.accessToken };
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

/** Mở chi tiết ngày ở /attendance (lịch tháng mặc định) ⇒ dialog "Ngày …". */
async function openMyDay(page: Page, date: string): Promise<Locator> {
  // Ngày có thể thuộc THÁNG TRƯỚC (hôm nay là 1–2) ⇒ mở đúng tháng của ngày (F).
  await page.goto(`/attendance?month=${date.slice(0, 7)}`);
  await calendarDay(page, date).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`${ddMm(date)}$`) });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Tab "Bổ sung giờ (N)" của /hr ⇒ thẻ đơn của `name` ngày `date` (listitem "{tên} — {ngày}"). */
async function hrCorrectionCard(page: Page, name: string, date: string): Promise<Locator> {
  await page.goto('/hr');
  await page.getByRole('tab', { name: /^Bổ sung giờ/ }).click();
  const card = page.getByRole('listitem', {
    name: new RegExp(`^${esc(name)} — .*${ddMm(date)}$`),
  });
  await expect(card).toBeVisible();
  return card;
}

/** MISSING_OUT: HR ghi IN qua API cho ngày quá khứ (không có OUT). */
async function missingOut(request: APIRequestContext, hr: HrPerson, who: HrPerson, date: string) {
  await apiAdjust(request, await refreshed(request, hr), who.userId, {
    kind: 'IN',
    date,
    time: '08:00',
    reason: 'E2E vào ca',
  });
}

// ---------------------------------------------------------------- E2E-HR-20 (T-058b)

test.describe('E2E-HR-20 đơn bổ sung giờ', () => {
  test('quên chấm ra ⇒ nhân viên xin bổ sung giờ ra ⇒ HR thấy đơn + thông báo ⇒ Duyệt ⇒ nhân viên: thông báo + ngày "Đi làm"', async ({
    page,
    browser,
    request,
  }) => {
    const day = pastWorkday(1);
    const hana = await person(request, 'hr20-hana', { hr: true });
    const mia = await person(request, 'hr20-mia', { startDate: pastWorkday(10) });
    await missingOut(request, hana, mia, day);

    await loginViaUi(page, mia.user);
    const dialog = await openMyDay(page, day);
    await dialog.getByRole('button', { name: 'Xin bổ sung giờ ra' }).click();
    const form = dialog.getByRole('form', { name: 'Xin bổ sung giờ ra' });
    await form.getByLabel('Giờ ra').fill('17:30');
    await form.getByLabel('Lý do').fill('Quên bấm Ra khi về');
    await form.getByRole('button', { name: 'Gửi đơn' }).click();
    await expect(toast(page, /^Đã gửi đơn — chờ/)).toBeVisible();
    await expect(dialog.getByText(/Đã gửi đơn .* — chờ duyệt/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Hủy đơn' })).toBeVisible();

    const hr = await openAs(browser, hana.user);
    // Chuông của HR: thông báo có TÊN người của ca (không đếm tuyệt đối — một công ty).
    await hr.page.goto('/hr');
    await bell(hr.page).click();
    await expect(hr.page.getByText(`${mia.user.fullName} gửi đơn bổ sung giờ`)).toBeVisible(
      REALTIME,
    );
    await hr.page.keyboard.press('Escape');
    const card = await hrCorrectionCard(hr.page, mia.user.fullName, day);
    await expect(card.getByText('Xin giờ ra 17:30')).toBeVisible();
    await card
      .getByRole('button', { name: `Duyệt đơn bổ sung giờ của ${mia.user.fullName}` })
      .click();
    const confirm = hr.page.getByRole('dialog', {
      name: `Duyệt đơn bổ sung giờ của ${mia.user.fullName}?`,
    });
    await confirm.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(toast(hr.page, `Đã duyệt đơn của ${mia.user.fullName}`)).toBeVisible();
    await hr.close();

    // Về trang sạch (dialog ngày còn mở làm phần ngoài aria-hidden ⇒ chuông không có trong cây a11y).
    await page.goto('/w');
    await bell(page).click();
    await expect(page.getByText('Đơn bổ sung giờ của bạn đã được duyệt')).toBeVisible(REALTIME);
    await page.keyboard.press('Escape');
    await page.goto(`/attendance?month=${day.slice(0, 7)}`);
    // Code của E: ngày đủ giờ là "Đi làm" (spec ghi "Có mặt" — báo F); hết "Quên chấm ra".
    await expect(calendarDay(page, day)).toHaveAccessibleName(/, Đi làm(,|$)/);
    await expect(calendarDay(page, day)).not.toHaveAccessibleName(/Quên chấm ra/);
  });

  test('vế phụ: giờ ra < 06:00 ⇒ "Ra sau nửa đêm (sáng hôm sau)"; "Hủy đơn"; HR "Từ chối"', async ({
    page,
    browser,
    request,
  }) => {
    // day2 = ngày làm việc TRƯỚC day1 (thứ Hai: pastWorkday(1) và (2) cùng là thứ Bảy — F).
    const day1 = pastWorkday(1);
    const day2 = workdayBefore(day1);
    const hana = await person(request, 'hr20b-hana', { hr: true });
    const mia = await person(request, 'hr20b-mia', { startDate: pastWorkday(10) });
    await missingOut(request, hana, mia, day1);
    await missingOut(request, hana, mia, day2);

    await loginViaUi(page, mia.user);
    let dialog = await openMyDay(page, day1);
    await dialog.getByRole('button', { name: 'Xin bổ sung giờ ra' }).click();
    const form = dialog.getByRole('form', { name: 'Xin bổ sung giờ ra' });
    const nextDay = form.getByLabel('Ra sau nửa đêm (sáng hôm sau)');
    await expect(nextDay).toHaveCount(0); // chưa có giờ ⇒ chưa hỏi
    await form.getByLabel('Giờ ra').fill('01:30');
    await nextDay.check();
    await form.getByLabel('Lý do').fill('Làm đêm, quên bấm Ra');
    await form.getByRole('button', { name: 'Gửi đơn' }).click();
    await expect(dialog.getByRole('button', { name: 'Hủy đơn' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Hủy đơn' }).click();
    await expect(toast(page, 'Đã hủy đơn bổ sung giờ')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Xin bổ sung giờ ra' })).toBeVisible();

    await page.keyboard.press('Escape');
    dialog = await openMyDay(page, day2);
    await dialog.getByRole('button', { name: 'Xin bổ sung giờ ra' }).click();
    const form2 = dialog.getByRole('form', { name: 'Xin bổ sung giờ ra' });
    await form2.getByLabel('Giờ ra').fill('17:45');
    await form2.getByLabel('Lý do').fill('Quên bấm Ra');
    await form2.getByRole('button', { name: 'Gửi đơn' }).click();
    await expect(toast(page, /^Đã gửi đơn — chờ/)).toBeVisible();

    const hr = await openAs(browser, hana.user);
    const card = await hrCorrectionCard(hr.page, mia.user.fullName, day2);
    await card
      .getByRole('button', { name: `Từ chối đơn bổ sung giờ của ${mia.user.fullName}` })
      .click();
    await hr.page
      .getByRole('dialog', { name: `Từ chối đơn bổ sung giờ của ${mia.user.fullName}?` })
      .getByRole('button', { name: 'Từ chối', exact: true })
      .click();
    await expect(toast(hr.page, `Đã từ chối đơn của ${mia.user.fullName}`)).toBeVisible();
    await hr.close();

    await page.goto('/w');
    await bell(page).click();
    await expect(page.getByText('Đơn bổ sung giờ của bạn bị từ chối')).toBeVisible(REALTIME);
  });
});

// ---------------------------------------------------------------- E2E-HR-21 (T-058a)

interface ProfileRef {
  version: number;
  hireDate: string | null;
  department: string | null;
}
const apiProfile = (request: APIRequestContext, hr: HrPerson, userId: string) =>
  hrCall<ProfileRef>(request, 'GET', `/hr/employee-profiles/${userId}`, {
    token: hr.accessToken,
    expected: 200,
  });
const apiPutProfile = (
  request: APIRequestContext,
  hr: HrPerson,
  userId: string,
  body: Record<string, unknown>,
) =>
  hrCall(request, 'PUT', `/hr/employee-profiles/${userId}`, {
    token: hr.accessToken,
    body,
    expected: 200,
  });

/** /hr/employees ⇒ tìm theo tên ⇒ "Sửa hồ sơ của {tên}" ⇒ dialog "Sửa hồ sơ — {tên}". */
async function openProfile(page: Page, name: string): Promise<Locator> {
  await page.goto('/hr/employees');
  await page.getByLabel('Tìm theo tên hoặc email').fill(name);
  await page.getByRole('button', { name: `Sửa hồ sơ của ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Sửa hồ sơ — ${name}` });
  await expect(dialog.getByLabel('Phòng ban')).toBeVisible();
  return dialog;
}

/** Lưu xong: toast, HOẶC hộp còn mở với "Đã lưu hồ sơ." + "Đóng" khi server trả cảnh báo (đổi ngày vào). */
async function expectSaved(page: Page, dialog: Locator, name: string): Promise<void> {
  const saved = toast(page, `Đã lưu hồ sơ của ${name}`).or(dialog.getByText('Đã lưu hồ sơ.'));
  await expect(saved).toBeVisible();
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('@main E2E-HR-21 hồ sơ nhân viên (360 px)', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('HR sửa hồ sơ (4 ô) ⇒ đổi ngày vào cần lý do ⇒ 409 "Tải bản mới" ⇒ nhân viên /my-profile 4 dòng chỉ đọc; menu "Hồ sơ của tôi" sau "Nghỉ phép"', async ({
    page,
    browser,
    request,
  }) => {
    const hana = await person(request, 'hr21-hana', { hr: true });
    const mia = await person(request, 'hr21-mia');
    const name = mia.user.fullName;

    await loginViaUi(page, hana.user);
    let dialog = await openProfile(page, name);
    await dialog.getByLabel('Ngày vào công ty').fill('2024-03-01');
    await dialog.getByLabel('Phòng ban').fill('Kế toán');
    await dialog.getByLabel('Chức vụ').fill('Nhân viên');
    await dialog.getByLabel('Số điện thoại công việc').fill('0901 234 567');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expectSaved(page, dialog, name);

    // Ngày vào ĐÃ CÓ ⇒ đổi phải có lý do (nút Lưu khóa tới khi nhập).
    dialog = await openProfile(page, name);
    await dialog.getByLabel('Ngày vào công ty').fill('2024-02-15');
    const reason = dialog.getByLabel('Lý do sửa ngày vào công ty');
    await expect(reason).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    await reason.fill('Nhập nhầm ngày ký hợp đồng');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expectSaved(page, dialog, name);

    // 409: mở hộp, người khác sửa qua API ⇒ Lưu ⇒ "Tải bản mới" ⇒ hộp hiện bản của người kia.
    dialog = await openProfile(page, name);
    const h = await refreshed(request, hana);
    const current = await apiProfile(request, h, mia.userId);
    await apiPutProfile(request, h, mia.userId, {
      department: 'Kinh doanh',
      expectedVersion: current.version,
    });
    await dialog.getByLabel('Chức vụ').fill('Trưởng nhóm');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await dialog.getByRole('button', { name: 'Tải bản mới' }).click();
    await expect(dialog.getByLabel('Phòng ban')).toHaveValue('Kinh doanh');
    await page.keyboard.press('Escape');

    const emp = await openAs(browser, mia.user);
    await emp.page.getByRole('button', { name: 'Menu' }).click();
    const menu = emp.page.getByRole('navigation', { name: 'Menu' });
    const labels = await menu.getByRole('link').allTextContents();
    expect(labels.indexOf('Hồ sơ của tôi'), JSON.stringify(labels)).toBe(
      labels.indexOf('Nghỉ phép') + 1,
    );
    await menu.getByRole('link', { name: 'Hồ sơ của tôi' }).click();
    await expect(emp.page).toHaveURL(/\/my-profile$/);
    await expect(emp.page.getByRole('heading', { level: 1, name: 'Hồ sơ của tôi' })).toBeVisible();
    for (const label of ['Ngày vào công ty', 'Phòng ban', 'Chức vụ', 'Số điện thoại công việc']) {
      await expect(emp.page.locator('dl dt', { hasText: label })).toHaveCount(1);
    }
    await expect(emp.page.locator('dl')).toContainText('Kinh doanh');
    await expect(emp.page.locator('dl').getByRole('textbox')).toHaveCount(0); // chỉ đọc
    await emp.close();
  });

  test('Admin không có mục "Hồ sơ của tôi"; thêm nhân viên có trường hồ sơ; nhận lại: radio ngày vào, nút nằm trong thân hộp', async ({
    page,
    request,
  }) => {
    await loginViaUi(page, adaUser());
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Hồ sơ của tôi' }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto('/hr/employees');
    await page.getByRole('button', { name: 'Thêm nhân viên' }).click();
    const hire = page.getByRole('dialog', { name: 'Thêm nhân viên' });
    for (const field of ['Phòng ban', 'Chức vụ', 'Số điện thoại công việc']) {
      await expect(hire.getByLabel(field)).toBeVisible();
    }
    // 360 px: thân hộp cuộn ⇒ nút nằm TRONG thân hộp (không dính đáy) — cuộn tới được (§9).
    const add = hire.getByRole('button', { name: 'Thêm', exact: true });
    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport();
    await hire.getByRole('button', { name: 'Hủy' }).click();

    // Người đã nghỉ có ngày vào ⇒ "Nhận lại" hỏi giữ ngày cũ / ngày mới.
    const hana = await person(request, 'hr21b-hana', { hr: true });
    const quinn = await person(request, 'hr21b-quinn', { startDate: pastWorkday(20) });
    const h = await refreshed(request, hana);
    const p = await apiProfile(request, h, quinn.userId);
    await apiPutProfile(request, h, quinn.userId, {
      hireDate: '2023-05-02',
      expectedVersion: p.version,
      ...(p.hireDate ? { reason: 'E2E đặt ngày vào' } : {}),
    });
    await hrCall(request, 'PUT', `/hr/employees/${quinn.userId}/offboarding`, {
      token: h.accessToken,
      body: { lastDay: pastWorkday(1) },
      expected: 200,
    });
    await page.goto('/hr/employees?status=left');
    await page.getByLabel('Tìm theo tên hoặc email').fill(quinn.user.fullName);
    await page.getByRole('button', { name: `Nhận lại ${quinn.user.fullName}` }).click();
    const rehire = page.getByRole('dialog', { name: `Nhận lại ${quinn.user.fullName}` });
    const dates = rehire.getByRole('radiogroup', { name: 'Chọn ngày vào công ty' });
    await expect(
      dates.getByRole('radio', { name: /^Giữ ngày vào cũ \(02\/05\/2023\)/ }),
    ).toBeChecked();
    await expect(dates.getByRole('radio', { name: 'Ngày vào mới' })).toBeVisible();
    const back = rehire.getByRole('button', { name: 'Nhận lại', exact: true });
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await rehire.getByRole('button', { name: 'Hủy' }).click();
  });
});

// ---------------------------------------------------------------- E2E-HR-22 (T-058c)

/** Dòng (chỉ số 0) của sheet có ô đúng bằng `name`, hoặc -1. */
const rowOf = (rows: (string | number | null)[][], name: string) =>
  rows.findIndex((r) => r.includes(name));

/** Bấm `button` ⇒ chờ file + response export ⇒ tên file khớp header, nội dung an toàn (ADR-130). */
async function downloadXlsx(page: Page, button: Locator) {
  const response = page.waitForResponse((r) => r.url().includes('/export.xlsx') && r.ok());
  const download = page.waitForEvent('download');
  await button.click();
  const [res, file] = await Promise.all([response, download]);
  const disposition = res.headers()['content-disposition'] ?? '';
  const fromHeader = decodeURIComponent(
    /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ??
      /filename="([^"]+)"/i.exec(disposition)?.[1] ??
      '',
  );
  expect(fromHeader, `Content-Disposition: ${disposition}`).not.toBe('');
  expect(file.suggestedFilename()).toBe(fromHeader);
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const wb = readXlsx(await readFile(path));
  expect(workbookViolations(wb)).toEqual([]);
  return wb;
}

test.describe('E2E-HR-22 tải 2 file Excel', () => {
  test('Bảng công tháng + báo cáo nghỉ phép: tên file khớp header, file an toàn, dòng của người do ca tạo, ô ngày là ngày thật', async ({
    page,
    request,
  }) => {
    const hana = await person(request, 'hr22-hana', { hr: true });
    const mia = await person(request, 'hr22-mia', { startDate: pastWorkday(10) });
    // Đơn nghỉ đã duyệt ⇒ có dòng ngày trong báo cáo phép.
    const leaveDay = (() => {
      const d = new Date(`${vnDate()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 3);
      while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const leave = await hrCall<{ id: string; version: number }>(
      request,
      'POST',
      '/leave/requests',
      {
        token: mia.accessToken,
        body: { type: 'ANNUAL', startDate: leaveDay, endDate: leaveDay, dayPart: 'FULL' },
        expected: 201,
      },
    );
    await hrCall(request, 'POST', `/leave/requests/${leave.id}/approve`, {
      token: (await refreshed(request, hana)).accessToken,
      body: { expectedVersion: leave.version },
      expected: 200,
    });

    await loginViaUi(page, hana.user);
    await page.goto('/hr');
    await page.getByRole('tab', { name: 'Bảng công tháng' }).click();
    const sheetWb = await downloadXlsx(page, page.getByRole('button', { name: 'Tải Excel' }));
    expect(sheetWb.sheets.some((s) => rowOf(s.rows, mia.user.fullName) >= 0)).toBe(true);

    await page.getByRole('tab', { name: 'Số phép' }).click();
    await page.getByRole('button', { name: 'Tải báo cáo nghỉ phép' }).click();
    const dialog = page.getByRole('dialog', { name: /^Báo cáo nghỉ phép năm \d{4}$/ });
    const leaveWb = await downloadXlsx(page, dialog.getByRole('button', { name: 'Tải Excel' }));
    const year = vnDate().slice(0, 4);
    const balances = leaveWb.sheet(`Số dư ${year}`);
    expect(rowOf(balances.rows, mia.user.fullName)).toBeGreaterThanOrEqual(0);
    // Ô ngày (TL chốt — ngày thật, a712076f): dòng có tên Mia ở sheet đơn đã duyệt có ô định dạng ngày.
    const dated = leaveWb.sheets.some((s) => {
      const r = rowOf(s.rows, mia.user.fullName);
      return r >= 0 && s.cells.some((c) => c.row === r && isDateFormat(c.style.formatCode));
    });
    expect(dated, 'ô ngày của đơn đã duyệt là ngày thật').toBe(true);
  });

  test('đang tạo ⇒ nút khóa "Đang tạo file…"; 429 ⇒ câu dễ hiểu, không có file', async ({
    page,
    request,
  }) => {
    const hana = await person(request, 'hr22b-hana', { hr: true });
    await loginViaUi(page, hana.user);
    await page.goto('/hr');
    await page.getByRole('tab', { name: 'Bảng công tháng' }).click();
    const button = page.getByRole('button', { name: 'Tải Excel' });

    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/export.xlsx**', async (route) => {
      await held;
      await route.continue();
    });
    await button.click();
    await expect(page.getByRole('button', { name: 'Đang tạo file…' })).toBeDisabled();
    release();
    await expect(toast(page, 'Đã tải file Excel')).toBeVisible(SLOW);
    await page.unroute('**/export.xlsx**');

    let downloads = 0;
    page.on('download', () => (downloads += 1));
    await page.route('**/export.xlsx**', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'retry-after': '60' },
        body: JSON.stringify({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 60 } },
          meta: { timestamp: new Date().toISOString(), requestId: randomUUID() },
        }),
      }),
    );
    await page.getByRole('button', { name: 'Tải Excel' }).click();
    await expect(
      toast(page, 'Đang có nhiều file được tạo hoặc bạn vừa xuất nhiều lần — thử lại sau ít phút.'),
    ).toBeVisible();
    expect(downloads).toBe(0);
  });
});

// ---------------------------------------------------------------- E2E-HR-23 (T-058c) — CHỈ năm sau, khôi phục afterAll

type Policy = Record<string, unknown> & { version: number };
const NOT_FIELDS = new Set([
  'year',
  'source',
  'inheritedFromYear',
  'version',
  'editable',
  'updatedAt',
  'updatedBy',
]);
const nextYear = Number(vnDate().slice(0, 4)) + 1;

test.describe('E2E-HR-23 chính sách phép năm sau', () => {
  let original: Record<string, unknown> | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    const ada = adaUser();
    const { accessToken } = await hrCall<{ accessToken: string }>(api, 'POST', '/auth/login', {
      body: { email: ada.email, password: ada.password },
      expected: 200,
    });
    const p = await hrCall<Policy>(api, 'GET', `/leave/policy?year=${String(nextYear)}`, {
      token: accessToken,
      expected: 200,
    });
    original = Object.fromEntries(Object.entries(p).filter(([k]) => !NOT_FIELDS.has(k)));
    await api.dispose();
  });

  // Năm sau đang INHERITED / DEFAULT ⇒ không xóa được dòng: khôi phục = PUT CÙNG giá trị (năm sau thành SET, thôi kế
  // thừa năm nay). Vô hại vì E2E cấm sửa năm nay (§0.4) — F đồng ý 18/10.
  test.afterAll(async ({ playwright }) => {
    if (!original) return;
    const api = await playwright.request.newContext();
    const ada = adaUser();
    const { accessToken } = await hrCall<{ accessToken: string }>(api, 'POST', '/auth/login', {
      body: { email: ada.email, password: ada.password },
      expected: 200,
    });
    const now = await hrCall<Policy>(api, 'GET', `/leave/policy?year=${String(nextYear)}`, {
      token: accessToken,
      expected: 200,
    });
    await hrCall(api, 'PUT', `/leave/policy/${String(nextYear)}`, {
      token: accessToken,
      body: { ...original, expectedVersion: now.version, reason: 'E2E-HR-23 khôi phục' },
      expected: 200,
    });
    await api.dispose();
  });

  test('"Cài chính sách phép" ⇒ Năm sau ⇒ bật chuyển phép, tối đa 5 ngày ⇒ lưu ⇒ số phép năm sau có "Chuyển sang"', async ({
    page,
    request,
  }) => {
    const hana = await person(request, 'hr23-hana', { hr: true });
    const mia = await person(request, 'hr23-mia');
    await loginViaUi(page, hana.user);
    await page.goto('/hr');
    await page.getByRole('tab', { name: 'Số phép' }).click();
    await page.getByRole('button', { name: 'Cài chính sách phép' }).click();
    const dialog = page.getByRole('dialog', { name: 'Chính sách phép năm' });
    await dialog
      .getByRole('group', { name: 'Chọn năm' })
      .getByRole('button', { name: `Năm sau (${String(nextYear)})` })
      .click();
    await expect(
      dialog.getByRole('button', { name: `Năm sau (${String(nextYear)})` }),
    ).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByLabel('Cho chuyển phép chưa dùng sang năm sau').check();
    await dialog.getByLabel('Tối đa số ngày').fill('5');
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await dialog.getByRole('button', { name: 'Xác nhận lưu' }).click();
    await expect(toast(page, `Đã lưu chính sách phép năm ${String(nextYear)}`)).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Năm sau ›' }).click();
    await expect(
      page.getByRole('heading', { name: `Số phép năm ${String(nextYear)}` }),
    ).toBeVisible();
    const table = page.getByRole('table', {
      name: `Số phép năm ${String(nextYear)} của từng nhân viên`,
    });
    // Một công ty, một DB cho cả lượt E2E (§0.4): bảng phân trang — Mia (tạo mới) có thể không ở trang 1 ⇒ "Tải thêm"
    // tới khi thấy dòng (như HR-08c). Chờ bảng có dữ liệu trước khi đếm (F, lượt E2E đầy đủ 189bcdcf).
    const miaRow = table.getByRole('row').filter({ hasText: mia.user.fullName });
    const more = page.getByRole('button', { name: 'Tải thêm' });
    await expect(table.getByRole('row').nth(1)).toBeVisible();
    for (let page_ = 0; page_ < 20 && (await miaRow.count()) === 0; page_ += 1) {
      // Mỗi trang 50 dòng, server tính số dư từng người ⇒ ở DB của lượt đầy đủ (~150 người, máy tải) một trang có thể
      // > 10 s (lượt 1aa6bd0a: trang 3 còn aria-busy sau 10 s — đã báo D đo).
      await expect(more).toBeEnabled({ timeout: 30_000 });
      await more.click();
      await expect(miaRow.or(more)).toBeVisible({ timeout: 30_000 });
    }
    await expect(miaRow).toBeVisible();
    const headers = await table.getByRole('columnheader').allTextContents();
    const col = headers.findIndex((h) => h.trim() === 'Chuyển sang');
    expect(col, JSON.stringify(headers)).toBeGreaterThan(0);
    // ADR-131: carried(Y+1) do chính sách NĂM NAY (carryOverEnabled(Y)) quyết định — E2E cấm sửa năm nay (§0.4) ⇒ không
    // ép ra số; ô "Chuyển sang" phải KHỚP API (0 ⇒ "—"). Đã báo F/TL sửa §9 (spec cũ đòi "hiện chuyển sang").
    const row = table.getByRole('row').filter({ hasText: mia.user.fullName });
    const { carriedOverDays: carried } = await hrCall<{ carriedOverDays: number }>(
      request,
      'GET',
      `/leave/balances/me?year=${String(nextYear)}`,
      { token: (await refreshed(request, mia)).accessToken, expected: 200 },
    );
    const cell = row.locator('th, td').nth(col);
    if (carried > 0) await expect(cell).toContainText(String(carried).replace('.', ','));
    else await expect(cell).toHaveText('—');

    // Chính sách năm sau đã LƯU thật: mở lại ⇒ ô đã tick, tối đa 5.
    await page.getByRole('button', { name: 'Cài chính sách phép' }).click();
    const again = page.getByRole('dialog', { name: 'Chính sách phép năm' });
    await again.getByRole('button', { name: `Năm sau (${String(nextYear)})` }).click();
    await expect(again.getByLabel('Cho chuyển phép chưa dùng sang năm sau')).toBeChecked();
    await expect(again.getByLabel('Tối đa số ngày')).toHaveValue('5');
  });
});

// ---------------------------------------------------------------- E2E-HR-24 axe + responsive

declare global {
  interface Window {
    __hrxShifts?: { node: string; dy: number }[];
  }
}
const MAX_SHIFT_PX = 8; // như E2E-HR-14 (TL d9)

for (const width of [360, 768, 1280]) {
  test.describe(`@main E2E-HR-24 axe + bố cục (${String(width)} px)`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('tab "Bổ sung giờ", form đơn, /my-profile, hộp "Sửa hồ sơ", form chính sách: 0 vi phạm serious/critical, không cuộn ngang; /hr không dịch > 8 px', async ({
      page,
      browser,
      request,
    }) => {
      const day = pastWorkday(1);
      const hana = await person(request, `hr24-${String(width)}-hana`, { hr: true });
      const mia = await person(request, `hr24-${String(width)}-mia`, {
        startDate: pastWorkday(10),
      });
      await missingOut(request, hana, mia, day);

      // Nhân viên: form đơn + /my-profile.
      const emp = await openAs(browser, mia.user);
      const dialog = await openMyDay(emp.page, day);
      await dialog.getByRole('button', { name: 'Xin bổ sung giờ ra' }).click();
      await expect(dialog.getByRole('form', { name: 'Xin bổ sung giờ ra' })).toBeVisible();
      expect(await seriousViolations(emp.page), 'form đơn bổ sung').toEqual([]);
      await emp.page.goto('/my-profile');
      await expect(
        emp.page.getByRole('heading', { level: 1, name: 'Hồ sơ của tôi' }),
      ).toBeVisible();
      expect(await seriousViolations(emp.page), '/my-profile').toEqual([]);
      await noHorizontalScroll(emp.page, '/my-profile');
      await emp.close();

      // HR: /hr (đo dịch bố cục từ lúc tải), tab Bổ sung giờ, Sửa hồ sơ, chính sách.
      await page.addInitScript(() => {
        window.__hrxShifts = [];
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as {
              sources?: {
                node?: Node;
                previousRect: DOMRectReadOnly;
                currentRect: DOMRectReadOnly;
              }[];
            }[]) {
              for (const s of e.sources ?? []) {
                if (!(s.node instanceof Element) || !s.node.closest('main')) continue;
                window.__hrxShifts?.push({
                  node: s.node.tagName.toLowerCase(),
                  dy: Math.round(s.currentRect.y - s.previousRect.y),
                });
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          // Không có Layout Instability API (không phải Chromium) ⇒ mảng rỗng.
        }
      });
      await loginViaUi(page, hana.user);
      await page.goto('/hr');
      // Code của E: 6 tab (spec ghi 7 — báo F).
      for (const name of [
        'Hôm nay',
        'Bảng công tháng',
        'Đơn nghỉ',
        /^Bổ sung giờ/,
        'Lịch & ngày lễ',
        'Số phép',
      ]) {
        await expect(page.getByRole('tab', { name })).toBeVisible();
      }
      await page.waitForLoadState('networkidle');
      const big = ((await page.evaluate(() => window.__hrxShifts)) ?? []).filter(
        (m) => Math.abs(m.dy) > MAX_SHIFT_PX,
      );
      expect(big, `/hr @${String(width)}px dịch > ${String(MAX_SHIFT_PX)} px`).toEqual([]);
      await noHorizontalScroll(page, '/hr');

      await page.getByRole('tab', { name: /^Bổ sung giờ/ }).click();
      await expect(page.getByRole('region', { name: 'Đơn bổ sung giờ' })).toBeVisible();
      expect(await seriousViolations(page), 'tab Bổ sung giờ').toEqual([]);

      const profile = await openProfile(page, mia.user.fullName);
      expect(await seriousViolations(page), 'hộp Sửa hồ sơ').toEqual([]);
      await profile.getByRole('button', { name: 'Hủy' }).click();

      await page.goto('/hr');
      await page.getByRole('tab', { name: 'Số phép' }).click();
      await page.getByRole('button', { name: 'Cài chính sách phép' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Chính sách phép năm' }).getByLabel('Số ngày phép năm'),
      ).toBeVisible();
      expect(await seriousViolations(page), 'form chính sách').toEqual([]);
    });
  });
}

// ---------------------------------------------------------------- E2E-HR-25 XSS

const P = {
  dept: '<img src=x onerror=__xss(51)> Phòng',
  title: '<a href="javascript:__xss(52)">bấm</a><svg onload=__xss(53)> Chức vụ',
  reason:
    '"><iframe srcdoc="<script>parent.__xss(54)</script>"></iframe> quên ra javascript:__xss(55)',
};

test('E2E-HR-25: XSS ở phòng ban / chức vụ / lý do đơn ⇒ hiện văn bản, không chạy (bẫy xss.e2e.ts)', async ({
  page,
  context,
  browser,
  request,
}) => {
  const dialogs = await arm(context);
  const day = pastWorkday(1);
  const hana = await person(request, 'hr25-hana', { hr: true });
  const mia = await person(request, 'hr25-mia', { startDate: pastWorkday(10) });
  const h = await refreshed(request, hana);
  const p = await apiProfile(request, h, mia.userId);
  await apiPutProfile(request, h, mia.userId, {
    department: P.dept,
    jobTitle: P.title,
    expectedVersion: p.version,
  });
  await missingOut(request, hana, mia, day);
  await hrCall(request, 'POST', '/attendance/corrections', {
    token: (await refreshed(request, mia)).accessToken,
    headers: { 'idempotency-key': randomUUID() },
    body: { date: day, kind: 'OUT', time: '17:30', reason: P.reason },
    expected: 201,
  });

  await loginViaUi(page, hana.user);
  const card = await hrCorrectionCard(page, mia.user.fullName, day);
  await expect(card.getByText(`Lý do: ${P.reason}`)).toBeVisible();
  await assertInert(page, dialogs, 'tab Bổ sung giờ');
  // Danh sách /hr/employees hiện phòng ban / chức vụ ngay trong thẻ ⇒ kiểm trước khi mở hộp (F).
  await page.goto('/hr/employees');
  await page.getByLabel('Tìm theo tên hoặc email').fill(mia.user.fullName);
  await expect(page.getByRole('listitem', { name: mia.user.fullName })).toBeVisible();
  await assertInert(page, dialogs, '/hr/employees');
  const dialog = await openProfile(page, mia.user.fullName);
  await expect(dialog.getByLabel('Phòng ban')).toHaveValue(P.dept);
  await expect(dialog.getByLabel('Chức vụ')).toHaveValue(P.title);
  await assertInert(page, dialogs, 'hộp Sửa hồ sơ');

  const emp = await openAs(browser, mia.user);
  const empDialogs = await arm(emp.context);
  await emp.page.goto('/my-profile');
  await expect(emp.page.locator('dl')).toContainText(P.dept);
  await expect(emp.page.locator('dl')).toContainText(P.title);
  await assertInert(emp.page, empDialogs, '/my-profile');
  await emp.close();
});
