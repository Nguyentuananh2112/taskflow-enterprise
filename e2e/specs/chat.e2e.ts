import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';

import { apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test, type E2EUser } from '../support/fixtures';
import { API_ORIGIN } from '../support/env';
import { call } from '../support/http';
import { awaiting } from '../support/pending';
import { arm, assertInert } from '../support/xss';

// E2E-CH-07 (test-spec-chat §6, avatar-chat.md §7 a11y — phần của H): axe 0 serious / critical sáng + tối ở 360 / 1280;
// vùng `aria-live` sr-only RIÊNG chỉ đọc tin ĐẾN sau lúc mở, `log "Tin nhắn"` không tự đọc. Cần route chat (T-069) +
// event `chat:message:new` thật (T-070) ⇒ fixme tới khi E2E_RUN_PENDING chứa cả hai (không xanh giả).
// Selector theo test-spec-chat §6.1 (H 18/10). E2E-CH-02…06 của F. Cùng file: SEC-CH-13 (XSS hiển thị, pending T-069) và
// SEC-CH-20 phần web (Sentry không mang `sig` — chạy ở lượt có E2E_SENTRY_DSN).

const T069 = 'T-069';
const T070 = 'T-070';
const REALTIME = { timeout: 5_000 };

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** DIRECT giữa hai người + `n` tin của `from` (qua API công khai). */
async function seedDirect(
  request: APIRequestContext,
  from: { token: string },
  toUserId: string,
  bodies: string[],
): Promise<string> {
  const conv = await call<{ id: string }>(
    request,
    'POST',
    '/chat/direct',
    from.token,
    { userId: toUserId },
    201,
  );
  for (const body of bodies) await sendAs(request, from.token, conv.id, body);
  return conv.id;
}

const sendAs = (request: APIRequestContext, token: string, convId: string, body: string) =>
  call(
    request,
    'POST',
    `/chat/conversations/${convId}/messages`,
    token,
    { clientMsgId: randomUUID(), body },
    201,
  );

/** id sau apiCreateUser — thiếu ⇒ ném lỗi rõ (thay vì POST với '' ⇒ 400 khó đọc — F). */
function idOf(user: E2EUser): string {
  if (!user.userId) throw new Error(`${user.email} chưa được tạo (apiCreateUser)`);
  return user.userId;
}

/** Vùng đọc to riêng của luồng tin. */
const liveRegion = (page: Page) => page.locator('[aria-live="polite"].sr-only');

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 360, height: 780 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`E2E-CH-07 axe trò chuyện (${colorScheme}, ${viewport.width}px)`, () => {
      test.use({ colorScheme, viewport });
      test.fixme(awaiting(T069, T070), `[PENDING ${T069}, ${T070}] chờ route + realtime chat thật`);

      test('/chat, /chat/[id] (có tin, ảnh đại diện chữ cái), dialog Tin nhắn mới', async ({
        page,
        request,
      }) => {
        const mia = newUser(`ch7-mia-${colorScheme}-${viewport.width}`);
        const vic = newUser(`ch7-vic-${colorScheme}-${viewport.width}`);
        await apiCreateUser(request, mia);
        const v = await apiCreateUser(request, vic);
        const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), [
          'Chào Mia, xem giúp https://example.com nhé',
          'Tin thứ hai',
        ]);
        await loginViaUi(page, mia);

        await page.goto('/chat');
        await expect(page.getByRole('link', { name: new RegExp(vic.fullName) })).toBeVisible();
        expect(await seriousViolations(page), '/chat').toEqual([]);

        await page.goto(`/chat/${convId}`);
        await expect(
          page.getByRole('log', { name: 'Tin nhắn' }).getByText('Tin thứ hai'),
        ).toBeVisible();
        expect(await seriousViolations(page), '/chat/[id]').toEqual([]);

        await page.goto('/chat');
        await page.getByRole('button', { name: 'Tin nhắn mới' }).click();
        await expect(page.getByRole('dialog', { name: 'Tin nhắn mới' })).toBeVisible();
        expect(await seriousViolations(page), 'dialog Tin nhắn mới').toEqual([]);
      });
    });
  }
}

