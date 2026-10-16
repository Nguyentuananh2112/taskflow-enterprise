import { expect, type BrowserContext, type Page } from '@playwright/test';

// Bẫy XSS dùng chung (SEC-49 ở xss.e2e.ts, E2E-HR-08 ở hr.e2e.ts) — 3 lớp đầu của xss.e2e.ts; lớp 4 (CSP)
// do fixture `noCspViolations` / `openAs().close()`.

declare global {
  interface Window {
    __xssHits?: number[];
    __xss?: (n: number) => void;
  }
}

/** Phần tử/thuộc tính không bao giờ được xuất hiện nếu nội dung người dùng chỉ là text. */
export const DANGEROUS =
  'img[src="x"], svg[onload], a[href^="javascript:"], iframe[srcdoc], details[ontoggle], [onerror], [onload], [ontoggle]';

export async function arm(context: BrowserContext): Promise<string[]> {
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

export async function assertInert(
  page: Page,
  dialogs: readonly string[],
  where: string,
): Promise<void> {
  expect(await page.evaluate(() => window.__xssHits ?? []), `${where}: payload đã chạy`).toEqual(
    [],
  );
  expect(dialogs, `${where}: có hộp thoại`).toEqual([]);
  expect(
    await page.locator(DANGEROUS).evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 120))),
    `${where}: phần tử nguy hiểm trong DOM`,
  ).toEqual([]);
}
