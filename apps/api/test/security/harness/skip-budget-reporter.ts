import { basename, relative } from 'node:path';

import type { Reporter, TestModule, Vitest } from 'vitest/node';

import { DECLARED_PENDING, PENDING_PREFIX, TODO_BUDGET } from './pending';

/**
 * Cổng "suite bảo mật xanh" phải đo đúng — lượt chạy ĐỎ nếu một ca bị TẮT mà không khai báo:
 * - skip ngoài `DECLARED_PENDING`: `it.skip` / `describe.skip` / `skipIf` và skip động (`ctx.skip()`:
 *   build từ chối khởi động, probe BUILD-PROBE không thấy limiter/gateway);
 * - todo ngoài `TODO_BUDGET` (ca bị xóa thân / bọc `it.todo`, `describe.todo`), và mục trong
 *   `TODO_BUDGET` không còn là todo ở file đã chạy (danh sách phải trung thực);
 * - `it.fails` — ca xanh khi assertion đỏ, không có chỗ trong suite bảo mật.
 * Vitest chỉ đặt `process.exitCode = 1`, không bao giờ đặt lại 0 ⇒ đặt 1 ở đây là đủ.
 * Lượt lọc tên (`-t`) ⇒ ca bị lọc cũng là "skip" ⇒ chỉ cảnh báo.
 */
export default class SkipBudgetReporter implements Reporter {
  #filtered = false;
  #root = '';

  onInit(vitest: Vitest): void {
    this.#filtered = Boolean(vitest.config.testNamePattern);
    this.#root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const problems: string[] = [];
    const ranFiles = new Set<string>();
    const todoSeen = new Set<string>();
    let declaredSkipped = 0;

    for (const mod of testModules) {
      const file = basename(mod.moduleId);
      ranFiles.add(file);
      const where = relative(this.#root, mod.moduleId);
      for (const test of mod.children.allTests()) {
        const id = caseId(test.name);
        if (test.options.fails) {
          problems.push(`it.fails (xanh khi assertion đỏ): ${where} › ${test.fullName}`);
          continue;
        }
        if (test.options.mode === 'todo') {
          if (id !== null && TODO_BUDGET[id] === file) todoSeen.add(id);
          else problems.push(`todo ngoài TODO_BUDGET (ca mất thân?): ${where} › ${test.fullName}`);
          continue;
        }
        const result = test.result();
        if (result.state !== 'skipped') continue;
        if (id !== null && test.name.startsWith(PENDING_PREFIX) && id in DECLARED_PENDING) {
          declaredSkipped += 1;
          continue;
        }
        const { note } = result;
        problems.push(
          `skip ngoài DECLARED_PENDING: ${where} › ${test.fullName}${note ? ` — ${note}` : ''}`,
        );
      }
    }
    for (const [id, file] of Object.entries(TODO_BUDGET)) {
      if (ranFiles.has(file) && !todoSeen.has(id)) {
        problems.push(`TODO_BUDGET còn '${id}' (${file}) nhưng ca không còn là todo — xóa mục đó`);
      }
    }

    const pending = Object.keys(DECLARED_PENDING).length;
    if (problems.length === 0) {
      console.log(
        `[skip-budget] OK — skip ${declaredSkipped}/${pending} ca pending đã khai báo; todo ${todoSeen.size} (đúng TODO_BUDGET).`,
      );
      return;
    }
    const verb = this.#filtered ? 'CẢNH BÁO (lượt có -t, không chặn)' : 'ĐỎ';
    console.error(
      `[skip-budget] ${verb}: ${problems.length} vấn đề (harness/pending.ts):\n` +
        problems.map((line) => `  - ${line}`).join('\n'),
    );
    if (!this.#filtered) process.exitCode = 1;
  }
}

/** `[<nhãn>] <id> — <title>` ⇒ `<id>` (ca pending / todo / outOfScope); tên khác ⇒ null. */
export function caseId(name: string): string | null {
  return /^\[[^\]]*\] (\S+) — /.exec(name)?.[1] ?? null;
}