test.describe('E2E-CH-07 vùng aria-live', () => {
  test.fixme(awaiting(T069, T070), `[PENDING ${T069}, ${T070}] chờ route + realtime chat thật`);

  test('mở luồng KHÔNG đọc lịch sử; tin ĐẾN realtime ⇒ đọc "Vic: …"; tin của mình không đọc; log không tự đọc', async ({
    page,
    request,
  }) => {
    const mia = newUser('ch7-live-mia');
    const vic = newUser('ch7-live-vic');
    await apiCreateUser(request, mia);
    const v = await apiCreateUser(request, vic);
    const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), ['Lịch sử cũ']);
    await loginViaUi(page, mia);
    await page.goto(`/chat/${convId}`);

    const log = page.getByRole('log', { name: 'Tin nhắn' });
    await expect(log.getByText('Lịch sử cũ')).toBeVisible();
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(liveRegion(page)).toHaveText('');

    await page.getByRole('textbox', { name: 'Soạn tin' }).fill('Tin của Mia');
    await page.getByRole('button', { name: 'Gửi' }).click();
    await expect(log.getByText('Tin của Mia')).toBeVisible();
    await expect(liveRegion(page)).toHaveText('');

    await sendAs(request, v.accessToken, convId, 'Có ai không?');
    await expect(log.getByText('Có ai không?')).toBeVisible(REALTIME);
    await expect(liveRegion(page)).toHaveText(`${vic.fullName}: Có ai không?`);
    await expect(page.getByRole('textbox', { name: 'Soạn tin' })).toBeFocused();
  });
});

// ---------------------------------------------------------------- SEC-CH-13 (E) — XSS hiển thị (ADR-146)

/** Payload gọi `__xss(n)` nếu chạy được (bẫy của support/xss.ts). Thân tin + tên nhóm là TEXT, link chỉ http(s). */
const XSS = {
  body: '<img src="x" onerror="__xss(1)"> <svg onload="__xss(2)"></svg>',
  js: 'javascript:__xss(3)',
  data: 'data:text/html,<script>parent.__xss(4)</script>',
  group: '"><iframe srcdoc="<script>parent.__xss(5)</script>"></iframe> Nhóm',
  safe: 'https://example.com/a?b=1',
  // F (soát 16f1a0c0): hoa/thường, khoảng trắng trước, vbscript, URL https cố phá thuộc tính.
  mixed: 'JaVaScRiPt:__xss(6)',
  spaced: 'Thử   javascript:__xss(7)',
  vb: 'vbscript:__xss(9)',
  breaker: 'https://example.com/"><img src=x onerror=__xss(8)>',
};

/** Mọi link nguy hiểm, không phân biệt hoa/thường. */
const BAD_LINKS = 'a[href^="javascript:" i], a[href^="data:" i], a[href^="vbscript:" i]';

test.describe('SEC-CH-13 XSS trong trò chuyện', () => {
  test.fixme(awaiting(T069), `[PENDING ${T069}] chờ route chat thật`);

  test('thân tin / javascript: / data: / tên nhóm chứa HTML ⇒ hiện nguyên văn, không chạy, không link javascript:', async ({
    page,
    context,
    request,
  }) => {
    const dialogs = await arm(context);
    const mia = newUser('xss-mia');
    const vic = newUser('xss-vic');
    await apiCreateUser(request, mia);
    const v = await apiCreateUser(request, vic);
    const otto = newUser('xss-otto');
    await apiCreateUser(request, otto);
    const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), [
      XSS.body,
      `${XSS.js} và ${XSS.data}`,
      `Xem ${XSS.safe}`,
      `${XSS.mixed} ${XSS.vb}`,
      XSS.spaced,
      `Link ${XSS.breaker}`,
    ]);
    const group = await call<{ id: string }>(
      request,
      'POST',
      '/chat/groups',
      v.accessToken,
      { title: XSS.group, memberIds: [idOf(mia), idOf(otto)] },
      201,
    );
    await sendAs(request, v.accessToken, group.id, XSS.body);

    await loginViaUi(page, mia);
    await page.goto('/chat');
    await expect(page.getByRole('link', { name: new RegExp(vic.fullName) })).toBeVisible();
    await assertInert(page, dialogs, '/chat (xem trước + tên nhóm)');

    await page.goto(`/chat/${convId}`);
    const log = page.getByRole('log', { name: 'Tin nhắn' });
    await expect(log.getByText(XSS.body, { exact: true })).toBeVisible();
    await expect(log.getByText(`${XSS.js} và ${XSS.data}`, { exact: true })).toBeVisible();
    await expect(log.getByText(XSS.spaced, { exact: true })).toBeVisible();
    await expect(log.locator(BAD_LINKS)).toHaveCount(0);
    // URL cố phá thuộc tính: href (nếu có link) không chứa " hay <; không sinh thêm phần tử.
    const hrefs = await log
      .locator('a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.filter((h) => /["<>]/.test(h))).toEqual([]);
    await expect(log.locator('img[src="x"], img[src="x>"]')).toHaveCount(0);
    const safe = log.getByRole('link', { name: XSS.safe });
    await expect(safe).toHaveAttribute('href', XSS.safe);
    await expect(safe).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(safe).toHaveAttribute('target', '_blank');
    await assertInert(page, dialogs, '/chat/[id] DIRECT');

    await page.goto(`/chat/${group.id}`);
    await expect(page.getByRole('heading', { name: XSS.group })).toBeVisible();
    await expect(
      page.getByRole('log', { name: 'Tin nhắn' }).getByText(XSS.body, { exact: true }),
    ).toBeVisible();
    await assertInert(page, dialogs, '/chat/[id] nhóm');
  });
});

