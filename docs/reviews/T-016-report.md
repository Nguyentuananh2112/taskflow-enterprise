# T-016 Report — Hạ tầng realtime (Socket.io gateway) + rate limiting

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Branch `feat/T-016` (worktree `D:\TaskFlow_wt\T-016`)

## Kết quả Definition of Done (Windows 11, Node 24.18, pnpm 11.28.2, Valkey 9.1.2 thật ở 127.0.0.1:6380)

```text
$ pnpm typecheck      config · contracts · api · web: Done                    [exit 0]
$ pnpm lint           prettier ✔ · eslint 0 lỗi
  apps/api lint:deps: ✔ no dependency violations found (128 modules, 388 dependencies cruised)
  apps/web lint:deps: ✔ no dependency violations found                       [exit 0]
$ pnpm test           Test Files 40 passed (40) · Tests 446 passed (446)        [exit 0]
$ pnpm build          api: tsdown ✔ · web: next build ✔                        [exit 0]
$ pnpm --filter @taskflow/api test:coverage
  All files               Stmts 98.25 | Branch 94.26 | Funcs 97.60 | Lines 98.93
  src/core/realtime       Stmts 99.35 | Branch 95.45 | Funcs 97.29 | Lines 100.00
  src/core/http/rate-limit Stmts 96.47 | Branch 91.42 | Funcs 96.00 | Lines 96.20  [exit 0 — ≥ 90%]
```
(Số trên là trước rebase; sau rebase: 50 file / 556 test — xem mục "Rebase".)

**Chạy thật `tsx src/main.ts`** (Valkey thật, không DB):
- `GET /api/v1/x` → header `RateLimit: "api-ip"; r=98; t=49` + `RateLimit-Policy: "api-ip"; q=100; w=60` (đếm trên Valkey).
- Socket `Origin: http://localhost:3001` → qua `allowRequest`, tới bước xác thực ⇒ `connect_error SERVICE_UNAVAILABLE` (đúng: authenticator chưa wire — Phase 3). `Origin` lạ / thiếu ⇒ bị chặn ở HTTP trước khi nâng cấp websocket. Thử ngay lúc khởi động (trước `valkey.ready`) cũng đúng; không có unhandledRejection.
- Lần chạy smoke đầu tiên (cổng 4125) curl treo và socket báo `websocket error`; **không tái hiện** trong 3 lần chạy mới (4126–4128) — ghi nhận, không kết luận nguyên nhân.

## Yêu cầu bắt buộc của ticket → bằng chứng

| Yêu cầu | Test |
|---|---|
| **SEC-56**: Origin lạ / thiếu Origin / transport `polling` (token hợp lệ) bị từ chối | `core/realtime/gateway.test.ts` "SEC-56" ×3 — khẳng định authenticator **không** được gọi (chặn trước xác thực) |
| Handshake token hết hạn / sai bị từ chối | `test/integration/realtime-auth.test.ts` với `AccessTokenAuthenticator` + JWT jose **thật** của auth: hết hạn ⇒ `TOKEN_EXPIRED`; ký bằng secret khác ⇒ `UNAUTHORIZED`; `tv` cũ (logout-all) ⇒ `UNAUTHORIZED`; sid bị thu hồi ⇒ `UNAUTHORIZED` (SEC-35) |
| **Login fail-closed khi Valkey chết** | `rate-limit/valkey.integration.test.ts`: store trỏ vào Valkey chết ⇒ `503 SERVICE_UNAVAILABLE`, handler không chạy; `rate-limit.test.ts`: cả 3 rule login + register + refresh `failMode: closed`, mọi rule còn lại `open` |
| Coverage `core/realtime` + rate-limit ≥ 90% | xem bảng trên |

## Đã làm

