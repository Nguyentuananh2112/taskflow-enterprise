# T-030: realtime survives a Valkey outage (audit T-028: H3 + Medium `auth:renew`)

Branch `fix/T-030-realtime-resilience`, from main 99e9041.

## H3: process crash and lost revocations when `SOCKET_REDIS_ADAPTER=true`

**Cause (checked against `@socket.io/redis-adapter` 8.3.0, `dist/index.js`):**
- `broadcast` (~473), `delSockets` (~613), `disconnectSockets` (~629) and `publishResponse` call `pubClient.publish(...)` without `await`/`catch`.
- The client is duplicated from `createValkeyClient`, so it inherits `disableOfflineQueue: true`. While Valkey is down, `publish` rejects immediately ("The client is offline"). That is an `unhandledRejection`, and graceful shutdown then exits with code 1.
- A cluster-wide `delSockets`/`disconnectSockets` only publishes. The emitting instance applies it when its own request comes back over Valkey (`onrequest`, `REMOTE_LEAVE`/`REMOTE_DISCONNECT`). If the publish fails, **no instance revokes anything, including the current one**.

**Fix:**

| File | Change |
|---|---|
| `core/realtime/redis-adapter.ts` | `guardPublisher(pub, logger)`: a Proxy that wraps only `publish`. A failure (reject or synchronous throw) is logged as `realtime.adapter_publish_failed`, at most once every 30 s, and resolves to `0`. Other methods are bound to the real client, because node-redis uses `#private` fields. `createValkeyAdapter` also takes an optional `{ key }` (channel prefix) so tests stay isolated. |
| `core/realtime/gateway.ts` | `disconnectSession`, `disconnectUser`, `revokeWorkspaceAccess` and `closeWorkspace` now run the operation on `io.local` first, then cluster-wide. Running it again when the message comes back is harmless. |

**Remaining limitation:** while Valkey is down, other instances do not receive the revocation. Their safety net is the existing `auth:renew` membership re-check (about every 15 minutes) plus token expiry.

## Medium: `auth:renew` was not rate-limited

Each renew verifies the token and re-checks membership for every joined room, up to about 20 DB queries.
- `AUTH_RENEW_LIMIT` (`core/http/rate-limit/rules.ts`) allows **5 per minute per socket** and **30 per minute per user**, counted across all of that user's sockets on the instance.
- Counting uses an in-memory sliding window (`core/realtime/sliding-window.ts`), which periodically drops expired keys.
- Over the limit, the ack is `RATE_LIMITED`. No DB call is made and the socket stays connected. If the token expires, the existing timer still disconnects it.

Note: `security.md` §5.3 does not yet mention this limit. That document belongs to the Tech Lead.

## Tests

- **`gateway.test.ts`:**
  - A "lossy" adapter drops cluster operations that lack the `local` flag, as the redis adapter does when publish fails. With it, `revokeWorkspaceAccess`, `disconnectSession`, `disconnectUser` and `closeWorkspace` still take effect on this instance.
  - The renew limits per socket (5, then OK again after the window) and per user (7 sockets × 5 gives 30 OK and 5 `RATE_LIMITED`; another user is unaffected).
- **`redis-adapter.test.ts`:** `guardPublisher` with reject, throw and success, log throttling, and methods using `#private` fields.
- **`sliding-window.test.ts`.**
- **`redis-adapter-outage.integration.test.ts` (tier I, real Valkey):**
  - The adapter connects to Valkey through this test's **own TCP proxy**. The test cuts the proxy, so the shared Valkey is never stopped, and it uses its own channel key.
  - After the cut: removing a member pushes the socket out of the project room, logout-all disconnects the socket, and emitting an event only logs. There is **no unhandledRejection** and the process keeps running.
- **Mutation checks:**
  - Removing the `io.local` lines makes the H3 test fail.
  - Bypassing `guardPublisher` makes the integration test fail with 4 unhandled "The client is offline" rejections.

## DoD (exit codes)

`pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test -- --maxWorkers=2` 0 (112 files, 1156 tests) · adapter integration tests with `REQUIRE_INTEGRATION=1` 0 (6 tests).
