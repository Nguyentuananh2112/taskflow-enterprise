# G2 S2: refresh-token cleanup job (+ D1 doc fix, separate commit)

Branch `fix/refresh-token-retention`. Source: G2 S2. `security.md` §2.2 promises a daily cleanup job that didn't exist, so `refresh_tokens` (with `ip` and `user_agent`) grew forever. The TL approved building it, following the purge-job pattern.

## What was built

| Part | File |
|---|---|
| Port | `auth/application/ports/refresh-token-purger.port.ts` — `purgeExpired(cutoff, limit): number \| null` (`null` = another instance holds the batch lock). |
| Job | `auth/application/use-cases/purge-expired-refresh-tokens.job.ts` — cutoff = now − 7 days; one transaction per batch (5 000 rows); at most 20 batches per run; `signal` stops before the next batch; result `{ deleted, batches, busy, complete }`. |
| Prisma | `auth/infrastructure/persistence/prisma/prisma-refresh-token.purger.ts` — first statement `pg_try_advisory_xact_lock('taskflow:refresh-token-purge')`, then `DELETE … WHERE id IN (SELECT … ORDER BY expires_at LIMIT n FOR UPDATE SKIP LOCKED)`. |
| Schedule | `composition/maintenance-jobs.ts` `purgeRefreshTokensJob`: every 24 h, jitter 30 min, first run 90 s after start (offset from the workspace purge at 30 s). Summary log `maintenance.refresh_token_purge_summary` contains **counts only**. Wired in `start-server.ts` next to the workspace purge, wrapped by `measured` ⇒ `scheduled_job_*` metrics. Prisma only (`persistence.refreshTokenPurger`), same as `workspacePurger`. |

## Decision: delete by **family** expiry, not per-token expiry

The doc said `expiresAt < now − 7 days`. That would be **wrong**: `RefreshToken.assess` still reports `reused` for a **rotated** token after it has expired, which revokes the family (theft detection). Deleting rotated tokens 7 days after their own expiry would drop that detection while the family is still alive (up to 30 days absolute). The rule is now **`familyExpiresAt < now − 7 days`**. The SQL also has `expires_at < cutoff`, which is always true when the first condition holds, so the `expires_at` index is used. A row therefore lives at most about 37 days. Other readers are unaffected:
- `listRevokedSessionsSince` (X3 cache refill) only needs revocations within the access-token TTL.
- `isSessionRevoked` for a family that is fully deleted returns false, which is harmless: every token of that family has been dead for 7 days or more.

`security.md` §2.2 and the `devops.md` §7.4 job row are updated in this branch.

## D1 (TL decision: fix the doc to match the code)

`data-and-api.md`:
- §2.5/§2.6: PATCH/DELETE workspace and PATCH/archive/unarchive project now list `409 VERSION_CONFLICT` (ADR-110).
- §3.2: `details.current` is a `TaskDto` for tasks and **`null`** for workspace/project. The client must not treat it as a DTO.

## Tests

- Unit (`purge-expired-refresh-tokens.job.test.ts`, 5 tests): cutoff, every batch inside a transaction, last batch < batchSize ⇒ complete, batch cap ⇒ incomplete, busy ⇒ stop, abort before the next batch / before the first.
- Composition (`maintenance-jobs.test.ts`, 3 tests): schedule constants, first run offset from the workspace purge, summary with counts only, busy is not an error, a DB error fails the run.
- Integration, real Postgres (`test/integration/auth/refresh-token-purge.int.ts`, 3 tests):
  - only families more than 7 days past their absolute expiry are deleted, including a rotation chain (self-FK `SET NULL`);
  - **an expired rotated token of a live family is kept**;
  - a family 6 days past expiry is kept;
  - batch limit, oldest first, the next run continues;
  - another transaction holds the lock ⇒ `busy`, nothing deleted.
- **Mutation check:** dropping `AND family_expires_at < cutoff` (deleting by per-token expiry) ⇒ the first integration test goes red.

## DoD

`pnpm verify`: lint 0, typecheck 0, test 0, audit 0. Integration `test/integration/auth` + `maintenance` on my own DB `taskflow_t036`: 8 files, 34 tests, exit 0.
