# G2: Check of `docs/design/*` against current code (drift)

Reader: A (S1), E (the rest — continued from 2026-10-15 23:30). Base: main `679a131` → `1681b20`. Only **verified** drift is listed, each with a doc location, a code location and a suggested fix. The fix goes to the document's owner — G2 does not edit design docs directly.

## security.md (owner: B)

### S1 — §6.4 rate-limit table is missing 5 limiters added later

The table only covers HTTP routes as of T-021/ADR-108. Missing:

| Limiter | Code | Value |
|---|---|---|
| Auth failures (401) per IP — before token verification | `apps/api/src/core/http/rate-limit/rules.ts:120` (`authFailure`) | 30 × 401 / min / IP |
| Raw cap for requests carrying `Authorization` | `rules.ts:113` (`bearerIp`) | 1000 / min / IP |
| Socket `auth:renew` | `rules.ts:143` (`AUTH_RENEW_LIMIT`, T-030) | 5 / min / socket + 30 / min / user (instance) |
| `GET /readyz` | `apps/api/src/core/http/health.ts:30` (`READINESS_LIMIT`, T-031) | 60 / min / IP, in-memory |
| Sentry tunnel `POST /monitoring` (web) | `apps/web/src/app/observability/sentry-tunnel.ts:10` (`TUNNEL_LIMITS`, T-035) | 30 / min / IP + 300 / min / instance |

Suggestion: add these 5 rows, with a "where it is counted" column (Valkey vs instance memory), because readiness and tunnel limits deliberately don't depend on Valkey.

## frontend.md (owner: E)

### F1 — §1.2 "Đăng nhập": `RATE_LIMITED` promises a countdown, code shows a static number
- Doc: `frontend.md:69` — "`RATE_LIMITED` → \"Thử lại sau N giây\" (đếm ngược từ `retryAfterSec`)"; §8.2 (`:773`) lists "rate limit đếm ngược" as a component test case.
- Code: `apps/web/src/shared/lib/form-errors.ts:73-77` renders "Bạn thao tác quá nhanh. Thử lại sau {N} giây." once; no timer, the login button stays enabled.
- Fix (code, owner E): small countdown in the login form (disable submit until 0) + the §8.2 test; or relax the doc to "static N". Recommend the code fix — it is the documented UX.

### F2 — §6.3 component inventory lists primitives that don't exist
- Doc: `frontend.md:701` lists `IconButton`, `Checkbox`, `Field`, `ConfirmDialog`, `Tooltip`, `Popover`, `DatePicker`, `ErrorState`, `Banner`, `Tabs`.
- Code: `apps/web/src/shared/ui/` has alert, auth-card, avatar, badge, button, client-form, combobox, connection-dot, dialog, drawer, dropdown-menu, empty-state, input, select, skeleton, spinner, textarea, toast. Equivalents in use: confirmations = `Dialog` + footer; errors = `EmptyState` + "Thử lại"; date = native `<input type="date">` in `edit-task-form.tsx:69`; tabs = links (`widgets/settings-tabs`).
- Fix (doc): replace the list with what exists + the "use X instead" mapping, so new screens don't hunt for components that aren't there.

### F3 — §1.2 "Cài đặt workspace": delete-dialog copy is the pre-review text
- Doc: `frontend.md:76` quotes "Workspace sẽ bị ẩn với mọi thành viên … Chủ sở hữu có thể khôi phục trong thời gian này."
- Code: `apps/web/src/features/workspace-delete/ui/delete-workspace-section.tsx` (T-034, review B F3) — "Workspace sẽ biến mất ngay với mọi thành viên và bị xóa vĩnh viễn sau 30 ngày. Trong thời gian này chỉ Chủ sở hữu khôi phục được." + 404 (deleted elsewhere) ⇒ `/w`, 400/409 ⇒ refetch slug and clear input.
- Fix (doc): update the quote and the Error column.

