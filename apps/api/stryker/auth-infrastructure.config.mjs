import { defineGroup } from './base.mjs';

// F3: repo Prisma + store Valkey chỉ có integration test phủ (test/integration/**) ⇒ chạy mutant
// bằng unit test chỉ ra mutant sống giả (0 killed/204 lần đo 2026-10-16) — loại khỏi nhóm.
export default defineGroup('auth-infrastructure', {
  mutate: [
    'src/modules/auth/infrastructure/**/*.ts',
    '!src/modules/auth/infrastructure/persistence/prisma/**',
    '!src/modules/auth/infrastructure/cache/valkey-*.ts',
  ],
  tests: ['src/modules/auth'],
});
