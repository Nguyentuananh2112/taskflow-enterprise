import axe from 'axe-core';
import { expect } from 'vitest';

// Kiểm a11y cơ bản cho test component (jsdom). jsdom không có layout/màu thật nên tắt
// `color-contrast` — độ tương phản được kiểm bằng axe trên trình duyệt thật ở E2E (frontend.md §8).
export async function expectNoA11yViolations(container: Element = document.body): Promise<void> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node)`);
  expect(summary).toEqual([]);
}
