import { expect, type Locator } from '@playwright/test';

/**
 * Danh sách toàn công ty phân trang "Tải thêm" (một công ty, một DB cả lượt — §0.4): bấm tới khi thấy `target`.
 * Sau MỖI lần bấm chờ số mục (`items`) TĂNG hoặc nút bị gỡ (hết trang) rồi mới đếm lại — chờ `aria-busy` không đủ vì
 * ngay sau click nút có thể chưa kịp bận, và khi trang cuối về thì nút bị gỡ hẳn (E phân tích trace HR-23, 18/10).
 */
export async function loadUntilVisible(
  target: Locator,
  items: Locator,
  more: Locator,
  maxPages = 30,
): Promise<void> {
  for (let page = 0; page < maxPages; page += 1) {
    if ((await target.count()) > 0) break;
    if ((await more.count()) === 0) break; // hết trang
    const before = await items.count();
    await expect(more).toBeEnabled({ timeout: 30_000 });
    await more.click();
    await expect
      .poll(async () => (await items.count()) > before || (await more.count()) === 0, {
        timeout: 30_000,
        message: `"Tải thêm" lần ${String(page + 1)}: danh sách không tăng (${String(before)} mục)`,
      })
      .toBe(true);
  }
  await expect(target, 'đã tải hết trang mà không thấy mục cần tìm').toBeVisible();
}
