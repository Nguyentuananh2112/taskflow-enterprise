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

<!-- Các mục do agent quét sẽ được bổ sung dưới đây sau khi xác minh lại. -->
