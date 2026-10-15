# O11: coverage thresholds for domain / application (ADR-074, devops.md §8.2)

Branch `chore/coverage-thresholds`. Source: G2 O11. `devops.md` §8.2 promised thresholds that only existed for `src/core/**`.

## Measured before enabling

`apps/api`, `vitest run --coverage --maxWorkers=2`, main `2178744`.

| Area | Lines | Statements | Branches | Target (lines·stmts / branches) |
|---|---|---|---|---|
| `domain` (all modules) | 98.5 | 98.6 | 100 | 90 / 85 |
| ↳ auth / task / workspace | 100 / 99.2 / 95.9 | 100 / 99.3 / 96.3 | 100 / 100 / 100 | |
| `application` (all modules) | 99.3 | 97.6 | 93.4 | 80 / 75 |
| ↳ auth / task / workspace | 99.0 / 99.3 / 99.7 | 97.8 / 97.7 / 97.3 | 93.4 / 93.0 / 93.8 | |
| `core` (existing threshold) | 99.0 | 98.3 | 86.5 | 90 / 85 |

Weakest files. They are already above the aggregate threshold, but worth a test when someone touches them:
- `task/application/task-assignment-cleaner.ts`: branches 50%.
- `workspace/application/adapters/project-access-checker.ts`: lines 87.5%, branches 50%.
- `workspace/domain/workspace.ts`: lines 88%.

## Change

`apps/api/vitest.config.ts` gets two more `coverage.thresholds` globs. They aggregate every module, so a new module is covered automatically:
- `src/modules/*/domain/**`: lines 90, statements 90, branches 85;
- `src/modules/*/application/**`: lines 80, statements 80, branches 75.

CI already runs `pnpm --filter @taskflow/api test:coverage` against this file (`ci.yml` unit job), so no workflow change is needed.

## Proof

- `vitest run --coverage` (same config as `test:coverage`): **exit 0**.
- **Config mutation:** I raised the domain lines threshold to 99 (actual 98.45%). Result: `ERROR: Coverage for lines (98.45%) does not meet "src/modules/*/domain/**" threshold (99%)`, **exit 1**. Then restored.
- `pnpm verify`: lint 0, typecheck 0, test 0, audit 0.

## Next (not tonight)

- `packages/contracts/**` ≥ 80% (devops.md §8.2): contracts has no coverage config yet. It needs its own `vitest.config` with coverage plus a CI step.
- `devops.md` §8.2 can now say "enforced by `apps/api/vitest.config.ts`" (D's doc; included in G2 O11).
