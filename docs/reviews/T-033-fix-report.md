# T-033 fix: B's cross-read findings (F1 High, F2, F3, F5, F6, F7)

Branch `fix/T-033-same-column-rebalance`. Source: `docs/reviews/G1-T-033-crossread.md` (B). **F4** (a purge batch stops at the first failing workspace) is done by B in their own module, as agreed with the TL.

| # | Fix | Test | Mutation check / proof |
|---|---|---|---|
| **F1 High** | The rebalancer maintains the **invariant "every stashed row is rewritten before returning"**: the moving task is already in the target column and gets a new key equal to its old rank ⇒ it is saved with its unchanged rank (no version / audit / event), the same way the existing branch handles other tasks whose key equals their old rank. | `rank-rebalance.test.ts` (InMemory + **Postgres via the LSP runner**): column A `a0`, B long, C after B, X `a2` at the end; X moves after B ⇒ the spread gives X `a2` = its old rank. Asserted on **DB rows**: no `~` rank, order A, B, X, C, and a follow-up `create` appends to the end of the column. | Without the fix: **red on both InMemory and Postgres** (1 row with rank `~<uuid>`). B's reproduction (P, Q, R, L, X) follows the same mechanism. |
| F2 | Columns with more than `RANK_REBALANCE_MAX_TASKS = 500` tasks are **not rebalanced**: the long key is kept (still a valid key, and `rank` is unbounded text), with a warning `task.rank_rebalance_skipped_large_column`. This avoids repeated P2028 / 500 errors past the 10 s budget. | 500-task column + a move into a narrow gap ⇒ rank > threshold, other tasks unchanged, warning logged (InMemory + Postgres). | — |
| F3 | `lockColumn` runs `set_config('lock_timeout', '2s', true)` (scoped to the transaction) before `pg_advisory_xact_lock` ⇒ waiting no longer blocks forever while holding pool connections. | `task-lock-timeout.int.ts`: another transaction holds the column lock ⇒ **real 55P03 after about 2 s**, recognised as a transient error. | — |
| F3/F5 | `core/persistence/transient-db-error.ts` recognises `55P03` / `40P01` / `40001` (Prisma 7 adapter-pg `meta.driverAdapterError.cause.originalCode`, the pg `code`, or the cause chain). `inTransactionWithRankRetry` reruns the transaction for these (as for `RankConflictError`) and, after `RANK_RETRY_LIMIT`, returns **503 SERVICE_UNAVAILABLE** instead of 500. | Unit test for the helper; a transient error once ⇒ retry and success; always transient ⇒ 503 (InMemory + Postgres). | — |
| F6 | `ScheduledJob.firstRunAfterMs`: the first run comes after that delay plus jitter, not a full cycle. Purge: `PURGE_FIRST_RUN_AFTER_MS = 30 s`. | Scheduler test with fake timers: first run at 30 s + jitter, later runs at interval + jitter. | — |
| F7 | The scheduler passes an `AbortSignal` to `run(signal)`; `stop()` aborts it. The purge job skips the run if the signal is already aborted. | Scheduler test: a job checks the signal between steps ⇒ stops after `stop()`. | **For B (F4):** `PurgeDeletedWorkspacesJob.execute` should take `{ signal }` and check `signal.aborted` between workspaces; `composition/maintenance-jobs.ts` will pass `signal` through once B's API lands. |

## Decisions

- **F1 — why not exclude the moving task from the stash:** while phase 2 writes the other tasks, the moving task would still hold its old rank, and a new key for another task could be equal to it ⇒ a collision on the unique index `tasks_rank_live_key`. The rebalancer invariant fixes the whole class of bug in one place; the use case doesn't need to know.
- **DB-level safety net (TL suggested `CHECK (rank !~ '^~') DEFERRABLE`):** **not done** — PostgreSQL **does not allow DEFERRABLE CHECK constraints** (only UNIQUE / PK / FK / EXCLUDE). The equivalent is a deferred `CONSTRAINT TRIGGER` that re-reads the current row at commit (it can't trust `NEW`, because phase 1 fires the trigger with `~`). Feasible, but it adds a plpgsql function plus a per-row check on every write to `tasks`. I'm proposing it as a separate decision for the TL rather than slipping it into this fix.
- **F2 — event fan-out:** still one `task:moved` per changed task. The cap bounds this at ≤ 500 events per rebalance. Bulk UPDATE plus a single `task:column_rebalanced` event can be considered under A3 once k6 numbers exist.
- `lock_timeout = 2s` also applies to row locks taken later in the same transaction. Intended: nothing waits indefinitely.

## DoD

`pnpm verify`: lint 0, typecheck 0, test 0, audit 0. Integration on my own DB `taskflow_t036` (maintenance + task + LSP): **28 files, 305 tests, exit 0**.
