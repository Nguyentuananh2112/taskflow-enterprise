# T-035: Observability (Sentry API + web, metrics, alerts)

Branch `feat/T-035`.

## Done

| # | Item | Implementation | Main test(s) |
|---|---|---|---|
| 1 | Sentry API | `@sentry/node` **11.7.0**: 11.8.0 was < 24 h old, so not used. `core/observability/sentry.ts`. `beforeSend` **allow-list**: builds a new event, with the error part from T-031's serializer. Only 5xx errors and fatal errors are sent. Tag `reqId`, `release` = `GIT_SHA`, `environment` = `APP_ENV`, `SENTRY_TRACES_SAMPLE_RATE` defaults to 0.05. | `sentry.test.ts`: **real SDK** + capturing transport ⇒ the envelope has no email, hash, token or IP. `sentry-leak.int.ts`: **real P2039 from Postgres** through the SDK. Mutation: identity `beforeSend` ⇒ 3 tests fail. |
| 2 | Sentry web | `@sentry/nextjs` 11.7.0. Events go through the same-origin tunnel `/monitoring`, so the **CSP is unchanged** (checked on the prod build). DSN, environment and release reach the browser through `<meta>` tags (read before hydration; AppProviders not touched). The tunnel returns 404 without a DSN and 403 for a foreign DSN; 413 above 200 kB. `zod-jitless` is now its own module, imported first (E's note). Server side: `instrumentation.ts` + `onRequestError`. | `sentry.test.ts` (web): tunnel and route, meta, `beforeSend`, **real browser SDK** (no email or page query in the envelope). `instrumentation-client.test.ts` still passes. |
| 3 | Metrics | `prom-client` 15.1.3. `/metrics` is served by a **separate server** on `METRICS_PORT` (9464; 0 = OS-chosen), with Bearer `METRICS_TOKEN` when set. The `route` label is a **template** (`createApp` records mount patterns; no match ⇒ `unmatched`). Metrics: `http_request_duration_seconds`, `http_errors_total{code}`, `db_pool_*`, `socketio_connected_clients`, `scheduled_job_*` (the `recordJobRun` API for T-033), and default process metrics. | `metrics.test.ts`: labels never contain an id or query; 401 without token, 404 for other paths. Smoke test of the build: the public port returns 404 for `/metrics`. |
| 4 | Email alerts | `docs/runbook/alerts.md`: step by step for the owner (2 Sentry projects, Sentry-side scrubbers, new/spike/regression alerts, spike protection, uptime monitor, checks after setup, what to do on an alert email). | n/a |
| 5 | Missing DSN | `SENTRY_DSN` is optional. In staging/production a missing DSN logs the warning `observability.sentry_disabled_missing_dsn` and **does not block startup**. `.env.example` (api + web) updated. | `env.test.ts` |

## Decisions I made (please review)

- **Sentry 11 removed `sendDefaultPii`** and replaced it with `dataCollection`, which **by default collects** user info, cookies, headers, bodies and query params. I turned every category off at the source (layer 1), with the allow-list `beforeSend` as layer 2.
- **Sentry's own `OnUncaughtException`/`OnUnhandledRejection` integrations are off.** Graceful shutdown already handles those cases and reports through `onFatal`, so two handlers don't compete over exiting the process. `LocalVariables`, `ContextLines`, `Modules`, `ChildProcess`, `FileSystem` and `Spotlight` are also off.
- **ESM tracing:** `main.ts` initializes Sentry and then dynamically imports `start-server.ts`. This avoids changing the start command or D's Dockerfile (`--import`). tsdown builds `main.js` plus a `start-server-*.js` chunk; the smoke run of `dist` passes.
- **Uptime monitor:** the ticket asks for `/readyz`, but T-031 (M2, merged) recommends blocking `/readyz` from the Internet, and it is limited to 60 requests per minute per IP. The runbook recommends that the external monitor watch `/healthz` while the platform's health check uses `/readyz` internally. A `/readyz` monitor is allowed only with an IP allow-list. **Tech Lead: please confirm.**
- **No `withSentryConfig` / source-map upload:** that needs an auth token in CI (D, Phase 5). Stack traces are therefore minified for now.

## Files outside the main scope (reported)

- `apps/web/app/monitoring/route.ts`, `app/layout.tsx`, `tsconfig.json` (adds `instrumentation.ts`) — E was told beforehand and agreed with the approach. The `fetch` in the tunnel route carries an `eslint-disable` with the reason: it's a server route forwarding to Sentry, not a call to the app's API.
- `composition/container.ts` (passes metrics and reporter through).
- `test/support/env.ts`: `METRICS_PORT=0` for tests.
- `test/security/harness/api-process.ts` (F): `METRICS_PORT=0`, so parallel API processes don't collide on 9464.

## Remaining risks and notes

- `@sentry/node` 11 pulls in `@sentry/bundler-plugins` as a dependency, which has a peer `@babel/core@^7` while the repo has 8. It's unused at runtime (only for source-map upload), so it's only a peer warning.
- The web `/api/healthz` route still returns `gitSha` (T-031 only removed it from the API) — E's area, I didn't touch it.
- F: please run **SEC-48 (CSP) on the prod build** with `SENTRY_DSN` set, to confirm there's no CSP violation when Sentry initializes.

## DoD

See the DONE message (exit codes after rebasing onto main).
