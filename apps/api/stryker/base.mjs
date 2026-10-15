// T-017 — cấu hình chung StrykerJS. Mỗi nhóm có một file `<nhóm>.config.mjs` dùng `defineGroup`.
//
// Vì sao `testRunner: 'command'` thay cho @stryker-mutator/vitest-runner: runner 10.0.0 không chạy
// đúng với Vitest 5 (stryker-js #6240 coverage per-test sai, #6247 lọc tên test lồng không khớp,
// #6150 mutant ném lỗi lúc import bị báo Survived) ⇒ sinh mutant sống giả. Command runner chạy
// nguyên bộ test của nhóm cho mỗi mutant (coverageAnalysis 'off'): chậm hơn nhưng đúng.
// Tech Lead duyệt 2026-10-15. Xem docs/reviews/T-017-findings.md.

const VITEST = 'node node_modules/vitest/vitest.mjs run --reporter=dot --silent=true';

/**
 * @param {string} name tên nhóm (dùng cho thư mục báo cáo)
 * @param {{ mutate: string[], tests: string[] }} group file bị đột biến + đường dẫn test chạy cho mỗi mutant
 */
export function defineGroup(name, { mutate, tests }) {
  return {
    $schema: '../node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    packageManager: 'pnpm',
    testRunner: 'command',
    commandRunner: { command: `${VITEST} ${tests.join(' ')}` },
    coverageAnalysis: 'off',
    mutate: [...mutate, '!**/*.test.ts'],
    concurrency: 2,
    timeoutMS: 30_000,
    reporters: ['clear-text', 'progress', 'json', 'html'],
    jsonReporter: { fileName: `coverage/mutation/${name}.json` },
    htmlReporter: { fileName: `coverage/mutation/${name}.html` },
    tempDirName: 'node_modules/.stryker-tmp',
    cleanTempDir: true,
    thresholds: { high: 80, low: 60, break: null },
  };
}
