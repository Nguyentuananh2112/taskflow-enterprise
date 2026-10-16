import { relative } from 'node:path';

import type { Reporter, TestModule, Vitest } from 'vitest/node';

import { DECLARED_PENDING, PENDING_PREFIX } from './pending';

/**
 * Cổng "suite bảo mật xanh" phải đo đúng: lượt chạy ĐỎ nếu có ca bị skip mà id không nằm trong
 * `DECLARED_PENDING` — gồm `it.skip` lẻ, `describe.skip` và skip động (`ctx.skip()`: build từ chối
 * khởi động, probe không thấy limiter/gateway). `todo` (ca chưa có thân) không tính là skip.
 * Vitest chỉ đặt `process.exitCode = 1`, không bao giờ đặt lại 0 ⇒ đặt 1 ở đây là đủ.
 *
 * Lượt lọc tên (`-t`) ⇒ ca bị lọc cũng là "skip" ⇒ bỏ qua kiểm tra (chỉ cảnh báo).
 */
export default class SkipBudgetReporter implements Reporter {
  #filtered = false;
  #root = '';

  onInit(vitest: Vitest): void {
    this.#filtered = Boolean(vitest.config.testNamePattern);
    this.#root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const undeclared: string[] = [];
    let declaredSkipped = 0;
    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        const result = test.result();
        if (test.options.mode === 'todo' || result.state !== 'skipped') continue;
        const id = pendingId(test.name);
        if (id !== null && id in DECLARED_PENDING) {
          declaredSkipped += 1;
          continue;
        }
        const { note } = result;
        undeclared.push(
          `${relative(this.#root, mod.moduleId)} › ${test.fullName}${note ? ` — ${note}` : ''}`,
        );
      }
    }
    const declared = Object.keys(DECLARED_PENDING).length;
    if (undeclared.length === 0) {
      console.log(`[skip-budget] OK — skip ${declaredSkipped}/${declared} ca pending đã khai báo.`);
      return;
    }
    const verb = this.#filtered ? 'CẢNH BÁO (lượt có -t, không chặn)' : 'ĐỎ';
    console.error(
      `[skip-budget] ${verb}: ${undeclared.length} ca bị skip KHÔNG có trong harness/pending.ts:\n` +
        undeclared.map((line) => `  - ${line}`).join('\n'),
    );
    if (!this.#filtered) process.exitCode = 1;
  }
}

/** `[PENDING <ticket>] <id> — <title>` ⇒ `<id>`; tên khác ⇒ null. */
export function pendingId(name: string): string | null {
  if (!name.startsWith(PENDING_PREFIX)) return null;
  const match = /^\[PENDING [^\]]*\] (\S+) — /.exec(name);
  return match?.[1] ?? null;
}
