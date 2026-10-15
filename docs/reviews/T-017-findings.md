# T-017 — Findings (QA độc lập, Engineer F)

Ngày: 2026-10-15 · Branch `feat/T-017` từ `main` 7d4398e · Người viết: Engineer F (session `taskflow-enterprise-bb`)

Tài liệu gồm 3 phần: **A. Lỗi bảo mật** (đã báo Tech Lead ngay) · **B. Mutation testing** (test yếu — Tech Lead phân cho chủ module, F không sửa test của người khác) · **C. Ma trận SEC-01..58**.

---

## A. Lỗi bảo mật phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| A1 | **Medium** | T-016 `core/http/rate-limit/rate-limit.ts` `createGlobalRateLimit` | Request chỉ cần **có** header `Authorization` (kể cả rác) là bỏ qua limiter 100/phút/IP; limiter user đặt sau `authenticate` nên token rác bị 401 trước khi được đếm ⇒ không bị giới hạn ở đâu. Lệch security.md §6.4. | Báo TL 2026-10-15; T-016 bị trả về A. Cổng nghiệm thu: `rate-limit.sec.ts` "CỔNG T-016 (bypass)". |
| A2 | Low | T-016 `core/realtime/socket-handlers.ts` `project:join` | TOCTOU: `await canAccessProject()` rồi mới `socket.join()`; `revokeWorkspaceAccess` (socketsLeave) chạy xen giữa ⇒ socket vẫn vào phòng sau khi bị thu hồi, nhận `task:*` tới lần `auth:renew` kế. | Báo TL; trả A. Cổng: SEC-37b (PENDING tới khi socket auth được wire Phase 3) + đề xuất unit test ở mục A2-test. |

| A3 | Low-Medium | T-014 (đã merge) `modules/auth/application` + security.md §2.4 | Thu hồi phiên **fail-open khi GHI cache lỗi**: logout / logout-all / change-password / reuse-detected ghi `auth:sid-revoked` / `auth:tv` sau commit bằng `bestEffort` (chỉ log warn). `AccessTokenAuthenticator` chỉ fallback DB khi **đọc** Valkey lỗi; đọc được thì tin cache ⇒ access token đã thu hồi vẫn hợp lệ tới hết hạn (≤ 900s) nếu lần ghi rơi vào lúc Valkey chập chờn. | Báo TL 2026-10-15. Đề xuất: DEL `auth:tv` trước commit + SET sau; SET `sid-revoked` trước commit; lỗi ⇒ 503 (fail-closed cho thao tác bảo mật); hạ TTL `auth:tv` ≈ 60s. Cổng: SEC-24b (PENDING T-021) + unit test đề xuất cho B (store ném khi ghi, đọc trả giá trị cũ ⇒ phải 401). |

| A4 | **High (nếu hiện thực ngây thơ)** | T-014 `IUserRepository.save` + login / change-password / logout-all; T-021 chưa viết repo Prisma | `save(user)` ghi cả aggregate, không version/khóa. Login đọc user ngoài transaction, verify argon2 (~50–100ms), rồi `save`. Đổi mật khẩu / logout-all commit xen giữa ⇒ login ghi lại `passwordHash`/`tokenVersion` cũ ⇒ **đổi mật khẩu bị hoàn tác, phiên đã thu hồi sống lại**. | Báo TL 2026-10-15 (trước khi A viết repo). Đề xuất: UPDATE nguyên tử có mục đích (`last_login_at`; rehash có điều kiện `password_hash = old`; `token_version = token_version + 1 RETURNING`), hoặc cột `version` + `updateMany` như ADR-010. Cổng: SEC-21c, SEC-23b (PENDING T-021). |

**A2-test (đề xuất cho A, đặt trong `gateway.test.ts` — ngoài phạm vi sở hữu của F):** `accessChecker.canAccessProject` trả về promise treo (deferred); client gửi `project:join`; trong lúc treo gọi `gateway.revokeWorkspaceAccess({ userId, workspaceId, projectIds:[projectId] })`; resolve deferred `true`; chờ ack; `emitToProject(projectId)` ⇒ client **không** được nhận event, và `io.in('project:'+projectId).fetchSockets()` rỗng.

