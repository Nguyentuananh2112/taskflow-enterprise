# T-031: hardening of core/http, config and logging (T-028 findings)

Branch `feat/T-031`. Item 0 has already been merged (main 4c7efdf); this report covers items 1–9 plus the `JWT_ACCESS_TTL_SECONDS` variable the Tech Lead added to the ticket.

## Done

| # | Finding | Change | Main test(s) |
|---|---|---|---|
| 0 | HIGH: email and password hash leaking into logs | Allow-list error serializer (merged) | `error-leak.int.ts` (real Postgres) |
| 1 | M4 / ADR-108 | `loginIp` (20 per 15 min) runs **before** validation. The email limiters run **after** validation and count only 401: (IP, emailHash) 10 per 15 min, and email 100 per hour. 400 and 429 responses are not counted, so a lock can't be extended forever. | `auth.http.test.ts`: the 11th wrong attempt gets 429 while the owner can still log in from their own IP; 10 IPs × 9 wrong attempts ⇒ the owner can still log in, and at 100 ⇒ 429; 15 malformed bodies are not counted. |
| 2 | L2 | The change-password limiter is `failMode: 'closed'`. | `rate-limit.test.ts` (rule table) |
| 3 | M2 | `/readyz` shares one probe run per second, including requests still in flight. The shutdown flag is always read fresh. Limit of 60 per minute per IP, counted in memory ⇒ 429 + `Retry-After`. `devops.md` §6.2 recommends restricting `/readyz` at the edge. | `app.test.ts`: 5 concurrent requests trigger 1 probe run and the next second triggers a 2nd; the 61st request gets 429; the shutdown flag is not cached. |
| 4 | L1 | `APP_ENV` staging/production ⇒ `NODE_ENV=production` is required and every production check runs, based on `APP_ENV`. `appConfigFromEnv` derives `production`/`hsts` from `APP_ENV`. An empty `TRUST_PROXY_HOPS` is no longer coerced to 0 (range 0–10). | `env.test.ts` |
| 5 | L3 | Library errors with a 4xx `status`/`statusCode` (router URIError, body-parser `request.aborted` / `request.size.invalid`) map to 400/413/415 and are logged at **warn** as `http.client_error`. | `hardening-t031.test.ts`; `app.test.ts` (`%E0%A4%A` ⇒ 400, no error-level log) |
| 6 | L4 | `Cache-Control: no-store` by default for all of `/api/v1`. | `app.test.ts` (200, 409, 404) |
| 7 | L5 | The access log records `req.path` and never the query string. | `app.test.ts` (`?q=mia@example.com` appears in no log line) |
| 8 | M3 (logger part) | The request context carries the `ip` (after trust proxy). A pino mixin adds **`reqId` + `ip`** to every log line inside a request: the access log, `req.log`, and the root logger used by use cases. The access log also adds `userId`. | `app.test.ts` |
| 9 | Info | `/healthz` no longer exposes `gitSha` (it appears in every log line). Valkey hang detection uses `socketTimeout` 3 s + `pingInterval` 1 s. | `app.test.ts`; `infrastructure.test.ts` (muting proxy to real Valkey: an idle connection stays alive, a hang makes the command fail in < 4 s, and the client recovers afterwards) |
| + | Tech Lead request (E2E-11) | `JWT_ACCESS_TTL_SECONDS`: allowed **only** when `APP_ENV=test`, 5–900 s. Any other `APP_ENV` with the variable set refuses to start. A missing value means 900 s. | `env.test.ts` (both branches); `auth.http.test.ts` (exp − iat = 5) |
| + | B's suggestion | `pagination.ts`: the cursor's `after` must be a uuid ⇒ otherwise 400 `invalid_cursor`. | `hardening-t031.test.ts` |

## Technical findings

- **node-redis 6.3 `commandOptions.timeout` / `withCommandOptions({ timeout })` does not fire** for a command already written to the socket (checked against a muting proxy: it hung for over 3 s). It is therefore not a per-command timeout for a hung server. `socketTimeout` combined with `pingInterval` does work. The connections duplicated for the socket.io adapter inherit both settings.
- pino-http calls `customProps` again when the response finishes, which is why `userId` (set by `authenticate`) shows up in the access log.
- `reqId`/`ip` come only from the mixin, not from `customProps`, so the access log has no duplicate keys.

## Files outside `core/**` / `config/**` / `app.ts` (reported)

- `modules/auth/presentation/auth.routes.ts` (B): order of the login limiters (ADR-108).
- `modules/auth/auth.module.ts` (B): `jwt.ttlSeconds`.
- `composition/container.ts`, `main.ts`: pass the TTL through.
- `test/security/transport.sec.ts` (F): `/healthz` keys are now `['status']`.
- `test/integration/startup/task-prisma-startup.int.ts` (C): staging boots with `productionEnvVars`, because staging with `NODE_ENV=test` is now refused (the very hole L1 closes). Note: feat/T-024 also edits a comment in this file, so there may be a small conflict at merge time.

## For the Tech Lead / F

- `security.md` §6.4 (rate limit table) and SEC-28 in the test spec still say "5/15 min, 50/hour, 6th attempt ⇒ 429". They should be updated to ADR-108 (10/15 min per (IP, email), 100/hour per email, 401 only).
- F's security suite: check `SEC-28` and the `/readyz` limit (60 per minute per IP) if a scenario hits `/readyz` many times.

## DoD

See the DONE message (exit codes after rebasing onto main).
