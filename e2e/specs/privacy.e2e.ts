import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';

import { adaToken, adaUser, apiCreateUser } from '../support/company';
import {
  expect,
  loginViaUi,
  newUser,
  privacyPrompt,
  test,
  type E2EUser,
} from '../support/fixtures';
import { hrCall } from '../support/hr';

// E2E-PRIV-01…03 (T-075 — data-retention.md §5, TL 18/10): thông báo quyền riêng tư trên API thật của G
// (GET /me/privacy, POST /me/privacy/ack, PUT /me/privacy/consent, privacyContact ở PATCH /company) — đã vào nhánh
// tích hợp feat/privacy (3fee5388). Lane HR tuần tự (đổi đầu mối của CẢ công ty); ca đổi
// đầu mối chạy CUỐI file và trả lại giá trị cũ.

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function employee(request: APIRequestContext, label: string): Promise<E2EUser> {
  const user = newUser(label);
  await apiCreateUser(request, user);
  return user;
}

const login = async (request: APIRequestContext, user: E2EUser) =>
  (
    await hrCall<{ accessToken: string }>(request, 'POST', '/auth/login', {
      body: { email: user.email, password: user.password },
      expected: 200,
    })
  ).accessToken;

test.describe.serial('E2E-PRIV thông báo quyền riêng tư', () => {
  test.use({ privacyPrompt: 'keep' });

  test('E2E-PRIV-01: lần đầu ở /leave ⇒ hộp thoại (không ở /w); Esc = để sau; tải lại ⇒ hiện lại; "Tôi đã đọc" ⇒ hết; a11y', async ({
    page,
    request,
  }) => {
    const mia = await employee(request, 'priv01-mia');
    await loginViaUi(page, mia);
    await expect(page.getByRole('region', { name: 'Chấm công', exact: true })).toBeVisible();
    await expect(privacyPrompt(page)).toHaveCount(0);

    await page.getByRole('contentinfo').getByRole('link', { name: 'Quyền riêng tư' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Quyền riêng tư' })).toBeVisible();
    await expect(privacyPrompt(page)).toHaveCount(0); // trang đầy đủ ⇒ không chồng hộp thoại
    expect(await seriousViolations(page)).toEqual([]);

    await page.goto('/leave');
    const dialog = privacyPrompt(page);
    await expect(dialog).toBeVisible();
    for (const name of [
      'Chấm công & Nghỉ phép',
      'Hồ sơ nhân sự',
      'Trò chuyện & ảnh đại diện',
      'Phiếu lương',
    ]) {
      await expect(dialog.getByRole('heading', { name })).toBeVisible();
    }
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press('Escape'); // Esc = để sau
    await expect(dialog).toHaveCount(0);

    await page.reload(); // tải lại = phiên mới của tab ⇒ hiện lại
    await expect(privacyPrompt(page)).toBeVisible();
    await privacyPrompt(page).getByRole('button', { name: 'Tôi đã đọc' }).click();
    await expect(privacyPrompt(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('form', { name: 'Gửi đơn nghỉ' })).toBeVisible();
    await expect(privacyPrompt(page)).toHaveCount(0);
    const me = await hrCall<{ needsAck: boolean }>(request, 'GET', '/me/privacy', {
      token: await login(request, mia),
      expected: 200,
    });
    expect(me.needsAck).toBe(false);
  });

  test('E2E-PRIV-02: lý do nghỉ — chưa đồng ý ⇒ ô khóa (API 422); đồng ý ở /privacy ⇒ gửi được; rút lại ⇒ khóa lại', async ({
    page,
    request,
  }) => {
    const an = await employee(request, 'priv02-an');
    const token = await login(request, an);
    await hrCall(request, 'POST', '/me/privacy/ack', {
      token,
      body: { version: 1 },
      expected: 200,
    });
    // Server là lớp chặn chính (G): có lý do mà chưa đồng ý ⇒ 422 LEAVE_REASON_CONSENT_REQUIRED.
    await expect(
      hrCall(request, 'POST', '/leave/requests', {
        token,
        body: { type: 'ANNUAL', startDate: '2099-01-05', endDate: '2099-01-05', reason: 'Về quê' },
        expected: 201,
      }),
    ).rejects.toThrow(/LEAVE_REASON_CONSENT_REQUIRED/);

    await loginViaUi(page, an);
    await page.goto('/leave');
    const form = page.getByRole('form', { name: 'Gửi đơn nghỉ' });
    await expect(form.getByLabel(/^Lý do/)).toBeDisabled();
    await form.getByRole('link', { name: 'Đồng ý ở trang Quyền riêng tư' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    const consent = page.getByRole('checkbox', { name: /Tôi đồng ý để công ty xử lý lý do nghỉ/ });
    // Ô theo server (bấm ⇒ PUT): click + khẳng định trạng thái thay cho check() (check() đòi đổi ngay sau click).
    await consent.click();
    await expect(consent).toBeChecked();
    await expect(page.getByText('Đã ghi nhận đồng ý', { exact: true })).toBeVisible();

    await page.goto('/leave');
    await expect(form.getByLabel(/^Lý do/)).toBeEnabled();
    await form.getByLabel(/^Lý do/).fill('Về quê');
    const sent = page.waitForResponse(
      (r) => r.url().endsWith('/leave/requests') && r.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Gửi đơn' }).click();
    expect((await sent).status()).toBe(201);

    await page.goto('/privacy');
    await consent.click(); // rút lại ⇒ hỏi lại (lý do ở đơn đang chờ bị xóa)
    await page
      .getByRole('dialog', { name: 'Rút lại đồng ý?' })
      .getByRole('button', { name: 'Rút lại đồng ý' })
      .click();
    await expect(page.getByText('Đã rút lại đồng ý', { exact: true })).toBeVisible();
    await expect(consent).not.toBeChecked();
    await page.goto('/leave');
    await expect(form.getByLabel(/^Lý do/)).toBeDisabled();
  });

  test('E2E-PRIV-03 (chạy cuối): Admin đặt đầu mối ở /admin/company ⇒ nhân viên thấy ở /privacy; trả lại giá trị cũ', async ({
    page,
    request,
    browser,
  }) => {
    const before = await hrCall<{ privacyContact: string | null }>(request, 'GET', '/company', {
      token: await adaToken(request),
      expected: 200,
    });
    const contact = `Phòng Nhân sự — privacy-${String(Date.now())}@e2e.example`;
    await loginViaUi(page, adaUser());
    await page.goto('/admin/company');
    const form = page.getByRole('form', { name: 'Đầu mối liên hệ dữ liệu cá nhân' });
    await form.getByLabel(/^Đầu mối liên hệ/).fill(contact);
    await form.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu đầu mối liên hệ')).toBeVisible();

    const vic = await employee(request, 'priv03-vic');
    const other = await browser.newContext();
    const vicPage = await other.newPage();
    try {
      await loginViaUi(vicPage, vic);
      await vicPage.goto('/privacy');
      await expect(vicPage.getByText(contact)).toBeVisible();
    } finally {
      await other.close();
      const now = await hrCall<{ version: number }>(request, 'GET', '/company', {
        token: await adaToken(request),
        expected: 200,
      });
      await hrCall(request, 'PATCH', '/company', {
        token: await adaToken(request),
        body: { privacyContact: before.privacyContact, expectedVersion: now.version },
        expected: 200,
      });
    }
  });
});
