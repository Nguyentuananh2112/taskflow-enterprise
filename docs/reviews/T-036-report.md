# T-036: Public repo documentation

Branch `feat/T-036`.

## Done

| File | Content |
|---|---|
| `README.md` | Product in one paragraph, board screenshot (`docs/assets/board.png`, from the prod build with fake seed data), v1 features + what is **not** in v1 (comments ADR-111, email verification ADR-049, SSO, attachments), stack + main versions (from the catalog), local setup in 5 steps (pointing to `docs/runbook/local-dev.md`), common commands, monorepo layout, documentation map. Fixed the old README (web port 3000 ⇒ **3001** per ADR-097; `/healthz` no longer has `gitSha`). |
| `docs/ARCHITECTURE.md` | Mermaid diagrams: overview; modules + core + composition and the 4 Clean Architecture layers; the table of dependency-cruiser rules (actual rule names in `packages/config/depcruise/api.cjs`); the **move task** request flow (sequence: middleware → error order → column lock → policy/422/409 → rank + rebalance → conditional UPDATE + audit → commit → afterCommit emit); auth/session; FSD; realtime; observability; table of key ADRs. Summarises and links out instead of copying. |
| `CONTRIBUTING.md` | Branches/worktrees (reusing worktrees per ADR-107), pre-commit hooks (gitleaks/prettier/eslint — `--no-verify` forbidden), DoD (**check exit codes**, integration on your own DB per ADR-106, tests that prove the bug), code conventions, reducing dev-machine load, how to propose an ADR (only the TL edits DECISIONS). |
| `SECURITY.md` | Private reporting through GitHub "Report a vulnerability" (no public issues), what to include, rules for testing, in/out of scope, supported versions, commitments, link to `security-go-live.md`. |

## Checking the README commands (ticket item 5)

On the worktree, following the README in order. **Deliberate deviation:** step 4 points `DATABASE_URL` at my own DB `taskflow_t036` (postgres-test 5434) instead of the shared dev DB 5435, because **seed truncates the database** — the commands are identical, only the URL changes.

| Step | Command | Result |
|---|---|---|
| 1a | `corepack enable pnpm` | **exit 1** — EPERM writing into `C:\Program Files\nodejs` without admin rights (as runbook §1.2 says). README now notes: needs admin, or use `corepack pnpm …`. |
| 1b | `pnpm install` | exit 0 |
| 2 | `pnpm infra:up` | exit 0 (compose `name: taskflow` ⇒ running it from a worktree reuses the same containers) |
| 3 | `cp apps/api/.env.example …`, `cp apps/web/.env.example …` | exit 0 (files are git-ignored) |
| 4 | `db:deploy`, `db:seed` with the migrator user | exit 0, exit 0 |
| 5 | `pnpm dev` | **BUG FOUND:** web OK, but the **API never started** (silent, not listening after more than 6 minutes). |

**Bug in `pnpm dev` (fixed):**
- Narrowed down step by step:
  - `tsx watch` run directly, `pnpm --filter @taskflow/api dev`, and plain `tsx` under `--parallel` all start in about 2 s;
  - **`tsx watch` under `pnpm --parallel`** always hangs, even with a minimal `main.ts` (no Sentry, no dynamic import), so the cause isn't app code.
- Fix: `apps/api` `dev` = `node --watch --env-file-if-exists=.env --import tsx src/main.ts`. Under `--parallel` it starts in about 2 s, and it **restarts when a nested TS file changes** (tested by touching `core/http/health.ts`).
- After the fix, `pnpm dev` gives API `/healthz` 200 `{"status":"ok"}` and web `/login` 200.
- File outside scope: `apps/api/package.json` (1 line), changed so the README is actually runnable.

(Port 4000 on the dev machine was taken by another session's process, so step 5 was checked with `PORT=4792` + `API_URL` overrides through env — the README commands themselves are unchanged.)

## Screenshot

`docs/assets/board.png` (1440×900, 112 kB):
- taken from the **prod build** (`pnpm build` exit 0 ⇒ API `dist/main.js` + web standalone) against my own DB `taskflow_t036` after `db:seed`;
- data is fake: the sample user "Olivia (dữ liệu mẫu)", tasks "Công việc mẫu số n", no email shown on the board;
- logged in through the real UI with Playwright, **borrowed from F's T-026 worktree** (no dependency added to this branch); the script lives in my scratchpad, not the repo.

## Not done here (waiting on others)

- D (`chore/verify-script`, not on main yet): `pnpm verify` and `verifyDepsBeforeRun: error` ⇒ `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` ⇒ `pnpm install`. These will be added to CONTRIBUTING **after D's branch merges** (documenting a command that doesn't exist yet would break the "every command runs" requirement). Also D af231ad: `pnpm lint` runs `prisma generate` itself first (a fresh worktree no longer fails lint wrongly).
- `SECURITY.md` relies on the repo having **Private vulnerability reporting** turned on (GitHub repo Settings → Security). This is the owner's job when the repo goes public; it can't be done in code.