### F4 — §0 refresh-cookie sentence predates ADR-109
- Doc: `frontend.md:33` — "cookie refresh có `Path=/api/v1/auth` và host-only trên `api.example.com`".
- Code: `apps/api/src/modules/auth/presentation/refresh-cookie.ts:12-16,27` — staging/prod `__Host-tf_rt; Secure; Path=/` (host-only), dev `tf_rt; Path=/api/v1/auth`.
- Conclusion in the doc (Next server can't read it ⇒ no server-side auth redirect) still holds (host-only on the API host). Fix (doc): state both variants and cite ADR-109.

Verified unchanged (no drift): §3.2 query keys + staleTime (me 5 min, lists 60 s, board/task Infinity, audit 0 — `apps/web/src/entities/*/model/*.ts`); §2.4 ESLint/depcruise limits (150/200 lines, ≤3 `useState`) — enforced by `pnpm lint` on every commit.

## test-spec-task.md (owner: C)

### T1 — §5 suggested file layout doesn't match the repo, and files named as written would NOT run
- Doc: `test-spec-task.md:451-471` — `domain/__tests__/*.spec.ts`, `application/__tests__/*.spec.ts`, `infrastructure/__tests__/*.int.spec.ts` / `*.concurrency.spec.ts`, `apps/api/test/support/fixtures.ts`, `in-memory/*.ts`.
- Code: no `__tests__/` dir and no `*.spec.ts` in `apps/api/src`. Unit tests sit next to code as `*.test.ts` (e.g. `apps/api/src/modules/task/domain/task.test.ts`, `application/use-cases/*.use-case.test.ts`); Postgres tests are `apps/api/test/integration/**/*.int.ts` (e.g. `task/task-concurrency.int.ts`); in-memory repo `src/modules/task/infrastructure/persistence/in-memory/`; fixtures/harnesses `src/modules/task/testing/`.
- Why it matters: `apps/api/vitest.config.ts:9` only includes `*.test.ts` — a new test written per the doc (`*.spec.ts`) is silently skipped.
- Fix (doc): replace §5 with the real layout + suffixes.

### T2 — Vitest project names and test doubles
- Doc: `:14-16`, `:471` — projects `unit`, `integration`, `concurrency` (concurrency ×20 nightly); doubles `FixedClock`, `FakeTransactionManager`.
- Code: projects `api` (`apps/api/vitest.config.ts`), `api-integration` (`vitest.integration.config.ts`, `test/integration/**/*.int.ts`), `api-security` (`test/security/vitest.config.ts`, `*.sec.ts`); no `concurrency` project, no nightly workflow (scheduled: `mutation.yml`, `backup-drill.yml` only). Doubles: `FakeClock`, `SequentialIdGenerator` (`apps/api/test/support/time-and-ids.ts`), `FakeUnitOfWork` (`test/support/fake-unit-of-work.ts`), `SpyEventBus` (`test/support/spies.ts`).
- Fix (doc): rename; mark "concurrency ×20 nightly" as future or drop.

## test-spec-auth-workspace.md (owner: C)

### T3 — "Layer I" is one thing in the doc, three runners in the repo
- Doc: `test-spec-auth-workspace.md:17` (layer I = real HTTP + Postgres + Valkey); `:373` note 3 (schema per worker or truncate between files ⇒ parallel).
- Code: HTTP-level tests `apps/api/test/http/*.http.test.ts` run in the default `api` project via `pnpm test` (no Postgres); Postgres tests `test/integration/**/*.int.ts` via `test:integration`, one DB `taskflow_it` (`DATABASE_URL_TEST`), sequential (`fileParallelism: false`, `apps/api/test/integration/db.ts:19-22` truncates a fixed table list); black-box HTTP+DB+Valkey `test/security/*.sec.ts` via `test:security` (DB `taskflow_sec`, Valkey db 15). Race cases: `test/integration/workspace/workspace-races.int.ts`, `auth/auth-races.int.ts`, `test/security/workspace-races.sec.ts`.
- Fix (doc): short "where layer I runs" table (3 commands + DBs); drop "per-worker schema / parallel".

Split (Tech Lead, 23:30): A covers data-and-api.md, security.md (beyond S1), devops.md in `docs/reviews/G2-design-drift-A.md`; E covers frontend.md + test-spec-*. E passed A raw, two-sided-checked notes for A's three docs.

