import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Bộ test bảo mật đen (T-017). Tách khỏi `pnpm test` vì cần Postgres/Valkey thật (ADR-097)
// và spawn process API. Chạy: `pnpm --filter @taskflow/api test:security`.
// File dùng hậu tố `.sec.ts` để config gốc (`*.test.ts`) không nhặt nhầm.
//
// Vitest 5 tự đọc VITEST_MAX_WORKERS và giá trị đó THẮNG `fileParallelism: false` ⇒ 2 file chạy song song
// trên cùng DB/Valkey của suite (cùng lỗi D tìm ở integration — F2). Bỏ biến đó và chốt 1 worker.
delete process.env.VITEST_MAX_WORKERS;

export default defineConfig({
  test: {
    name: 'api-security',
    root: fileURLToPath(new URL('../../', import.meta.url)),
    environment: 'node',
    include: ['test/security/**/*.sec.ts'],
    // Warm-up hạ tầng một lần (DB + migrate + process API nguội) với timeout riêng — T-017c.
    globalSetup: ['test/security/harness/global-setup.ts'],
    // Mỗi file tự khởi động 1 process API + 1 DB clone ⇒ chạy tuần tự cho nhẹ RAM.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 600_000,
  },
});
