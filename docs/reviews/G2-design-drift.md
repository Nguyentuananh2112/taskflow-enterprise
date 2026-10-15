# G2: Check of `docs/design/*` against current code (drift)

Reader: A. Base: main `679a131`. Only **verified** drift is listed, each with a doc location, a code location and a suggested fix. The fix goes to the document's owner — G2 does not edit design docs directly.

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

<!-- Các mục do agent quét sẽ được bổ sung dưới đây sau khi xác minh lại. -->