---

## B. Mutation testing

### B.1 Công cụ & cách chạy

- **StrykerJS `@stryker-mutator/core` 10.0.0** (devDependency của `@taskflow/api`, pin chính xác), `testRunner: "command"`, `coverageAnalysis: "off"`, concurrency 2 — TL duyệt.
- **Không dùng `@stryker-mutator/vitest-runner`**: 10.0.0 (2026-08-14) ra trước Vitest 5.0.0 (2026-09-03) và sai với Vitest 5 — stryker-js #6240 (coverage per-test sai, điểm 100→11), #6247/#6248 (lọc tên test lồng không khớp " > "), #6150/#6255 (mutant ném lỗi lúc import bị báo Survived). Mọi điểm số từ runner đó sẽ đầy mutant sống giả.
- Mỗi mutant chạy lại bộ test của nhóm bằng `vitest run` (process mới, `__STRYKER_ACTIVE_MUTANT__`). Chậm hơn nhưng không phụ thuộc nội bộ Vitest.
- Chạy lại: `pnpm --filter @taskflow/api mutation:<nhóm>`; báo cáo HTML/JSON ở `apps/api/coverage/mutation/<nhóm>.{html,json}` (đã gitignore qua `coverage/`). Đề xuất đưa vào CI **hằng tuần** (không mỗi PR).

| Nhóm | File bị đột biến | Test chạy cho mỗi mutant |
|---|---|---|
| core-errors | `src/core/errors/**` | `src/core`, `src/app.test.ts` |
| core-http | `src/core/http/**` | như trên |
| core-runtime | `src/core/{context,domain,events,infrastructure,lifecycle,logging,persistence}/**` | như trên |
| auth-domain | `src/modules/auth/domain/**` | `src/modules/auth` |
| auth-application | `src/modules/auth/application/**` | như trên |
| auth-infrastructure | `src/modules/auth/infrastructure/**` | như trên |

<!-- SCORES -->

### B.3 Findings — `apps/api/src/core/**` → **Engineer A**

Ký hiệu: **[GAP]** test thiếu, cần thêm · **[EQ]** mutant tương đương — KHÔNG cần làm gì · **[LOW]** chỉ chuỗi log/thông điệp, có thể bỏ qua.
Mỗi [GAP] là một test cần thêm; mức ưu tiên P1 (bảo mật/vận hành) > P2 (hành vi/contract) > P3.

