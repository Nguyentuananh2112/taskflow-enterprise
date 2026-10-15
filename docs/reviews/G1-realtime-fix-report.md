# G1 realtime — fixes for B's findings (M1, M2, L1–L3, Info)

Branch `fix/realtime-g1`. Source: B's cross-read of realtime (main @ 679a131), sent as a message to A, cc TL. No High findings. B handles the auth/workspace side (disconnect before `setTokenVersion`, revoke order in remove-member, `projectIds` without a lock) in their own module.

| # | Fix | Test (`core/realtime/gateway.test.ts`) |
|---|---|---|
| **M1** — handshake ‖ revocation | `#onConnection` registers the handlers synchronously, joins `user:` / `session:` FIRST, then runs `authenticator.authenticate(handshake token)` **again**. Failure or unexpected error ⇒ `disconnect(true)` (fail-closed, logs `realtime.handshake_recheck_failed` for non-`AppError`). `project:join` **waits** for this result (`verified`), so a socket whose session was revoked mid-handshake never gets checked into a project room. A revoke that commits after the re-auth sees the socket in its rooms. | Revoke (`disconnectUser`) during handshake auth + re-auth held open: `project:join` does no access check while waiting; after release ⇒ `io server disconnect`, no access check, 0 sockets. Unexpected error on re-auth ⇒ disconnect + log. |
| **M2** — one user can starve the DB pool | (a) `MAX_SOCKETS_PER_USER = 20` per instance (local count of room `user:{id}`) ⇒ handshake `RATE_LIMITED` + warn `realtime.socket_cap_reached`. (b) `PROJECT_JOIN_LIMIT_PER_USER = 60/min` shared by all of the user's sockets on the instance (on top of 30/min/socket). | 21st socket rejected, other user unaffected, closing a socket frees a slot. 3 sockets × 21 joins ⇒ exactly 3 `RATE_LIMITED` past 60; another user unaffected. |
| **L1** — room cap exceeded by concurrent joins | `pendingJoins` reserves the slot **synchronously** before the first `await`; cap counts real rooms + pending reservations. | 25 parallel joins (checker yields) ⇒ exactly 20 ok, 5 `BUSINESS_RULE_VIOLATION`, 20 project rooms. |
| **L2** — renew with a different sid ‖ `disconnectSession(new sid)` | After swapping to `session:{new sid}`, authenticate the renew token **again**; failure ⇒ `UNAUTHORIZED` + disconnect. | `disconnectSession(s2)` misses during the renew auth; re-auth fails ⇒ `UNAUTHORIZED`, disconnected, authenticated twice. |
| **L3** — `recheckRooms` fail-open | Recheck error ⇒ ack `SERVICE_UNAVAILABLE` + **disconnect** (log `realtime.recheck_failed_disconnect`). Not a silent room leave: the web client doesn't know about a silent leave and would sit on a board with dead realtime. On `io server disconnect` it already refreshes, reconnects, re-joins and refetches the board (`socket-io-client.ts`, `use-board-realtime.ts`). | Old test "keep room" replaced: ack `SERVICE_UNAVAILABLE`, `io server disconnect`, warn. |
| Info — stray timer on a late renew | `auth:renew` returns without scheduling the expiry timer if the socket disconnected while authenticating. | — (no observable effect; a code-path guard). |

**Mutation check:** I ran the 7 new or changed tests against the old `gateway.ts`, `socket-handlers.ts` and `rules.ts` ⇒ **all 7 red**. With the fix they pass: 43/43.

## Decisions / still open

- **Cost:** one extra `authenticate()` per connection (M1), plus one per renew that changes sid (L2). Normal renews (same sid) cost nothing extra. Measure under the k6 run (A3).
- **Socket cap and join budget are per instance** (in memory), like `renewsByUser`. With N instances the per-user ceiling is N×. Moving `renewsByUser`, the join budget and a socket counter into Valkey (`IHitLimiter`, fail mode to decide) is **not done here**: it needs a decision on fail-open/closed when Valkey is down, which is the same question as the handshake limiter's `failMode: 'open'`. Proposed as a follow-up when we run >1 instance (ADR-027).
- Handshakes running in parallel can let a few sockets past the cap (counted at handshake; the room join comes later). Accepted: it's a bound on abuse, not a quota.
- `docs/design/security.md` §5 / §6.4 should list the two new limits (20 sockets/user/instance, 60 joins/min/user). Doc owner to update, together with the G2 rate-limit rows.

## DoD

`pnpm verify`: lint 0, typecheck 0, test 0, audit 0. `test/security/realtime.sec.ts`: 8 passed (8 todo), exit 0. LSP `task.task-realtime` integration on my own DB `taskflow_t036`: 4/4, exit 0.
