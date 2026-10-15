import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.join(import.meta.dirname, '..');

// frontend.md §2.1 (V1): Next tìm `pages` và `app` độc lập; `src/pages` cạnh `app/` ở gốc
// làm build lỗi "pages and app directories should be under the same folder".
// Layer "pages" của FSD vì thế tên là `views`.
describe('cấu trúc apps/web', () => {
  it.each(['pages', 'src/pages'])('không có thư mục %s', (dir) => {
    expect(existsSync(path.join(WEB_ROOT, dir))).toBe(false);
  });

  it('route Next nằm ở app/ (gốc), không ở src/app', () => {
    expect(existsSync(path.join(WEB_ROOT, 'app', 'layout.tsx'))).toBe(true);
    expect(existsSync(path.join(WEB_ROOT, 'src', 'app', 'layout.tsx'))).toBe(false);
    expect(existsSync(path.join(WEB_ROOT, 'src', 'app', 'page.tsx'))).toBe(false);
  });
});
