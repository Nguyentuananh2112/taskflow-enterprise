import { expect, type Locator, type Page } from '@playwright/test';

// Locator theo vai trò/nhãn (frontend.md): cột = <section aria-labelledby> ⇒ role region "Cần làm 3";
// thẻ = <article aria-labelledby={tiêu đề}>; tay kéo = nút "Kéo {key}".

export const STATUS = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  REVIEW: 'Kiểm duyệt',
  DONE: 'Hoàn thành',
} as const;
export type Status = keyof typeof STATUS;

export const column = (page: Page, status: Status): Locator =>
  page.getByRole('region', { name: new RegExp(`^${STATUS[status]}\\b`) });

export const card = (scope: Page | Locator, title: string): Locator =>
  scope.getByRole('article', { name: title });

/** Tiêu đề các thẻ trong một cột, theo thứ tự hiển thị. */
export async function titlesIn(page: Page, status: Status): Promise<string[]> {
  return column(page, status)
    .getByRole('article')
    .evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute('aria-labelledby');
        return (id ? document.getElementById(id)?.textContent : el.textContent)?.trim() ?? '';
      }),
    );
}

/**
 * Kéo bằng chuột qua tay kéo; di chuyển nhiều bước để vượt ngưỡng kích hoạt của dnd-kit.
 * `whileOver` chạy khi chuột đang ở trên đích, TRƯỚC khi thả (kiểm trạng thái giữa lúc kéo).
 */
export async function dragByMouse(
  page: Page,
  handle: Locator,
  target: Locator,
  whileOver?: () => Promise<void>,
): Promise<void> {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('không lấy được vị trí tay kéo / đích');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  const x = to.x + to.width / 2;
  const y = to.y + Math.min(to.height / 2, 60);
  await page.mouse.move(x, y, { steps: 20 });
  await page.mouse.move(x + 4, y + 4, { steps: 4 }); // thêm sự kiện ở đích để dnd-kit chốt "over"
  // Mặc định: chờ cột đích nhận là đích thả (ring) rồi mới thả — không thả "mù".
  await (whileOver ? whileOver() : expect(target).toHaveClass(/ring-2/));
  await page.mouse.up();
}

export async function waitBoardReady(page: Page): Promise<void> {
  await expect(column(page, 'TODO')).toBeVisible();
}
