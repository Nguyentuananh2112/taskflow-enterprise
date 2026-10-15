# G2 (A's share): `data-and-api.md`, `security.md`, `devops.md` vs current code

Reader: A. Base: main `ce4991c`. E covers `frontend.md` and `test-spec-*`. S1 (the §6.4 rate-limit table) is on `review/G2-design-drift`.

**Method.** Two independent read-only scans were run per document: A's agents and E's agents (E's raw file was handed to A). Each item was checked against both the doc and the code. A re-checked the High items and the "missing code" items by hand: D1, O1, O2, O3, S2. Most items were found independently by both scans.

**Owners.** The fix goes to each document's owner. G2 does not edit design docs. Items marked **CODE** mean the doc is right and the code is missing something.

Legend: H = following the doc breaks a client, deploy or CI; M = described behaviour differs; L = stale number or wording.

## data-and-api.md

| # | Sev | Doc | Code (actual) | Suggested fix |
|---|---|---|---|---|
| D1 | **H** | §2.5 L469–470, §2.6 L494–496: no `409 VERSION_CONFLICT` on PATCH/DELETE workspace, PATCH/archive/unarchive project. §3.2 L559 says details are `{ currentVersion, current: TaskDto }`. | ADR-110 `workspace/application/optimistic-save.ts:11-28` throws `VersionConflictError(current.version)` ⇒ `current: null`. A client that reads `details.current` as a TaskDto breaks. | Add the 409 to those rows. §3.2: `current` = TaskDto for tasks, `null` for workspace/project. |
| D2 | M | §1.4 L167–184 / L203–221: Workspace and Project have no `version`. | `schema.prisma:107,145` `version Int @default(1)`; migration `20261016000000_workspace_project_version` (+ `CHECK version >= 1`). `allocateTaskNumber` doesn't bump it. | Sync §1.4 with schema.prisma. Add an ADR-110 row to §1.1. |
| D3 | M | §3.1 L543: a bad cursor gives `details.field="cursor"`. | `core/http/cursor.ts:13-37`: `details.issues[0] = { path: ["cursor"], code: "invalid_cursor" }`. Members/projects cursors are `{after}`, tasks `{status,rank,id}`, audit `{createdAt,id}`. | Use the `issues[]` shape and correct the key examples. |
| D4 | M | §3.2 L550: "`code` là mã issue của Zod". | Custom codes also appear: `invalid_json`, `bad_request` (`error-handler.ts:36,62`), `invalid_cursor`, `mismatch` (confirmSlug, `delete-workspace.use-case.ts:43-45`), `invalid_value` (role, `add-member.use-case.ts:27`). | List the custom codes. |
| D5 | M | §1.7 L336/L339, §2.2 L408: restore goes through `requireMembership(…, { includeDeleted, minRole: OWNER })`, with "a test blocking use elsewhere". | `workspace.routes.ts:79-85`: restore **skips** `loadMembership`. `restore-workspace.use-case.ts:28-34` checks OWNER and the grace window itself, uniform 404 (ADR-103). Neither `requireMembership` nor `includeDeleted` exists. | Describe ADR-103 as built. Rename `requireMembership` to `loadMembership` (L329, L397). |
| D6 | M | §4.2 L586–588: `project:join` acks `RESOURCE_NOT_FOUND \| VALIDATION_ERROR \| UNAUTHORIZED`; `project:leave` acks only ok; `auth:renew` failure is `UNAUTHORIZED` + disconnect. | `socket-handlers.ts`: join also acks `RATE_LIMITED`, `BUSINESS_RULE_VIOLATION` (> 20 rooms) and `SERVICE_UNAVAILABLE`; leave acks `VALIDATION_ERROR`; renew acks `RATE_LIMITED` (no disconnect). **After `fix/realtime-g1`:** join can also ack `UNAUTHORIZED` (session failed re-auth); renew acks `SERVICE_UNAVAILABLE` + disconnect when the room recheck fails; handshake `RATE_LIMITED` past 20 sockets/user/instance. | Rewrite the ack columns once `fix/realtime-g1` is merged. |
| D7 | M | §4.3 L617: `auth:expired` ⇒ FE refreshes + renews; server disconnects after a grace period. | `socket-handlers.ts` `scheduleExpiry`: emits at `exp` then **disconnects immediately**. No grace period. | "Emitted at exp, then disconnect; renew before exp." |
| D8 | M | §3.2 L570: 503 only when Valkey and DB both fail on the `token_version` check. | Also: fail-closed limiters with Valkey down (login/register/refresh/change-password, `rate-limit/store.ts:88`); session-revocation write fails (`auth-shared.ts:56-63`, ADR-105); transient DB error after 3 retries in task create/move (`task-commands.ts`, T-033 F3/F5). | List all causes in §3.2 and in §1.3 (move: "409 after 3 tries" ⇒ also 503). |
| D9 | L | §1.7 L349–353: purge = small batch transactions, `FOR UPDATE SKIP LOCKED`. | `prisma-workspace.purger.ts:17-41`: **one transaction per workspace** (5000-row chunks cap statement size only); global run lock (`exclusive-purge-run.ts`) + per-workspace advisory lock + plain `FOR UPDATE`; ≤ 50 ws per run; a failing workspace is skipped (F4). | Describe as built. |
| D10 | L | §1.7 L321: delete workspace = `SELECT … FOR UPDATE`. | ADR-110 conditional `UPDATE … WHERE id AND version AND deleted_at IS NULL` (`prisma-repositories.ts:51-63`). | Replace step 1. |
| D11 | L | §1.3 L59: rank > 64 chars ⇒ rebalance the column. | Skipped (warn log) when the column has > 500 tasks (`RANK_REBALANCE_MAX_TASKS`, T-033 F2). | Add the cap. |
| D12 | L | §2.1 L393: `X-Request-Id` optional, generated if missing. | A non-uuid value is **replaced** (`core/http/middleware.ts:20,50`). | Add it. |
| D13 | L | §4.1 L580: rooms `project:` and `user:` only; `connect_error` codes are UNAUTHORIZED/TOKEN_EXPIRED. | `session:{sid}` room is also used (per-session disconnect). Handshake may refuse with `ORIGIN_NOT_ALLOWED` / `RATE_LIMITED` / `SERVICE_UNAVAILABLE`, and any `AppError` code passes through (`gateway.ts`). | Add them. |
| D14 | L | §5.1 L651–655, L677: contracts tree. | `ChangeMemberRoleResponse` is in `member.schemas.ts`; the `openapi/` module plus the `./openapi` subpath (server-only, not in the barrel) is missing; `GET /api/docs` (local/test) is missing; `ProjectLeavePayload`, `DueDate`, `ProjectName`/`ProjectDescription` are missing. | Update the tree; mention A2 `/api/docs`. |
| D15 | L | §3 / §2: rate limits. | Undocumented: change-password 5/15 min/user, create-workspace 10/h/user, add-member 30/h/user (`rules.ts`, `workspace.routes.ts:64,95`, `auth.routes.ts:61`). | Add them, or point to security.md §6.4 (S1). |

## security.md (owner: B)

| # | Sev | Doc | Code (actual) | Suggested fix |
|---|---|---|---|---|
| S2 | **M — CODE** | §2.2 L183: "Job hằng ngày xóa dòng có `expiresAt < now − 7 ngày`" (also devops §7.4 L536). | **No such job.** Only `purge-deleted-workspaces` is scheduled (`maintenance-jobs.ts`, `start-server.ts`). `prisma-refresh-token.repository.ts` has no delete. `refresh_tokens` (with `ip`, `user_agent`) grow forever: a **data-retention gap** (not exploitable). | Build the job: the `MaintenanceScheduler` plus the `expires_at` index already exist, so it's small. Or mark it deferred plus a retention note. **TL decides.** |
| S3 | M | §3.4 L320, §3.6 L374: restore uses `requireMembership(includeDeleted, OWNER)` "có lint/test chặn dùng ở route khác". | Same as D5. The lint/test doesn't exist. Behaviour (uniform 404) holds. | Describe ADR-103; drop the lint claim. |
| S4 | M | §4.2 L410: soft-deleted task ⇒ 404. | `GET …/tasks/:id/audit-logs` of a soft-deleted task returns **200** (`task.routes.ts:88-92`, `task-membership.ts:47-48`), as data-and-api L513 says. | Add the exception. |
| S5 | M | §5.3 L449 / §5.4 L472: the renew room recheck is a safety net. | Main: on DB error the recheck **keeps** the room (`recheck_failed_keep_room`). **Fixed by `fix/realtime-g1` (L3)**: ack `SERVICE_UNAVAILABLE` + disconnect. | No doc change after merge; just state "fail-closed". |
| S6 | M | §5.4 L462: workspace delete emits `workspace:access-revoked` to the **project rooms**. | `gateway.ts` `closeWorkspace` emits to each member's `user:{uid}` room, then leaves the project rooms. After `fix/realtime-g1`, it also leaves by `data.joined`. | Update the row. |
| S7 | M | §2.3 L205: cookie name from `NODE_ENV`, a `COOKIE_NAME` var; prod guard on `NODE_ENV`. | Name and Path come from `COOKIE_SECURE` (`refresh-cookie.ts:27-28`); there is no `COOKIE_NAME`. Guard on `APP_ENV ∈ {staging, production}` (`env.ts:102-108`). | Rewrite. Staging = production. |
| S8 | M | §6.9 L594: placeholder / < 32-byte secret rejected when `NODE_ENV=production`. | ≥ 32 bytes is enforced **always** (`env.ts:14-16`). `change-me*` / `test-only-*` are rejected on APP_ENV staging/production (`env.ts:9,113-115`), including `JWT_ACCESS_SECRET_PREVIOUS`. | Rewrite. |
| S9 | L | §1.4 L95, §1.5 L119, §2.4 L220: `sid-revoked` `EX 900`. | `905` (`auth-shared.ts:14`, ACCESS_TTL + 5). L216 and threat-model R6 already say 905. | 905. |
| S10 | L | §6.2 L488, W-CSP-2 L568, W-CSP-4 L576: HSTS / `upgrade-insecure-requests` "chỉ prod". | `APP_ENV` staging or production (ADR-101; `app.ts:38`, web `csp.ts:28,54,66`). | Say so. |
| S11 | L | §6.2 L490: `no-store` only on `/auth/*`. | All of `/api/v1` (`app.ts:89-92`, T-028 L4). | Update. |
| S12 | L | §6.1 L481: middleware order. | requestLogging → metrics → helmet+cors → **health router** → Content-Type → json → no-store → global RL → `/api/docs` (local/test) → routes (`app.ts:75-104`). Health sits before the Content-Type check and the limiters. | Update. |
| S13 | L | §6.3 L497: 415 only for POST/PATCH not JSON. | Also PUT; non-UTF-8 or duplicate charset ⇒ 415 on any method with a body (`middleware.ts:113-153`). Threat-model §4.4 already says this. | Update. |
| S14 | L | §6.5 L525: common-password list ~10k; password must not contain the email local part. | 46,146 entries (SecLists xato 1M, filtered 12–256); the local-part check is skipped when it's < 3 chars (`password-policy.ts:14,55-58`). | Update. |
| S15 | L | §6.7 L543: member search via Prisma `contains` / `mode: insensitive`. | Parameterised `$queryRaw` `ILIKE … ESCAPE '\'` + `escapeLike` (`prisma-queries.ts:44-96`). | Update (still injection-safe). |
| S16 | L | §6.7 L545: redaction list. | `pino-logger.ts:10-33` also covers top-level names, `passwordHash`, `meta.driverAdapterError`; the access log drops the query string; the `err` serializer is an allow-list. | Point to `REDACT_PATHS`. |
| S17 | L | §2.1 L156: JWT secret "≥ 32 byte ngẫu nhiên (base64)". | Length is checked on the **UTF-8 string** as given, so 32 base64 chars = 24 bytes of entropy (`env.ts:13-16`). | Require ≥ 44 base64 chars, or word it as "32 bytes of string". |
| S18 | L | §2.3 L192–193: dev web `localhost:3000`. | `:3001` (ADR-097, `env.ts:48-49`). | 3001. |
| S19 | L | §3.4 L319: `DELETE ws` without body; §5.1 L431: socket errors only TOKEN_EXPIRED/UNAUTHORIZED. §4.2 L414: 404 "không `details`". | `DELETE ws` needs strict `{ confirmSlug }`. Socket: see D13. 404 always carries `details.resource` (`client-errors.ts:92-94`) — no leak, matches data-and-api L558. | Update. |
| S20 | L | §1.4 diagram L86–105: refresh = one SELECT … JOIN users. §1.5 L117: logout "luôn 204". | Refresh takes `FOR SHARE` on the user row before issuing (`refresh-session.use-case.ts:66-72`, T-032 X4). Logout: > 4 duplicate cookies ⇒ 401 without clearing (`auth.controller.ts:81-82,102-107`), as §2.3 L203 itself says. | Add the lock step; fix "luôn 204". |

## devops.md (owner: D)

| # | Sev | Doc | Code (actual) | Suggested fix |
|---|---|---|---|---|
| O1 | **H** | §3.4 L259, §4.1 L268, §8.4 L593–594: root `pnpm db:deploy`, `pnpm db:seed`, `db:seed:load`. | Root `package.json` has only `infra:*`, `docker:*`. `db:deploy` / `db:seed` / `db:check-drift` live in `apps/api/package.json:12-16`. `db:seed:load` doesn't exist. | `pnpm --filter @taskflow/api db:deploy`, or add root aliases. Mark `db:seed:load` as Phase 5. |
| O2 | **H** | §3.2 L226 (+ L206, L267): migrate image `CMD ["node","node_modules/prisma/build/index.js","migrate","deploy"]` / "pnpm exec prisma migrate deploy". | `apps/api/Dockerfile:62` `CMD ["node","migrate.mjs"]` = migrate deploy **+ `grant-app.sql`** (`docker/migrate/migrate.mjs`). No pnpm in the image. Copying the doc's command (e.g. as a platform pre-deploy override) **skips the grant** ⇒ `taskflow_app` has no DML on new tables. | Fix the 3 places. |
| O3 | **H** | §3.2 L229, §4.1 L267: build targets `api` / `api-migrate`. | Stages `runtime` / `migrate` (`Dockerfile:54,65`; `ci.yml` `target: runtime/migrate`). Images `taskflow-api` / `taskflow-api-migrate`. A D3 deploy config using `--target api` fails. | Fix names. |
| O4 | M | §2.5 L187, §5.1 L364–365: the `static` job runs gitleaks, `prisma validate` and `migrate diff`. | Gitleaks is its own job (`ci.yml:36-64`). Validate and drift run in `integration` / `security` after `db:deploy` (`ci.yml:171-179, 235-243`). | Move the bullets. |
| O5 | M | §5.1 L346/L368: `vitest run --project unit --coverage`. | No `unit` project. `pnpm test` (with a Valkey service) + `pnpm --filter @taskflow/api test:coverage` (`ci.yml:99-128`). | Update. |
| O6 | M | §5.1 L385: merge-blocking = `static, unit, integration, build`. | `security` also blocks (L373 itself and `ci.yml:198`), plus `gitleaks` and `actionlint`. Required checks match the job **display names** (`ci.yml:79,100,135,199,260`). | List the display names to put in the ruleset. |
| O7 | M | §2.2 L134–153: env table. | Missing `JWT_ACCESS_TTL_SECONDS` (test only), `SENTRY_TRACES_SAMPLE_RATE`, `METRICS_PORT` (≠ PORT), `METRICS_HOST`, `MAINTENANCE_JOBS_ENABLED`, `PURGE_INTERVAL_MS`, `PURGE_JITTER_MS`, `PERSISTENCE` (memory rejected on staging/prod) (`env.ts`; all in `.env.example`). `CORS_ORIGINS` has a default; `METRICS_TOKEN` is required on staging **and** production. | Add rows; fix the required flags. |
| O8 | M | §2.4 L174–179: hardening on `NODE_ENV=production`. | `APP_ENV ∈ {staging, production}` (`env.ts:97-121`), which also requires `NODE_ENV=production`, `METRICS_TOKEN`, https `SENTRY_DSN`, `PERSISTENCE ≠ memory`, and rejects `change-me*` / `test-only-*`. | Rewrite (same as S7/S8). |
| O9 | M | §2.1 L121, §3.4 L258: `docker-compose.prodlike.yml` "used for E2E in CI". | Doesn't exist. E2E is `e2e/` with a Playwright `webServer` (API from source + standalone web), Postgres + Valkey db 14; chromium/firefox/Pixel 7; no e2e CI job yet. | Describe as built; prodlike = Phase 4. |
| O10 | M | §4.3 L303, §4.4 L316–326: backup/restore = "Phase 5", runbook `docs/runbooks/restore.md`, drill monthly, `pg_restore --list`. | Built (B2): `docker/backup/*`, `.github/workflows/backup-drill.yml` (weekly Mon 03:00 UTC + PRs touching backup/migrations/roles). Runbook `docs/runbook/backup-restore.md`. `backup.sh` reads the whole archive (`--list` caused SIGPIPE) + `.ok` marker. | Point to the runbook; add `backup-drill.yml` to §5. See also the G1 B2 cross-read (object lock). |
| O11 | M | §8.2 L564–569: coverage thresholds for domain/application/contracts enforced. | Only `src/core/**` (`apps/api/vitest.config.ts:19-24`); contracts has none. | State what's enforced, or add the globs (**CODE**, small). |
| O12 | M | §7.4 L536–542: refresh-token cleanup job; "chọn `croner`/`node-cron`"; `pg_try_advisory_lock`. | In-house `MaintenanceScheduler` (T-033: first run 30 s + jitter, AbortSignal); `pg_try_advisory_xact_lock`; only the purge job (see S2). Env `MAINTENANCE_JOBS_ENABLED`, `PURGE_*`. | Close the open point (also §10 L688). |
| O13 | M | §2.3 L161–166: web env. | Also `TRUST_PROXY_HOPS` (tunnel limit), `APP_MOCK_API`. Missing `APP_ENV` ⇒ treated as production (`apps/web/.env.example`, `server-env.ts`). | Add them. |
| O14 | L | L24, §5.1 L379, §8.1 L556: Playwright `1.64.1`. | `1.64.0` (`pnpm-workspace.yaml:12-13`; 1.64.1 not past minimumReleaseAge). | 1.64.0. |
| O15 | L | §3.1 L208: `pnpm deploy --offline`. | `--prefer-offline` (`Dockerfile:48`; `--offline` ⇒ ERR_PNPM_NO_OFFLINE_META). L224 already right. | Fix L208. |
| O16 | L | §3.1 L214 / §5.1 L376–378: all 3 targets built, implying Trivy scans them. | Trivy scans only `taskflow-api:ci` and `taskflow-web:ci` (`ci.yml:338`). | State it, or add migrate to the loop. |
| O17 | L | §3.1 L211: OCI labels `revision` + `source`. | Only `title` + `revision` (`apps/api/Dockerfile:74-75`, `apps/web/Dockerfile:43-44`). | Fix the doc or add `source`. |
| O18 | L | §6.2 L436: `/readyz` 200 `{db:"ok", valkey:"ok"\|"degraded"}`. | Also `db:"down"`, and `shuttingDown: true` in the 503 body during shutdown (`health.ts:43,91`). | Add them. |
| O19 | L | §8.3 L585, §8.4 L590: truncate list from `pg_tables`; `apps/api/test/factories/`. | Tables hard-coded (`test/integration/db.ts:19-22`), schema dropped once (`global-setup.ts`), `fileParallelism: false`. Helpers live in `test/support/*`, `src/modules/*/testing/`, `test/integration/support/`. | Update. |
| O20 | L | — | `pnpm verify` (`.github/scripts/verify.mjs`, the DoD per CONTRIBUTING) is not mentioned. | Add to §5 / §8. |

## Summary for the TL

- **Needs a decision / code:**
  - **S2:** the refresh-token cleanup job doesn't exist (retention gap). A could build it on the existing `MaintenanceScheduler` in about an hour.
  - **O11:** coverage thresholds.
  - O16/O17 are optional.
- **High doc fixes (would break someone following the doc):**
  - D1 (409 `current: null`);
  - O1–O3: deploy commands and target names. D3 deploy prep should use the real ones; O2 silently skips the grant.
- **After `fix/realtime-g1` merges:** D6, S5 and S6 need the post-merge wording.
- Everything else is stale wording. Every item has a doc line and a code location for its owner.
