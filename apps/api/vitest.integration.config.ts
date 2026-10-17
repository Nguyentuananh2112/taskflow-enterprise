import { configDefaults, defineConfig } from 'vitest/config';

import { temporaryExclusionGlobs } from './temporary-exclusions';

// Integration với Postgres thật (ADR-003). KHÔNG nằm trong `pnpm test` mặc định vì cần DB.
// Chạy: DATABASE_URL_TEST=postgresql://… VALKEY_URL_TEST=redis://…/<db 1–15> pnpm --filter @taskflow/api test:integration
// CẢNH BÁO: globalSetup XÓA SẠCH schema `public` của DB trong DATABASE_URL_TEST và FLUSHDB Valkey db đó.
//
// Mọi file dùng CHUNG một DB ⇒ bắt buộc chạy tuần tự. Vitest tự đọc VITEST_MAX_WORKERS và nó THẮNG cả
// `maxWorkers` lẫn `fileParallelism: false` của config (đo trên Vitest 5.0.4: =2 ⇒ 2 file song song ⇒
// 40P01 TRUNCATE deadlock, P2002/P2003, rank trùng, register→login 401). Biến đó chỉ dành cho unit
// (runbook local-dev §7) ⇒ xóa trước khi Vitest đọc. `--maxWorkers` trên CLI vẫn thắng — đừng truyền.
// Khẳng định: test/integration/serial.int.ts.
delete process.env.VITEST_MAX_WORKERS;

export default defineConfig({
  test: {
    name: 'api-integration',
    environment: 'node',
    include: ['test/integration/**/*.int.ts'],
    // T-061 TẠM: attendance / leave / test HR — danh sách duy nhất ở tsconfig.exclusions.json.
    exclude: [...configDefaults.exclude, ...temporaryExclusionGlobs()],
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/integration/serial-guard.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
