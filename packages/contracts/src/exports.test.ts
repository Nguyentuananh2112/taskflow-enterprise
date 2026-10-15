import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as root from './index';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
};

describe('package.json "exports" (data-and-api §5.1)', () => {
  // `./openapi` (A2) CỐ Ý không có trong barrel gốc: generator + danh mục route chỉ dùng phía server /
  // công cụ — để ngoài barrel thì bundle web không phải đánh giá module này.
  const SERVER_ONLY = new Set(['.', './openapi']);
  const subpaths = Object.entries(pkg.exports).filter(([key]) => !SERVER_ONLY.has(key));

  it.each(subpaths)(
    '%s chỉ xuất những gì barrel gốc cũng xuất (cùng tham chiếu)',
    async (_, target) => {
      const mod = (await import(new URL(`../${target}`, import.meta.url).href)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(mod).length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(mod)) {
        expect(root, name).toHaveProperty(name);
        expect((root as Record<string, unknown>)[name], name).toBe(value);
      }
    },
  );
});