#### core/http (75.32% — yếu nhất)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| P1 [GAP] | `middleware.ts:37-43` | `serializers: {}` / `req`, `res` serializer ⇒ `undefined` | Không test nào đọc dòng log request. Bỏ serializer ⇒ pino-http log **toàn bộ header** (redact chỉ che `authorization`/`cookie`; các header khác, kể cả header tùy biến sau này, lọt log) | Dùng `createLogger(…, destination)` gom log; gửi request có `Authorization`, `Cookie`, `X-Api-Key`; assert entry `req` chỉ có đúng `{id, method, url}`, `res` chỉ `{statusCode}` |
| P1 [GAP] | `middleware.ts:13` | bỏ `^` hoặc `$` khỏi regex UUID | `resolveRequestId` chỉ được test với uuid hợp lệ / chuỗi rác hoàn toàn | `resolveRequestId('evil' + uuid)` và `resolveRequestId(uuid + 'evil')` ⇒ trả uuid **mới** (khác input). Chống log/header injection |
| P1 [GAP] | `middleware.ts:85` | bỏ `'PUT'`/`'PATCH'` khỏi `METHODS_WITH_BODY` | Test 415 chỉ dùng POST | `PATCH` và `PUT` với `Content-Type: text/plain` ⇒ 415 (security.md §6.3: mọi POST/PATCH) |
| P2 [GAP] | `middleware.ts:77, 79` | `methods`/`exposedHeaders` thành `[]` hoặc phần tử rỗng | Test CORS chỉ kiểm `allow-origin`, `allow-credentials`, `allow-headers` | Preflight hợp lệ: assert `Access-Control-Allow-Methods` = `GET,POST,PATCH,DELETE`; request thường: assert `Access-Control-Expose-Headers` = `X-Request-Id,Retry-After,RateLimit-Policy,RateLimit` (FE cần đọc `Retry-After`) |
| P2 [GAP] | `middleware.ts:102` | `strict: false`; `type: ''` | Không test nào gửi JSON gốc nguyên thủy, hay kiểm body đã được parse | POST `"chuỗi"` ⇒ 400; route echo `req.body` ⇒ object đúng như gửi |
| P2 [GAP] | `middleware.ts:96` | bỏ `.trim()` | Không test `Content-Type: application/json ; charset=utf-8` (có khoảng trắng trước `;`) | Gửi header đó ⇒ không phải 415 |
| P2 [GAP] | `error-handler.ts:36-37` | translator `charset.unsupported`/`encoding.unsupported` ⇒ `undefined` (rơi về 500) | Không test charset/encoding lạ | `Content-Type: application/json; charset=utf-7` ⇒ 415; `Content-Encoding: compress` ⇒ 415 (không phải 500) |
| P2 [GAP] | `error-handler.ts:79` | bỏ nhánh `res.headersSent` | Không có route ném lỗi sau khi đã gửi header | Route `res.write('x')` rồi `next(new Error())` ⇒ không ném "Cannot set headers", kết nối được đóng |
| P2 [GAP] | `error-handler.ts:86` | `error.cause ?? err` ⇒ `&&` | Không assert nội dung log lỗi 5xx | Route ném `new Error('boom')` ⇒ log `http.unhandled_error` có `err.message === 'boom'` |
| P2 [GAP] | `error-handler.ts:92` | `cause?.x` ⇒ `cause.x` | Không test `throw 'string'` khi `exposeInternalErrors: true` | Route `throw 'x'` ở dev ⇒ 500 envelope JSON (không sập error handler, không trang HTML mặc định của Express) |
| P2 [GAP] | `cursor.ts:30` | `typeof parsed !== 'object'` ⇒ `false` | Không test cursor là JSON nguyên thủy | `decodeCursor(base64url('5'))` và `base64url('"s"')` ⇒ `ValidationError` (không phải `TypeError` ⇒ 500) |
| P3 [GAP] | `health.ts:31` | bỏ `clearTimeout(timer)` | Rò timer không quan sát được trong test | `vi.useFakeTimers()`; sau `/readyz` thành công assert `vi.getTimerCount() === 0` |
| P3 [GAP] | `health.ts:54` | `Cache-Control` của `/readyz` rỗng | Chỉ `/healthz` được kiểm `no-store` | Assert `/readyz` có `Cache-Control: no-store` |
| P3 [GAP] | `validate.ts:32, 41-42` | bỏ `if (!schema) continue`; `enumerable/configurable: false` | Test luôn truyền đủ 3 schema; không chồng 2 `validate()` | `validate({ body })` một mình ⇒ không ném; 2 middleware `validate` liên tiếp trên cùng `body` ⇒ không ném "Cannot redefine property" |
| P3 [GAP] | `zod.ts:17` | ánh xạ `path` số/chuỗi | Không có issue với path chứa chỉ số mảng | Schema `z.array(z.string())` nhận `[1]` ⇒ `details.issues[0].path` = `[0]` (số, không phải `'0'`) |
| — [EQ] | `middleware.ts:75, 113` | `origin !== undefined` ⇒ `true` | `allowed.has(undefined)` luôn `false` ⇒ tương đương | — |
| — [EQ] | `middleware.ts:68, 71` | option HSTS / referrerPolicy ⇒ `{}` | Mặc định helmet 8 trùng giá trị đang cấu hình (đã có test HSTS ở production) | — |
| — [EQ] | `error-handler.ts:43` | `typeof type === 'string'` ⇒ `true` | `BODY_PARSER_ERRORS[undefined]` cũng trả `undefined` | — |
| — [EQ] | `cursor.ts:27` | `catch {}` rỗng | `parsed` để `undefined` ⇒ dòng 30 vẫn ném `invalidCursor` | — |
| — [LOW] | `middleware.ts:14, 34-36` | `QUIET_PATHS`, `customLogLevel` | Chỉ ảnh hưởng mức/tần suất log. **Nên** có 1 test: 5xx ⇒ level `error`, 4xx ⇒ `warn` (cảnh báo vận hành dựa vào level) — P3 | — |
| — [LOW] | `cursor.ts:10, 15`, `error-handler.ts:34`, `health.ts:23` | chuỗi thông điệp / `'utf8'` (mặc định của Buffer) | Không ảnh hưởng hành vi | — |