test.describe('SEC-CH-13 XSS — tin đến realtime khi KHÔNG mở luồng', () => {
  test.fixme(awaiting(T069, T070), `[PENDING ${T069}, ${T070}] chờ route + realtime chat thật`);

  test('Mia ở /w, Vic gửi payload ⇒ badge / title / thông báo không chạy script, không hiện thân tin dạng HTML', async ({
    page,
    context,
    request,
  }) => {
    const dialogs = await arm(context);
    const mia = newUser('xss-rt-mia');
    const vic = newUser('xss-rt-vic');
    await apiCreateUser(request, mia);
    const v = await apiCreateUser(request, vic);
    const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), []);
    await loginViaUi(page, mia);
    await page.goto('/w');
    const title = await page.title();

    await sendAs(request, v.accessToken, convId, XSS.body);
    // Lối vào chỉ hiện SỐ (ADR-145: không chuông / toast cho chat) — chờ badge rồi kiểm không có gì chạy.
    await expect(
      page.getByRole('link', { name: /^Trò chuyện, 1 tin chưa đọc$/ }).first(),
    ).toBeAttached(REALTIME);
    expect(await page.title(), 'document.title không mang xem trước tin').toBe(title);
    await assertInert(page, dialogs, '/w sau tin realtime');
  });
});

// ---------------------------------------------------------------- SEC-CH-20 (web) — Sentry không mang `sig`

const SENTRY_ON = !!process.env.E2E_SENTRY_DSN;

test('SEC-CH-20 (web): lỗi client chứa URL media ký ⇒ event qua /monitoring KHÔNG có giá trị sig (F-11, B M8)', async ({
  page,
  request,
}) => {
  // Chạy ở lượt có E2E_SENTRY_DSN (như T-035 monitoring.e2e.ts chạy 2 lần); không DSN ⇒ không có event để kiểm.
  test.skip(!SENTRY_ON, 'lượt không có E2E_SENTRY_DSN — SDK không nạp');
  const secret = `SIG${randomUUID().replaceAll('-', '')}`.slice(0, 20); // < 32 ký tự: mẫu token chung KHÔNG bắt
  const mediaUrl = `${API_ORIGIN}/api/v1/media/chat/${randomUUID()}/preview?v=1&exp=9999999999&sig=${secret}`;
  const user = newUser('sentry-sig');
  await apiCreateUser(request, user);
  await loginViaUi(page, user);
  await page.goto('/account');
  await page.waitForLoadState('networkidle');

  const sent = page.waitForRequest((req) => new URL(req.url()).pathname.startsWith('/monitoring'));
  await page.evaluate((url) => {
    // Breadcrumb fetch / xhr mang URL đầy đủ — đường lọt hay gặp nhất (F). Web tắt breadcrumb (beforeBreadcrumb ⇒ null)
    // và cắt query URL; envelope phải sạch cả ở đây.
    void fetch(url).catch(() => undefined);
    setTimeout(() => {
      throw new Error(`e2e-media-probe ${url}`);
    }, 0);
  }, mediaUrl);
  const body = (await sent).postData() ?? '';
  expect(body).toContain('e2e-media-probe');
  expect(body, 'giá trị sig lọt vào Sentry').not.toContain(secret);
  expect(body).toContain('sig=[REDACTED]');
});
