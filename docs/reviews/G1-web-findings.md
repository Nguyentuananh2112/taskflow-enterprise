# G1: Cross-read of the web code (session, realtime, error handling)

Reader: A. Owner: E. Base: main `679a131`. Read in full:
- `shared/api/http.ts`, `single-flight.ts`;
- `entities/session/model/{session,refresh,token-store}.ts`;
- `features/board-realtime/model/*`, `features/task-move/model/use-move-task.ts`, `features/task-edit/model/use-update-task.ts`;
- `features/realtime-session/model/use-realtime-session.ts`, `shared/socket/socket-io-client.ts`, `app/providers/realtime-provider.tsx`.

## Findings

### W1 (Low): a refresh in flight during logout puts a token back into memory after the session has ended (confirms L13 from T-028)

`session.ts` `renew()`:

```ts
const token = await refresher.run();
if (token) tokenStore.set(token);
```

The token is set **unconditionally** after the `await`. Two ways to trigger it:
- this tab is refreshing when the user clicks "Đăng xuất" (`logout()` ⇒ `end()` clears the token, then the refresh response arrives);
- another tab logs out ⇒ `onChannel('logout')` ⇒ `end()` while this tab's refresh is in flight.

Result: `sessionStore` is `anonymous` but `tokenStore` holds a token. `onTokenRenewed` fires, and later HTTP requests (if any) carry that token.

Impact: **low**. The server is safe because logout revokes the family plus `sid` (ADR-105), so the token is rejected, and the realtime client is already `OFFLINE` when anonymous. But client state is inconsistent, which goes against "the access token only lives while the session is alive" (W-TOKEN-1).

Suggested fix — a session generation counter:

```ts
let generation = 0;           // tăng trong end()
async function renew() {
  const started = generation;
  const token = await refresher.run();
  if (started !== generation) return false;   // phiên đã kết thúc trong lúc chờ — bỏ token
  if (token) tokenStore.set(token);
  return token !== null;
}
```

Test: with a slow `api.refresh` mock, `renew()` and then `end('logout')` ⇒ once the refresh resolves, `tokenStore.get() === null`.

### W2 (Info): the comment in `realtime-provider.tsx` is no longer accurate after T-030

> `// ack.ok=false ⇒ server tự ngắt ⇒ nhánh disconnect của client refresh + nối lại.`

Since T-030, `auth:renew` is rate limited (5 per minute per socket, 30 per user) and replies `RATE_LIMITED` **without disconnecting**. The socket keeps the old token until its `exp`, when the server's timer sends `auth:expired` and disconnects, and the client's disconnect branch recovers. It self-heals, so no fix is needed, but the comment should say that `RATE_LIMITED` doesn't disconnect.

### W3 (Info): the cookie-path comment in `http.ts` is out of date

> `// Cookie refresh chỉ sống ở Path=/api/v1/auth (security.md §2.3).`

ADR-109 changed it to `__Host-tf_rt; Path=/` in staging/production. Behaviour is still correct (`credentials: 'include'` only for `/auth/*`); only the comment needs updating.

## Checked and OK (no issue)

- **Refresh:**
  - single-flight within a tab + Web Locks across tabs;
  - `409 REFRESH_IN_PROGRESS` ⇒ wait 300 ms and retry exactly once;
  - `REFRESH_TOKEN_INVALID` / `ORIGIN_NOT_ALLOWED` ⇒ `null` (session gone); network / 5xx errors are thrown (session kept).
- **HTTP:**
  - only `TOKEN_EXPIRED` triggers a refresh, with one retry;
  - if another request already refreshed (`current !== sentToken`), the new token is reused;
  - `UNAUTHORIZED` with a token ⇒ `revoked`;
  - network errors don't push the user to `/login`;
  - POST/PATCH always send `Content-Type` (T-029 H2);
  - a bad envelope ⇒ `badResponse`, unknown error codes ⇒ `unknown` (ADR-102).
- **Logout:**
  - not swallowed when the server hasn't confirmed (`logoutPending`, retry);
  - `bootstrap` doesn't silently log back in during `logoutPending`;
  - `logoutAll` keeps the session when the request fails.
- **Realtime merge (pure function):**
  - deduplication by `eventId` (LRU 500);
  - the tab's own events are skipped;
  - tombstones prevent a deleted task coming back;
  - only newer versions are accepted;
  - reconnect ⇒ one refetch.
- **Mutations:**
  - `mergeIfNewer` on success, so a REST response arriving after a newer realtime event doesn't overwrite it;
  - the optimistic move keeps the **old** version (a newer event from someone else wins);
  - the 409 auto-resend in move happens only when status and rank are unchanged;
  - edit uses a 3-way rebase, and `scope: task:<id>` serialises consecutive saves.
- **Socket:**
  - token passed in the `auth` callback (fresh token on every reconnect);
  - `connect_error TOKEN_EXPIRED` ⇒ refresh then connect; `UNAUTHORIZED` ⇒ end the session;
  - `io server disconnect` ⇒ refresh (logout-all from another device ⇒ refresh fails ⇒ session ends correctly; password change on this device ⇒ new cookie ⇒ reconnects).
