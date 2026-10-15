import { apiRegister, boardPath } from '../support/api';
import { waitBoardReady } from '../support/board';
import { API_ORIGIN, WEB_ORIGIN } from '../support/env';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';

// T-035 (Sentry web + tunnel /monitoring). Chạy 2 lần: có E2E_SENTRY_DSN và không. Vi phạm CSP do fixture
// noCspViolations bắt (chunk SDK nạp động phải đi qua strict-dynamic).
const SENTRY_ON = !!process.env.E2E_SENTRY_DSN;
const ALLOWED = new Set([new URL(WEB_ORIGIN).host, new URL(API_ORIGIN).host]);

test(`T-035 (${SENTRY_ON ? 'có' : 'không'} SENTRY_DSN): lỗi client ⇒ ${SENTRY_ON ? 'gửi tới /monitoring same-origin' : 'không gửi gì'}; không request ra ngoài; API không nhận sentry-trace/baggage`, async ({
  page,
  request,
}) => {
  const external: string[] = [];
  const monitoring: string[] = [];
  const tracedApi: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && !ALLOWED.has(url.host)) external.push(req.url());
    if (url.origin === WEB_ORIGIN && url.pathname.startsWith('/monitoring'))
      monitoring.push(req.method());
    if (url.origin === API_ORIGIN) {
      const h = req.headers();
      if (h['sentry-trace'] || h.baggage) tracedApi.push(`${req.method()} ${url.pathname}`);
    }
  });

  const user = newUser('sentry');
  const s = await apiRegister(request, user);
  await loginViaUi(page, user);
  await page.goto(boardPath(s));
  await waitBoardReady(page);
  await page.goto('/account');
  await page.waitForLoadState('networkidle');

  await expect(page.locator('meta[name="tf-sentry"]')).toHaveCount(SENTRY_ON ? 1 : 0);
  const sdkLoaded = await page.evaluate(() => '__SENTRY__' in globalThis);
  expect(sdkLoaded, 'SDK chỉ nạp khi có DSN').toBe(SENTRY_ON);

  const sent = SENTRY_ON
    ? page.waitForRequest((req) => new URL(req.url()).pathname.startsWith('/monitoring'))
    : null;
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e-sentry-probe');
    }, 0);
  });
  if (sent) {
    const req = await sent;
    expect(new URL(req.url()).origin).toBe(WEB_ORIGIN);
    expect(req.method()).toBe('POST');
    expect(req.postData() ?? '').toContain('e2e-sentry-probe');
  } else {
    await page.waitForLoadState('networkidle');
    expect(monitoring).toEqual([]);
  }
  expect(external, 'không request nào ra domain ngoài').toEqual([]);
  expect(tracedApi, 'fetch tới API không mang sentry-trace/baggage').toEqual([]);
});
