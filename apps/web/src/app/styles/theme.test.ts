// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

// Smoke test bắt buộc của frontend.md §6.1 (V4): cách ghép "biến ngữ nghĩa + @theme inline" là suy
// luận từ docs Tailwind ⇒ biên dịch globals.css thật và khẳng định utility đọc biến NGỮ NGHĨA
// (đổi theo data-theme), không nhúng cứng giá trị màu của một theme.

const GLOBALS = path.join(import.meta.dirname, 'globals.css');
const CANDIDATES = ['bg-surface', 'text-text', 'bg-primary', 'border-border'];

let css = '';

beforeAll(async () => {
  const source = readFileSync(GLOBALS, 'utf8').replace(
    "@import 'tailwindcss';",
    // Không quét file dự án: chỉ sinh đúng các utility cần kiểm.
    `@import 'tailwindcss' source(none);\n@source inline("${CANDIDATES.join(' ')}");`,
  );
  const result = await postcss([tailwind({ base: import.meta.dirname })]).process(source, {
    from: GLOBALS,
  });
  css = result.css;
}, 30_000);

const block = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start, `không thấy ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('design token sáng/tối (globals.css)', () => {
  it.each([
    ['.bg-surface', 'background-color: var(--surface)'],
    ['.text-text', 'color: var(--text)'],
    ['.bg-primary', 'background-color: var(--primary)'],
  ])('%s tham chiếu biến ngữ nghĩa (đổi theo theme)', (selector, declaration) => {
    expect(block(selector)).toContain(declaration);
  });

  it('data-theme="dark" ghi đè biến ngữ nghĩa bằng bảng tối', () => {
    const dark = block(":root[data-theme='dark']");
    expect(dark).toContain('--surface: #1a1e27');
    expect(dark).toContain('--text: #e8eaee');
  });

  it('mặc định theo hệ điều hành, trừ khi người dùng chọn sáng', () => {
    expect(css).toMatch(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)/);
  });

  it('bảng tối ở media query và ở data-theme giống hệt nhau', () => {
    const vars = (s: string) =>
      s
        .slice(s.indexOf('{') + 1)
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);
    expect(vars(block(":root:not([data-theme='light'])"))).toEqual(
      vars(block(":root[data-theme='dark']")),
    );
  });
});
