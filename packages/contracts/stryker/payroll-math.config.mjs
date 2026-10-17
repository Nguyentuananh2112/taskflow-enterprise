// T-049 (payroll.md §7 PR/SN, ngưỡng ≥ 90 % — F soát ở T-051): đột biến phép tính phiếu lương dùng chung web/API.
// Cùng cách chạy với apps/api/stryker/base.mjs (command runner — xem T-017-findings); StrykerJS lấy từ apps/api
// (package contracts không khai phụ thuộc Stryker): `pnpm --filter @taskflow/contracts mutation:payroll-math`.

const VITEST = 'node node_modules/vitest/vitest.mjs run --reporter=dot --silent=true';

export default {
  $schema: '../../../apps/api/node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  packageManager: 'pnpm',
  testRunner: 'command',
  commandRunner: { command: `${VITEST} src/payroll` },
  coverageAnalysis: 'off',
  mutate: ['src/payroll/**/*.ts', '!**/*.test.ts', '!src/payroll/index.ts'],
  concurrency: 2,
  timeoutMS: 30_000,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: 'coverage/mutation/payroll-math.json' },
  htmlReporter: { fileName: 'coverage/mutation/payroll-math.html' },
  tempDirName: 'node_modules/.stryker-tmp',
  cleanTempDir: true,
  thresholds: { high: 90, low: 80, break: 90 },
};