#### core/runtime (82.20%)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| P1 [GAP] | `lifecycle/graceful-shutdown.ts:83-84` | bỏ vòng đăng ký `SIGTERM`/`SIGINT`, handler ⇒ `undefined` | Test `installProcessHandlers` chỉ kiểm `unhandledRejection`/`uncaughtException` (hoặc không gọi tín hiệu) | Truyền `EventEmitter` giả làm `proc`; `emit('SIGTERM')` ⇒ `isShuttingDown()` true và `exit(0)`; tương tự `SIGINT`; emit `SIGTERM` 2 lần ⇒ shutdown chạy 1 lần. **Đây là đường rolling deploy (ADR-000)** |
| P2 [GAP] | `lifecycle/graceful-shutdown.ts:87, 91` | log fatal mất `err` | Không assert nội dung log fatal | Emit `uncaughtException` với `new Error('x')` ⇒ log `fatal` có `err.message === 'x'` |
| P2 [GAP] | `infrastructure/valkey.ts:8` | `disableOfflineQueue: false` | Không test hành vi khi mất kết nối | Client trỏ cổng đóng; `client.ping()` khi chưa kết nối ⇒ reject ngay (< 100ms), không treo — rate-limit fail-open/closed (T-016) phụ thuộc điều này |
| P2 [GAP] | `infrastructure/valkey.ts:11` | `reconnectStrategy` ⇒ `undefined` / `Math.max` / chia | Không test chiến lược reconnect | Export hàm backoff; assert `0→100`, `3→800`, `10→5000` (trần) |
| P3 [GAP] | `infrastructure/valkey.ts:29` | `<` ⇒ `<=` (cửa sổ 30s chống spam log) | Không test đúng biên 30_000ms | Fake clock: lỗi tại t=0 và t=30_000 ⇒ 2 log; t=29_999 ⇒ 1 log |
| P3 [GAP] | `context/request-context.ts:14` | `get()` rỗng | Chỉ `requestId()` được test | `run({requestId:'r'}, () => get())` ⇒ `{ requestId: 'r' }` |
| P3 [GAP] | `events/event-bus.ts:30, 40` | mảng khởi tạo có phần tử lạ | Không test publish khi chưa có subscriber cho loại event | `publish(evt)` không subscriber ⇒ không ném |
| — [EQ] | `domain/aggregate-root.ts:9` | `other === this` ⇒ `false` | Nhánh sau vẫn trả `true` (cùng constructor + id) | — |
| — [EQ] | `lifecycle/graceful-shutdown.ts:36-37, 58, 64, 68, 71` | `realtime/resources` mặc định, `exit` mặc định, `unref`, `closeIdleConnections()` đầu tiên (sweeper 50ms làm lại), `clearInterval`/`clearTimeout` trước `exit` | Test luôn tiêm `exit`; process kết thúc ngay sau đó | — (sweeper keep-alive — lỗi A từng bắt — **đã được test giết**) |
| — [LOW] | `graceful-shutdown.ts:53, 55, 72, 88, 92`; `valkey.ts:31, 38`; `persistence/*` (`application_name`, `'anonymous'`, thông điệp lỗi) | trường log / chuỗi | — | — |

#### core/errors (98.33%)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| — [EQ] | `app-error.ts:43` | `cause === undefined ? undefined : { cause }` ⇒ luôn `{ cause }` | Khác biệt duy nhất: `'cause' in err` với `cause: undefined` — không ai dựa vào | — |