| Mục | File | Ghi chú |
|---|---|---|
| 1. Gateway | `core/realtime/gateway.ts`, `events.ts`, `ports.ts` | `transports: ['websocket']`, `allowUpgrades: false`, `maxHttpBufferSize` 100 000; `allowRequest`: Origin ∈ `CORS_ORIGINS` (so khớp chính xác) → rate limit handshake 20/phút/IP (IP thật theo `TRUST_PROXY_HOPS`, IPv6 /56); `io.use` xác thực `handshake.auth.token` qua port `ISocketAuthenticator`; lỗi ⇒ `connect_error` với `err.data.code` (`TOKEN_EXPIRED`/`UNAUTHORIZED`/`SERVICE_UNAVAILABLE`); tự join `user:{id}`, `session:{sid}`; `clientId` không phải uuid ⇒ `null` (security §5.2). Vỏ event chung `{eventId (uuid v7), type, occurredAt, actorId, originClientId, data}` theo contract T-010. |
| 2. `IAuthRealtimeNotifier` | `gateway.ts` | `disconnectSession(sid)`, `disconnectUser(userId)` (dùng `io.in(room).disconnectSockets` — xuyên node). **Đặt ở `core/realtime`** (không ở `modules/auth/infrastructure/realtime`): gateway là hạ tầng dùng chung cho auth + workspace + task; khớp port của auth theo cấu trúc (core không được import module). Port Workspace (T-015, B định nghĩa): `revokeWorkspaceAccess`, `notifyRoleChanged`, `closeWorkspace`; Task (Phase 3): `emitToProject`. |
| 3. `project:join` | `socket-handlers.ts` | Zod payload; `IProjectAccessChecker.canAccessProject({userId, workspaceId, projectId})` (B hiện thực); ack `{ok:true}` / `{ok:false, code}`: `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND` (không thành viên/sai ws — SEC-36), `RATE_LIMITED` (30/phút/socket), `BUSINESS_RULE_VIOLATION` (>20 phòng), `SERVICE_UNAVAILABLE` (checker lỗi). `project:leave`. Event thiếu ack bị bỏ qua. |
| 3. `auth:renew` / hết hạn | `socket-handlers.ts` | Timer theo `exp`: hết hạn ⇒ `auth:expired` rồi ngắt (SEC-38). Renew: xác thực đầy đủ, `sub` khác ⇒ ack `UNAUTHORIZED` + ngắt (SEC-39); đổi `sid` ⇒ đổi phòng session; **kiểm lại membership mọi phòng** (mất quyền ⇒ rời; checker lỗi ⇒ giữ phòng + log). |
| 4. Graceful shutdown | `main.ts` (realtime closer), test `core/lifecycle/realtime-shutdown.test.ts` | Thứ tự: `server.close` → `gateway.close()` (`io.local.disconnectSockets(true)` — chỉ socket của instance này + `engine.close()`) → chờ HTTP → adapter → pool → Valkey; thoát 0 < 2s với socket đang mở. |
| 5. Redis adapter | `core/realtime/redis-adapter.ts` | `@socket.io/redis-adapter` 8.3 trên Valkey (2 kết nối `duplicate()`), chỉ bật khi `SOCKET_REDIS_ADAPTER=true` (đã có trong env T-009, mặc định false). **Test thật 2 instance**: phát ở A ⇒ client ở B nhận; `disconnectUser` ở A ngắt socket ở B (devops §7.2). |
| 6. Rate limit | `core/http/rate-limit/{rules,rate-limit,store}.ts` | Bảng `RATE_LIMIT_RULES` đúng security §6.4 (login 3 lớp: 5 sai/15' theo IP+email băm, 20/15' theo IP, 50 sai/giờ theo email băm; register 5/giờ; refresh 60/5'; …; mặc định 300/phút/user, 100/phút/IP; handshake 20/phút). express-rate-limit 8 (`standardHeaders: 'draft-8'`), store rate-limit-redis 6 trên Valkey, khóa `rl:{rule}:{key}`, email SHA-256, `ipKeyGenerator` /56. Vượt ngưỡng ⇒ `429 RATE_LIMITED` + `Retry-After` qua error handler chung. `createGlobalRateLimit` gắn ở `app.ts` (request chưa xác thực). |
| 7. Test | 7 file mới | Socket.io client thật in-process; Valkey thật 6380 cho tầng I (`TEST_VALKEY_URL`; `REQUIRE_INTEGRATION=1` ⇒ thiếu Valkey là FAIL — dùng cho CI của D). Khóa Valkey của test có tiền tố ngẫu nhiên mỗi lần chạy và được xóa sau test. |

## Lỗi thật phát hiện

- **rate-limit-redis 6 không tự hồi phục**: `init()` giữ promise `SCRIPT LOAD`; nếu Valkey sập lúc khởi động, promise bị reject vĩnh viễn ⇒ limiter lỗi mãi kể cả khi Valkey sống lại (chỉ nạp lại khi gặp `NOSCRIPT`), và promise reject không ai await ⇒ unhandledRejection ⇒ (T-009) tắt tiến trình. Sửa bằng `ResilientRedisStore`: đánh dấu script "stale" khi lỗi và nạp lại ở **lần gọi kế tiếp** (bản sửa đầu tiên nạp lại ngay lúc lỗi — test hồi phục bắt được là vẫn hỏng thêm 1 request vì Valkey vẫn đang sập). Có test tầng I "Valkey sập lúc khởi động rồi hồi phục".
- Fail mode được xử lý trong `FailModeStore` (không dùng `passOnStoreError` của thư viện — thư viện log bằng `console` và không phân biệt rule).

## Phối hợp

- **B (T-015)**: chốt chữ ký `IProjectAccessChecker` + port realtime của Workspace; thêm `meta: { actorId, originClientId? }` (contract T-010 bắt buộc `actorId` cho mọi event); `closeWorkspace` có `memberUserIds` (data-and-api §1.7 — báo cả thành viên không ở phòng project); áp **quy tắc tham số có tên** của Tech Lead cho mọi method ≥ 2 tham số cùng kiểu (kể cả `emitToProject({ projectId, type, data }, meta)`).
- **Cherry-pick** `774ba4b` của B (`exp` trong `AuthenticatedUser`) theo chỉ đạo Tech Lead → commit `98a5fad` trên branch này.

## Sửa ngoài phạm vi sở hữu

| File | Lý do |
|---|---|
| `pnpm-workspace.yaml`, `apps/api/package.json`, `pnpm-lock.yaml` | Thêm `socket.io`, `socket.io-client` (dev), `@socket.io/redis-adapter`, `express-rate-limit`, `rate-limit-redis` (TEAM.md luật 3). |
| `apps/api/src/app.ts` | Thay `TODO(Phase 2, B)` bằng slot `rateLimit?: RequestHandler[]` (sau body parser, trước route). |
| `apps/api/src/main.ts` | Wire gateway, adapter, rate limit, closer realtime. |
| `apps/api/test/support/realtime.ts`, `test/integration/realtime-auth.test.ts` | Helper/test (test/ không thuộc depcruise `src`). |
| `modules/auth/application/access-token-authenticator(.test).ts` | Chỉ qua cherry-pick commit của B. |

## Quyết định tự đưa ra (có thể bác)

1. **Socket chưa nhận kết nối thật cho tới Phase 3**: `main.ts` gắn gateway với 2 port tạm trả `SERVICE_UNAVAILABLE` (auth production cần repository Prisma). Wire thật = 1 dòng: `authenticator: socketAuthenticatorFrom(new AccessTokenAuthenticator(...))`, `accessChecker: <WorkspaceAccessChecker>` — `TODO(Phase 3, B)` trong `main.ts`.
2. Rate limit toàn cục chỉ áp request **không có** `Authorization` (100/phút/IP); route đã xác thực phải gắn `createRateLimit(RATE_LIMIT_RULES.authenticated[0], …)` **sau** `authenticate` (đếm theo user — không phạt cả văn phòng chung IP NAT). B cần làm ở Phase 3.
3. `project:join` rate limit + giới hạn 20 phòng đếm **trong bộ nhớ của socket** (trạng thái gắn với kết nối, mất khi ngắt — đúng ngữ nghĩa "mỗi socket"); handshake đếm trên Valkey (theo IP, xuyên instance).
4. Ack code ngoài danh sách contract: `RATE_LIMITED`, `BUSINESS_RULE_VIOLATION` (vượt 20 phòng), `SERVICE_UNAVAILABLE` (checker lỗi) — đều nằm trong `ErrorCode`, hợp lệ với `SocketAck` của T-010.
5. Handshake rate limit **fail-open** (Valkey chết vẫn cho kết nối; xác thực vẫn chạy) — security §6.4 chỉ yêu cầu fail-closed cho login/register (+refresh theo ticket).

## Rủi ro / việc để lại

- Phase 3: wire authenticator/checker thật; gắn rule rate limit theo route (login/register/refresh/… — bảng đã sẵn); listener realtime của Task dùng `emitToProject`.
- `io.local.disconnectSockets` khi bật adapter — devops §7.3 ghi "⚠ KIỂM CHỨNG Phase 3": đã chạy trong test shutdown (không bật adapter) và test adapter riêng; tổ hợp hai thứ cùng lúc chưa test.
- `TRUST_PROXY_HOPS` phải đúng ở mỗi môi trường — handshake limiter tự tính IP theo cùng quy tắc với Express.

## Rebase

Rebase lên `main` @ 4e186ac (đã có T-010 contracts + Prisma, T-015/T-018 tickets). Xung đột catalog/`package.json` với T-010 giải bằng hợp (lockfile tạo lại). Sau rebase:
- `core/realtime/events.ts` **dùng schema của contracts** (`ProjectJoinPayload`, `ProjectLeavePayload`, `AuthRenewPayload`, `SocketAck`) thay bản khai tạm — bỏ `TODO(T-010 merge)`.
- DoD chạy lại: install --frozen-lockfile / typecheck / lint (api 146 module, 0 vi phạm) / **test 50 file, 556 test** / build — tất cả exit 0; coverage không đổi (realtime 99.35/95.45, rate-limit 96.47/91.42).

## Rev2 — sửa theo review Tech Lead + QA F

### 1. [MEDIUM] Token rác né giới hạn IP
Trước: `createGlobalRateLimit` bỏ qua mọi request có `Authorization` ⇒ `Bearer garbage` không bị đếm ở đâu.
Sau (`core/http/rate-limit/rate-limit.ts`, `rules.ts`) — **mọi request đều qua ít nhất một bucket IP**:

| Request | Bucket | Lý do con số |
|---|---|---|
| không có `Authorization` | `api-ip` 100/phút/IP | security §6.4 |
| có `Authorization` (thật hay rác) | `api-bearer-ip` **1000**/phút/IP | trần thô chống xoay token; giới hạn chính vẫn 300/phút/**user** sau `authenticate`. 1000 ≈ 3 người dùng chạm trần user cùng lúc — văn phòng NAT vài chục người dùng thực tế (≪ 300/phút/người) không chạm tới |
| có `Authorization`, phản hồi **401** | `api-auth-fail-ip` **30**/phút/IP, chỉ đếm 401 (`countOnlyStatuses`) | hết lượt ⇒ 429 **trước** `authenticate` (không tốn CPU verify/log). `TOKEN_EXPIRED` cũng là 401: dùng bình thường ≤ 1 lần/15 phút/người ⇒ xa ngưỡng; 403/404/422 không bị tính |

Test (`rate-limit.test.ts`): `Authorization: Bearer garbage` ⇒ 401 ×N rồi **429**; IP đó đổi token rác khác vẫn 429; IP khác không ảnh hưởng; 200/403 không bị đếm vào bucket 401; token hợp lệ vẫn chịu trần 1000; bảng mặc định 100/1000/30.

### 2. [LOW] TOCTOU ở `project:join`
Sau `socket.join` **kiểm lại quyền một lần**; mất quyền ⇒ `leave` + ack `RESOURCE_NOT_FOUND`; kiểm lại lỗi ⇒ fail-closed (rời phòng, log `realtime.project_join_recheck_failed`). Lập luận: thu hồi commit trước lần kiểm 2 ⇒ lần kiểm 2 thấy (DB đã commit); thu hồi commit sau lần kiểm 2 ⇒ `socketsLeave` của nó chạy sau `join` ⇒ tự gỡ.
Test mô phỏng xen kẽ: fake checker có hook `interleave` chạy **giữa** lần kiểm 1 và `join` (thu hồi trong "DB" + gọi `gateway.revokeWorkspaceAccess` như afterCommit) ⇒ ack `RESOURCE_NOT_FOUND`, socket không ở phòng, không nhận event. **Kiểm tra đột biến**: bỏ lần kiểm lại ⇒ 2 test TOCTOU đỏ.
Kèm theo: giới hạn 20 phòng đếm theo `socket.rooms` thực tế (thu hồi phía server không cập nhật map `joined`) — có test.

### Rebase & DoD rev2
- Rebase lên `main` @ 2ae41e9 (có T-015); commit cherry-pick cũ `c40a2ad` được git bỏ tự động (đã có upstream).
- Valkey của compose dùng chung không còn chạy (container `taskflow-*` đã bị gỡ) ⇒ chạy tầng I trên Valkey 9.1.2 **riêng tạm** (`t016-valkey`, `127.0.0.1:6390`, đã xóa sau khi test) với `TEST_VALKEY_URL=redis://127.0.0.1:6390 REQUIRE_INTEGRATION=1` — 4 test Valkey thật đều CHẠY (không skip).
- DoD rev2: install --frozen-lockfile / typecheck / lint (api 195 module, 0 vi phạm) / **test 79 file, 802 test** (gồm 4 test Valkey thật) / build — tất cả exit 0. Coverage: `core/realtime` 99.40 / 95.58 (stmts/branches), rate-limit 96.59 / 92.10.
