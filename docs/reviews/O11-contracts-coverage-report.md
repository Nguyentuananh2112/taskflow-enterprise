# O11 (part 2): coverage threshold for `packages/contracts` (devops.md §8.2: ≥ 80%)

Branch `chore/contracts-coverage` (from main `07d9176`).

**Measured first** (`vitest run --coverage`, v8, `src/**/*.ts` without tests): statements 100% (166/166), lines 100% (162/162), functions 100% (29/29), branches 95.45% (42/44). The only uncovered branches are in `common/locale.ts:14` and `openapi/document.ts:27`. No tests needed to be added.

**Change:**
- `packages/contracts/vitest.config.ts` now uses `defineConfig`, like `apps/api` (coverage can only be configured in a root config), with thresholds `lines: 80, statements: 80`.
- New script `test:coverage` (`vitest run --coverage --maxWorkers=2`).
- `@vitest/coverage-v8` (`catalog:`) declared in devDependencies. It used to resolve only through hoisting. The lockfile change is the importer entry only (same 5.0.4 version as apps/api).
- CI unit job: a new step "Coverage contracts (ngưỡng ⇒ đỏ)".

**Proof:**
- `pnpm --filter @taskflow/contracts test:coverage` exits 0.
- **Config mutation:** I added `branches: 99` (actual 95.45%). Result: `ERROR: Coverage for branches (95.45%) does not meet global threshold (99%)`, exit 1. Then restored.
- `pnpm verify`: lint 0, typecheck 0, test 0, audit 0.

The `pnpm install` warning "unmet peer @babel/core" (apps/api → `@sentry/bundler-plugins`) already existed on main and is unrelated to this change.
