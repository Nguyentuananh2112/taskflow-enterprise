// `pnpm verify` — chạy LOCAL đúng các bước CI chạy được trên máy dev, một lệnh là đủ (Tech Lead đề xuất sau drift
// .env.example). Chạy HẾT các bước (không dừng ở bước đỏ đầu tiên) rồi in bảng exit code; exit ≠ 0 nếu có bước đỏ.
// Chỉ tin EXIT CODE, không đọc chữ (devops.md §8.2b).
//   pnpm verify                                   # lint (gồm env-example) · typecheck · test · audit
//   VERIFY_DB_URL=postgresql://taskflow_migrator:…@127.0.0.1:5434/taskflow_<ticket> pnpm verify
//                                                 # + prisma validate + migrate deploy/grant + drift trên DB đó
// KHÔNG gồm (cần Docker/hạ tầng, CI lo): build image, Trivy, smoke container, gitleaks toàn lịch sử, actionlint,
// test:integration / test:security (chạy riêng theo runbook §5 trên DB của bạn — ADR-106).
import { spawnSync } from 'node:child_process';

const steps = [
  ['lint (prettier · eslint · depcruise · .env.example ↔ env.ts)', 'pnpm lint'],
  ['cấm npx cho Prisma (ADR-061, như CI)', 'node .github/scripts/check-no-npx-prisma.mjs'],
  ['typecheck', 'pnpm typecheck'],
  ['test (unit + tầng I có Valkey nếu chạy)', 'pnpm test'],
  ['audit --prod (high/critical)', 'pnpm audit --prod --audit-level high'],
];
const dbUrl = process.env.VERIFY_DB_URL;
if (dbUrl) {
  steps.push(
    [
      'prisma validate',
      'pnpm --filter @taskflow/api exec prisma validate',
      { DATABASE_URL: dbUrl },
    ],
    [
      'db:deploy (migrate + grant)',
      'pnpm --filter @taskflow/api run db:deploy',
      { DATABASE_URL: dbUrl },
    ],
    ['db:check-drift', 'pnpm --filter @taskflow/api run db:check-drift', { DATABASE_URL: dbUrl }],
  );
}

// node_modules lệch lockfile ⇒ các bước pnpm dừng với "Run pnpm install" (verifyDepsBeforeRun: error trong
// pnpm-workspace.yaml) — verify chỉ KIỂM, không bao giờ tự cài.
const env = { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
const results = [];
for (const [name, command, extraEnv] of steps) {
  console.log(`\n▶ ${name}: ${command}`);
  const started = Date.now();
  // shell: true — Windows cần để gọi pnpm.cmd; lệnh là hằng số trong file này (không có input ngoài).
  const { status } = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: { ...env, ...extraEnv },
  });
  results.push({ name, status: status ?? 1, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('\n| Bước | Exit | Thời gian |\n|---|---|---|');
for (const r of results)
  console.log(`| ${r.name} | ${r.status === 0 ? '0 ✅' : `${r.status} ❌`} | ${r.seconds}s |`);
if (!dbUrl)
  console.log(
    '\n(bỏ qua migrate/drift — đặt VERIFY_DB_URL tới DB riêng của bạn trên postgres-test để chạy)',
  );
if (results.find((r) => r.name.startsWith('test'))?.status) {
  console.log(
    '\nTest đỏ? Nếu log có "Timeout waiting for worker" / "Failed to start forks worker" là máy quá tải, ' +
      'không phải lỗi code: chạy lại với VITEST_MAX_WORKERS=2 (runbook local-dev §7) — chỉ cho unit; ' +
      'integration luôn tuần tự, không đặt biến này cho nó.',
  );
}
process.exit(results.some((r) => r.status !== 0) ? 1 : 0);
