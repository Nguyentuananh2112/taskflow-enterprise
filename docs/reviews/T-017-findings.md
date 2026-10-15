# T-017 — Findings (QA độc lập, Engineer F)

Ngày: 2026-10-15 · Branch `feat/T-017` (rebase trên `main` 791f6fa; mutation chạy trên 7d4398e — core/auth không đổi giữa hai mốc) · Người viết: Engineer F (session `taskflow-enterprise-bb`)

Tài liệu gồm 3 phần: **A. Lỗi bảo mật** (đã báo Tech Lead ngay) · **B. Mutation testing** (test yếu — Tech Lead phân cho chủ module, F không sửa test của người khác) · **C. Ma trận SEC-01..58**.

---

## A. Lỗi bảo mật phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| A1 | **Medium** | T-016 `core/http/rate-limit/rate-limit.ts` `createGlobalRateLimit` | Request chỉ cần **có** header `Authorization` (kể cả rác) là bỏ qua limiter 100/phút/IP; limiter user đặt sau `authenticate` nên token rác bị 401 trước khi được đếm ⇒ không bị giới hạn ở đâu. Lệch security.md §6.4. | **ĐÃ SỬA** (T-016 rev2, e7dfb57). Cổng `rate-limit.sec.ts` "CỔNG T-016 (bypass)" **xanh** trên main (429 trước request thứ 1050). Bucket 401 30/phút: GATE-T016-401 (PENDING, cần route đã xác thực). |
| A2 | Low | T-016 `core/realtime/socket-handlers.ts` `project:join` | TOCTOU: `await canAccessProject()` rồi mới `socket.join()`; `revokeWorkspaceAccess` (socketsLeave) chạy xen giữa ⇒ socket vẫn vào phòng sau khi bị thu hồi, nhận `task:*` tới lần `auth:renew` kế. | **ĐÃ SỬA** (T-016 rev2: kiểm lại quyền sau `join`). `gateway.test.ts` có case xen kẽ + fail-closed (TL xác nhận). Cổng đen SEC-37b: PENDING (cần socket auth + workspace route). |
| A3 | Low-Medium | T-014 (đã merge) `modules/auth/application` + security.md §2.4 | Thu hồi phiên **fail-open khi GHI cache lỗi**: logout / logout-all / change-password / reuse-detected ghi `auth:sid-revoked` / `auth:tv` sau commit bằng `bestEffort` (chỉ log warn). `AccessTokenAuthenticator` chỉ fallback DB khi **đọc** Valkey lỗi; đọc được thì tin cache ⇒ access token đã thu hồi vẫn hợp lệ tới hết hạn (≤ 900s) nếu lần ghi rơi vào lúc Valkey chập chờn. | Báo TL 2026-10-15. Đề xuất: DEL `auth:tv` trước commit + SET sau; SET `sid-revoked` trước commit; lỗi ⇒ 503 (fail-closed cho thao tác bảo mật); hạ TTL `auth:tv` ≈ 60s. Cổng: SEC-24b (PENDING T-021) + unit test đề xuất cho B (store ném khi ghi, đọc trả giá trị cũ ⇒ phải 401). |
| A4 | **High (nếu hiện thực ngây thơ)** | T-014 `IUserRepository.save` + login / change-password / logout-all; T-021 chưa viết repo Prisma | `save(user)` ghi cả aggregate, không version/khóa. Login đọc user ngoài transaction, verify argon2 (~50–100ms), rồi `save`. Đổi mật khẩu / logout-all commit xen giữa ⇒ login ghi lại `passwordHash`/`tokenVersion` cũ ⇒ **đổi mật khẩu bị hoàn tác, phiên đã thu hồi sống lại**. | Báo TL 2026-10-15 (trước khi A viết repo). Đề xuất: UPDATE nguyên tử có mục đích (`last_login_at`; rehash có điều kiện `password_hash = old`; `token_version = token_version + 1 RETURNING`), hoặc cột `version` + `updateMany` như ADR-010. Cổng: SEC-21c, SEC-23b (PENDING T-021). |
| A5 | Low | `core/http/middleware.ts` `requireJsonContentType` + body-parser | `charset=utf-7` / `utf-16le` / `utf-16be` (với `application/json`) được chấp nhận (body-parser nhận mọi `utf-*`, iconv giải mã cả UTF-7). RFC 8259: JSON trao đổi phải UTF-8; UTF-7 là vector né bộ lọc cổ điển. | Báo TL. Đề xuất: chỉ nhận không charset hoặc `utf-8` ⇒ khác ⇒ 415. Cổng: `transport.sec.ts` "FINDING A5" (đỏ trên main). |
| A6 | Medium (toàn vẹn dữ liệu; dev/e2e — prod bị chặn bởi guard InMemory) | T-021 `composition/in-memory-unit-of-work.ts` | `inTransaction` là cờ chung instance ⇒ request đồng thời chạy **lồng** trong transaction của nhau thay vì xếp hàng. Tái hiện đen: 5 register song song (email khác nhau) ⇒ 2 cái `409 EMAIL_ALREADY_EXISTS` nhưng user **vẫn được tạo**, đăng nhập được, **không có workspace** (mồ côi); biến thể `500 AfterCommitOutsideTransactionError`. | Báo A + TL 2026-10-15. Sửa: AsyncLocalStorage cho ngữ cảnh transaction. Cổng: SEC-40 (đỏ trên T-021 061976b). |

**A2-test:** đã có trong `gateway.test.ts` của A (case "TOCTOU (review T-016)" + re-check lỗi ⇒ fail-closed); A đã mutation-check (bỏ re-check ⇒ 2 test đỏ).

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

### B.2 Kết quả

| Nhóm | Mutant | Killed | Timeout | Survived | **Score** | Thời gian chạy |
|---|---|---|---|---|---|---|
| core-errors | 60 | 59 | 0 | 1 | **98.33%** | 1m34s (96s cả khởi động) |
| core-http | 316 | 235 | 3 | 78 | **75.32%** | 13m07s |
| core-runtime | 191 | 153 | 4 | 34 | **82.20%** | 6m12s |
| auth-domain | 229 | 207 | 9 | 13 | **94.32%** | 17m15s |
| auth-application | 267 | 230 | 0 | 37 | **86.14%** | 11m14s |
| auth-infrastructure | 321 | 265 | 0 | 56 | **82.55%** | 6m35s |
| **Tổng** | **1384** | **1149** | **16** | **219** | **84.18%** | ~56 phút (tuần tự, concurrency 2, máy ~5 GB RAM trống) |

Score = (killed + timeout) / tổng (cách tính của Stryker). Sau khi phân loại, phần lớn survivor là **[EQ]** (tương đương) hoặc **[LOW]** (chuỗi log/thông điệp) — số **[GAP]** thật ở các bảng dưới.

**Mutant kiểm chứng thủ công** (yêu cầu TL — chứng minh command runner báo Killed thật, không cấu hình sai): sửa tay 1 điều kiện mỗi nhóm, chạy đúng lệnh test của nhóm, khôi phục bằng bản sao lưu (`git status` sạch sau đó).

| Nhóm | Đột biến tay | Kết quả | Test bắt |
|---|---|---|---|
| core-errors | `client-errors.ts:98` 413 → 414 | exit 1, 4.7s | `app.test.ts` "vượt body limit ⇒ 413", `errors.test.ts` PayloadTooLargeError |
| core-http | `middleware.ts:75` `allowed.has(origin)` → `true` | exit 1, 1.4s | `app.test.ts` "CORS: … origin lạ không" |
| core-runtime | `graceful-shutdown.ts:52` `shuttingDown = true` → `false` | exit 1, 1.3s | `graceful-shutdown.test.ts` "request đang chạy vẫn hoàn tất 200…" |
| auth-domain | `refresh-token.ts:113` `<` → `<=` | exit 1, 1.7s | `refresh-token.test.ts` REF-04/05 (biên 9_999/10_000) |
| auth-application | `access-token-authenticator.ts:51` `tokenVersion !== tv` → `false` | exit 1, 1.5s | MW-04, MW-06 |
| auth-infrastructure | `jose-access-token-service.ts:113` bỏ điều kiện `tv < 0` | exit 1, 1.6s | "tv âm ⇒ invalid" |

**Về 16 Timeout** (refresh-token.ts:113/118, user.ts:28-29, graceful-shutdown, middleware bindContext): bản tay của refresh-token.ts:113 bị giết trong 1.7s bởi assertion ⇒ timeout trong Stryker là do môi trường (2 tiến trình vitest song song trên máy thiếu RAM), **không** phải test treo. Stryker tính Timeout là "đã phát hiện" — kết luận giữ nguyên. Lo ngại (a) của TL về biên `≤/<` của `RefreshToken.assess()`: **đã được test bao phủ** (9_999/10_000 cho ân hạn; biên `expiresAt`/`familyExpiresAt` cũng bị giết hoặc timeout-giết).

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
| P2 [GAP] | `error-handler.ts:36-37` | translator `charset.unsupported`/`encoding.unsupported` ⇒ `undefined` (rơi về 500) | Không test charset/encoding lạ | `Content-Type: application/json; charset=iso-8859-1` ⇒ 415; `Content-Encoding: compress` ⇒ 415 (không phải 500). (utf-7/utf-16 hiện được chấp nhận — xem A5) |
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

### B.4 Findings — `apps/api/src/modules/auth/**` → **Engineer B**

#### auth/domain (94.32%)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| P2 [GAP] | `password-policy.ts:57` | `localPart.length >= 3` ⇒ `> 3` | Test CONTAINS_EMAIL chỉ dùng local-part dài (lo ngại (b) của TL) | Email `abc@x.io`, mật khẩu `xxabcxxxxxxxxx` ⇒ `CONTAINS_EMAIL`; email `ab@x.io`, mật khẩu chứa `ab` ⇒ **không** báo |
| P2 [GAP] | `email.ts:36` | bỏ kiểm `parts.length !== 2` | Không test email có 2 dấu `@` mà phần sau `@` thứ nhất có dấu chấm | `Email.create('a@b.c@d.e')` ⇒ `ValidationError` |
| P2 [GAP] | `email.ts:30` | `equals` luôn `true` | Chỉ test 2 email bằng nhau | `Email.create('a@x.io').equals(Email.create('b@x.io'))` ⇒ `false` |
| P2 [GAP] | `refresh-token.ts:68` | `userAgent?.slice` ⇒ `.slice` | Không test phát hành token khi không có User-Agent | `RefreshToken.issue({ …, meta: { userAgent: undefined, ip } })` ⇒ `userAgent === null`, không ném (client không gửi UA ⇒ login 500 nếu hỏng) |
| P3 [GAP] | `refresh-token.ts:84` | getter `tokenHash` rỗng | Không assert trực tiếp | `issue(...).tokenHash === input.tokenHash` |
| — [EQ] | `password-policy.ts:41, 46` | `> MAX_UTF16_UNITS` ⇒ `>=` (1024) | 1024 đơn vị UTF-16 sau NFC luôn ≥ 342 code point > 256 ⇒ vẫn TOO_LONG | — (biên 12/256 code point **đã được test giết**) |
| — [EQ] | `email.ts:34, 37` | `length === 0` ⇒ `false`; giá trị mặc định destructuring | Chuỗi rỗng rơi vào `parts.length !== 2`; mặc định không bao giờ dùng | — |
| — [LOW] | `user.ts:29-31` | thông điệp lỗi họ tên | — | — |

#### auth/application (86.14%)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| P2 [GAP] | `use-cases/login.use-case.ts:51` | không gọi `replacePasswordHash` khi `needsRehash` | Không test nhánh rehash | Hasher giả `needsRehash → true`, `hash → 'new'` ⇒ sau login `users.findById().passwordHash === 'new'`. **Lưu ý A4**: hiện thực Prisma phải là UPDATE có điều kiện |
| P2 [GAP] | `use-cases/change-password.use-case.ts:72` | bỏ kiểm `!user \|\| user.isDeleted` | Không test user đã xóa đổi mật khẩu (token còn hạn) | User `deletedAt` ≠ null ⇒ `UnauthorizedError`, hash không đổi |
| P2 [GAP] | `use-cases/register.use-case.ts:44` | điều kiện thử lại slug ⇒ `\|\|` / `true` / bỏ `?.` | Chỉ test va chạm slug; không test `ResourceConflictError` khác `field` hoặc `details = null` | Repo workspace ném `ResourceConflictError({ field: 'name' })` ⇒ ném lại ngay (repo `add` gọi đúng 1 lần), không thử lại 5 lần; `details: null` ⇒ không `TypeError` |
| P2 [GAP] | `access-token-authenticator.ts:31` | regex Bearer bỏ `^` / `$` / `\s+` ⇒ `\s` / `\s*$` ⇒ `\S*$` | Chỉ test header chuẩn | `'xBearer tok'`, `'Bearer tok extra'`, `'Bearer'` ⇒ 401 không gọi `verify`; `'bearer   tok'` ⇒ qua |
| P3 [GAP] | `access-token-authenticator.ts:41-42` | bỏ `if (!token) throw` | `verify(undefined)` của fake cũng trả invalid ⇒ vẫn 401 | Spy: thiếu header ⇒ 401 và `accessTokens.verify` **không** được gọi |
| P3 [GAP] | `use-cases/login.use-case.ts:64-65` | `catch` nuốt mọi lỗi | Không test lỗi không phải `ValidationError` từ `Email.create` | (khó tạo — có thể bỏ qua) |
| — [EQ] | `refresh-session.use-case.ts:48, 52, 56` | `'superseded'`/`'valid'` ⇒ `''`; bỏ `throw` sau reuse | Fallthrough `switch` tới `expired/revoked` cũng ném; `superseded` lọt qua thì `markRotated` có điều kiện trả `false` ⇒ vẫn 409 (phòng thủ 2 lớp) | — |
| — [EQ] | `access-token-authenticator.ts:51` | `tokenVersion === null` ⇒ `false` | `null !== tv` (số) đã đúng | — |
| — [LOW] | `auth-shared.ts:27-30, 60`; log ở login/logout/logout-all/refresh/change-password; `register.use-case.ts:67` | thông điệp, trường log | — | — |

#### auth/infrastructure (82.55%)

| Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|
| P1 [GAP] | `security/jose-access-token-service.ts:111-114` (`toClaims`) | mọi kiểm tra kiểu/rỗng của `sub`, `jti`, `sid`, `tv` (số thực), `iat`, `exp` | Test chỉ có "tv âm" (lo ngại (c) của TL). Token ký bằng khóa thật nhưng claim sai kiểu chưa được thử | Ký bằng `SignJWT` + secret test: `sid: ''`, `sid: 123`, `sub: ''`, `jti: ''`, `tv: 1.5`, `tv: '1'`, `iat: 'x'` ⇒ mỗi cái `{ ok:false, reason:'invalid' }`. Quan trọng: `sid` rỗng ⇒ tra `auth:sid-revoked:` sai khóa ⇒ né thu hồi phiên |
| P1 [GAP] | `persistence/in-memory/in-memory-refresh-token.repository.ts:49-52` (`isSessionRevoked`) | `.some` ⇒ `.every`; bỏ lọc `familyId`; bỏ `REUSE_DETECTED` | Không test trực tiếp đường fallback DB (security.md §2.4: `revoked_reason IN ('LOGOUT','REUSE_DETECTED')`) | **Bộ contract test dùng chung cho repository** (chạy với InMemory ngay, với Prisma ở T-020): family có token `REUSE_DETECTED` ⇒ `true`; chỉ `ROTATED` ⇒ `false`; family khác bị thu hồi ⇒ không ảnh hưởng |
| P1 [GAP] | `persistence/in-memory/in-memory-user.repository.ts:41` (`getTokenVersion`) | user đã xóa vẫn trả `tokenVersion` | Không test user xóa ⇒ `null` (authenticator dựa vào `null` để 401) | Contract: user `deletedAt` ≠ null ⇒ `getTokenVersion === null` |
| P1 [GAP] | `persistence/in-memory/in-memory-session-revocation.store.ts:30-37` | `setTokenVersion` rỗng; `primeTokenVersion` ghi đè vô điều kiện | Ngữ nghĩa ALL-05 (writer `SET` thắng, reader `SET NX`) chưa được test — và store Valkey thật sẽ cần đúng hành vi này | Contract: `set(2)` rồi `prime(1)` ⇒ đọc `2`; `prime(1)` rồi `set(2)` ⇒ `2` |
| P2 [GAP] | `persistence/in-memory/in-memory-refresh-token.repository.ts:15-16, 72-74` | bỏ unique `tokenHash`; `revokeFamily` thu hồi lại token đã thu hồi / đếm sai | Không test | Contract: `add` trùng hash ⇒ ném; `revokeFamily` không đổi `revokedReason` của token đã `ROTATED`, trả số token bị thu hồi mới |
| P2 [GAP] | `security/argon2id-password-hasher.ts:71, 74, 75` | `needsRehash` bỏ so `version` / `parallelism` / `outputLen` | Chỉ test khác `memoryCost`/`timeCost` | Hash với `parallelism: 2` (và `outputLen` khác) ⇒ `needsRehash === true` |
| P2 [GAP] | `security/crypto-refresh-token-factory.ts:9` | bỏ `^` / `$` của `/^[0-9a-f]{64}$/` | Chỉ test chuỗi sai hoàn toàn | `'x' + hex64`, `hex64 + 'x'` ⇒ bị từ chối |
| P2 [GAP] | `security/jose-access-token-service.ts:36` | `< 32` ⇒ `<= 32` | Không test secret đúng 32 byte | Secret 32 byte ⇒ khởi tạo được; 31 byte ⇒ ném |
| P3 [GAP] | `persistence/in-memory/in-memory-user.repository.ts:34` | `save` user không tồn tại không ném | — | `save(userChưaAdd)` ⇒ ném |
| — [EQ] | `jose-access-token-service.ts:16, 85-86` | `REQUIRED_CLAIMS = []`; bỏ kiểm `kid` | Hai lớp phòng thủ chồng nhau: thiếu claim ⇒ `toClaims` chặn; `kid` lạ ⇒ `keys.get` trả `undefined` ⇒ jose tự ném. (Sau khi thêm test P1 ở trên, `REQUIRED_CLAIMS` vẫn sẽ sống — chấp nhận) | — |
| — [EQ] | `jose-access-token-service.ts:31, 54, 67` | độ dài `kid`; `previous === secret`; `!key` khi ký | `kid` chỉ cần nhất quán; trùng secret ⇒ cùng `kid` ghi đè cùng khóa; nhánh không thể tới | — |
| — [LOW] | thông điệp lỗi ở `argon2id-password-hasher.ts:49`, `jose-access-token-service.ts:37, 53, 57, 67, 86`, `in-memory-*.ts` | — | — | — |

**Lưu ý cho TL:** repository InMemory đang là **runtime thật** của T-021 (dev/e2e) cho tới T-020, nên các [GAP] P1 của nó không chỉ là "fake yếu". Đề xuất một bộ **contract test chung** `IUserRepository` / `IRefreshTokenRepository` / `ISessionRevocationStore`, chạy cho cả InMemory lẫn Prisma/Valkey — cũng là cổng cho A4.

---

## C. Ma trận SEC-01..58 (bộ test đen `apps/api/test/security/`)

Chạy: `pnpm --filter @taskflow/api test:security` (cần compose `taskflow`: Postgres 5434, Valkey 6380 db 15). Nghiệm thu branch khác: `SEC_API_DIR=<worktree>/apps/api` + `SEC_RUN_PENDING=<nhãn,…>` (vd `auth routes,workspaces/`) hoặc `all`.

Trạng thái: **✅** xanh · **❌** đỏ (có lỗi thật) · **⏳ có thân** = viết sẵn, skip trên main, chạy khi route có · **⏳ todo** = chưa viết thân (không bao giờ tính xanh) · **E2E** = Playwright Phase 4/5.

| ID | Nội dung | main (a2adb8f) | T-021 (061976b) | Ghi chú |
|---|---|---|---|---|
| SEC-01 | IDOR: Bob đọc projects ws A ⇒ 404 giống ws không tồn tại | ⏳ có thân | ✅ | |
| SEC-02 | URL ws B + project/task của A ⇒ 404, DB không đổi | ⏳ có thân | ⏳ (cần T-018) | |
| SEC-03 | taskId của project khác cùng ws ⇒ 404 | ⏳ todo | ⏳ (T-018) | |
| SEC-04 | Mass assignment khi tạo task ⇒ 400 | ⏳ có thân | ⏳ (T-018) | |
| SEC-05 | VIEWER ghi task (5 thao tác) ⇒ 403 | ⏳ có thân | ⏳ (T-018) | |
| SEC-06 | MEMBER xóa task người khác ⇒ 403 | ⏳ có thân | ⏳ (T-018) | |
| SEC-07..12c | Ma trận xóa/gán/archived | ⏳ todo | ⏳ (T-018) | |
| SEC-13..15 | Quyền member/role, LAST_OWNER | ⏳ todo | ⏳ todo | Viết tiếp trên route T-021 |
| SEC-16 | Bị xóa khỏi ws, token còn hạn ⇒ 404 | ⏳ todo | ⏳ todo | |
| SEC-17 | Refresh hợp lệ ⇒ ROTATED, cùng family | ⏳ todo | ⏳ todo | Cần đọc DB (đen: kiểm gián tiếp) |
| SEC-18 | Reuse refresh >10s ⇒ thu hồi family + sid | ⏳ có thân | ✅ | |
| SEC-19, 20 | Refresh song song / quá hạn | ⏳ todo | ⏳ todo | SEC-20 cần điều khiển đồng hồ |
| SEC-21 | Logout-all ⇒ access/refresh cũ 401 | ⏳ có thân | ✅ | |
| SEC-21b | Logout-all ⇒ socket bị ngắt | ⏳ todo | ⏳ todo | |
| SEC-21c | Race login ‖ logout-all ×20 (A4) | ⏳ có thân | ✅ (InMemory) | **Chạy lại với Prisma (T-020)** — InMemory không có cửa sổ race thật |
| SEC-22, 23 | Logout 1 thiết bị / đổi mật khẩu | ⏳ todo | ⏳ todo | |
| SEC-23b | Race login ‖ change-password ×20 (A4) | ⏳ có thân | ✅ (InMemory) | Như SEC-21c |
| SEC-24, 24b | Valkey tắt / lỗi ghi sau commit (A3) | ⏳ todo | ⏳ todo | Cần điều khiển container Valkey |
| SEC-25 | JWT giả mạo (6 biến thể) | ⏳ có thân | ✅ | |
| SEC-26, 27 | JWT hết hạn; chống dò user theo thời gian | ⏳ todo | ⏳ todo | |
| SEC-28, 28b | Rate limit login; Valkey tắt ⇒ fail-closed | ⏳ todo | ⏳ todo | |
| SEC-29 | Refresh Origin lạ/thiếu ⇒ 403, không xoay | ⏳ có thân | ✅ | |
| SEC-30 | CORS whitelist (11 case) | ✅ | ✅ | |
| SEC-31 | Body 413 / 415 / bom gzip / JSON hỏng không phản chiếu | ✅ | ✅ | + **FINDING A5** ❌ (charset utf-7/16) |
| SEC-32 | Biên mật khẩu 11/12/256/257, phổ biến, chứa email | ⏳ todo | ⏳ todo | |
| SEC-33 | Log không lộ password/token/cookie | ⏳ có thân | ✅ | |
| SEC-34 | Cookie prod `__Secure-tf_rt` | ⏳ todo | ⏳ | `production.sec.ts` không khởi động được trên T-021 (guard InMemory — đúng) |
| SEC-35..39, 41 | Socket auth / phòng / renew / X-Client-Id | ⏳ todo | ⏳ todo | Cần socket.io-client (devDependency mới — hỏi TL) |
| SEC-37b | TOCTOU project:join (A2) | ⏳ todo | ⏳ todo | Đã có unit test của A |
| SEC-40 | Đăng ký đồng thời | ⏳ có thân | **❌ A6** | 2/5 nhận 409 nhưng user mồ côi được tạo |
| SEC-42..46 | VERSION_CONFLICT/VIEWER, gán VIEWER, bỏ gán, race | ⏳ todo | ⏳ (T-018) | |
| SEC-47, 51..55 | Workspace xóa mềm / restore | ⏳ todo | ⏳ todo | Viết tiếp trên route T-021 |
| SEC-48..50 | CSP nonce, XSS hiển thị, không token trong storage | E2E | E2E | Playwright Phase 4/5 |
| SEC-56 | WS Origin lạ/thiếu, polling, serveClient (7 case) | ✅ | ✅ | Đối chứng: Origin hợp lệ ⇒ 101 |
| SEC-57 | PATCH /auth/me mass assignment | ⏳ có thân | ✅ | |
| SEC-58 | Tìm member `q=bob/%/_` | ⏳ có thân | ✅ | |
| Cổng T-016 | Authorization rác / Basic không né rate limit IP | ✅ | — | A1 đã sửa |
| GATE-T016-401 | Bucket 401 30/phút | ⏳ todo | ⏳ todo | Cần route đã xác thực — viết trên T-021 |
| Production | HSTS, CORS prod, không `details.debug`, readyz degraded | ✅ | không chạy | |

**Tổng trên main:** 42 xanh · 3 đỏ (FINDING A5) · 15 skip · 49 todo · còn lại PENDING/todo. **Trên T-021:** 13 ID xanh, 1 ID đỏ (SEC-40/A6) + A5.

---

## D. Điều tra flaky lần chạy đầu của `test:security` (T-017c)

**Hiện tượng (TL báo, a1076c1):** lần chạy đầu ở worktree mới, nguội: `1 failed | 3 passed | 2 skipped`; lần 2 ngay sau exit 0. Tôi gặp 2 lần tương tự: (1) file đầu không lên `/healthz` trong 90s, process không in dòng nào; (2) `prisma migrate deploy` (CLI trong worktree T-024) bị `spawnSync` cắt ở 120s, stdout/stderr rỗng.

**Đo** (`scratchpad/coldstart.mjs`, máy dev, 2 lần liên tiếp):

| Bước | Lần 1 | Lần 2 |
|---|---|---|
| Process API lên `/healthz` (có cache tsx) | **30 920 ms** | 1 117 ms |
| Process API, `TSX_DISABLE_CACHE=1` | 3 851 ms | 2 314 ms |
| `prisma migrate status` mặc định (checkpoint mạng) | **35 685 ms** | 828 ms |
| `prisma migrate status`, `CHECKPOINT_DISABLE=1` | 940 ms | 876 ms |

**Kết luận:** không phải lỗi test, không phải advisory lock, không phải cache tsx (tắt cache chỉ tốn 2–4s).

1. **Lần spawn Node đầu tiên sau quãng nghỉ chậm ~30s**: file cache của OS / antivirus quét `node_modules`. Nặng nhất ở worktree mới.
2. **CLI Prisma gọi mạng kiểm tra phiên bản (checkpoint)**: 35s đo được, từng >120s. Mạng máy dev rất chậm (`pnpm install` 10–33 phút).

**Sửa (feat/T-017c):**

- `globalSetup` (`harness/global-setup.ts`) chạy **một lần**: kiểm DB/cổng an toàn → chuẩn bị DB + migrate → khởi động process API thật tới `/healthz` rồi dừng. Timeout riêng `SEC_WARMUP_TIMEOUT_MS` (mặc định 300s). Lỗi ⇒ thông báo `[hạ tầng suite bảo mật] bước "…" lỗi — không phải lỗi test` + exit ≠ 0 (đã kiểm với cổng Postgres sai).
- Migrate: `CHECKPOINT_DISABLE=1`, `PRISMA_HIDE_UPDATE_MESSAGE=1`, timeout `SEC_MIGRATE_TIMEOUT_MS` (300s); lỗi báo rõ `signal`/timeout thay vì stdout rỗng. D đặt `CHECKPOINT_DISABLE` ở Docker/CI/runbook (TL giao).
- Giữ: `SEC_API_READY_TIMEOUT_MS` (90s) cho từng file — sau warm-up chỉ còn 1–3s.

**Chưa làm:** tái hiện trong một worktree **hoàn toàn mới** (cần `pnpm install` 10–30 phút trên mạng hiện tại) — đang chạy nền, kết quả sẽ bổ sung vào đây.

---

## E. Suite task trên T-024 @ 7003b9c (InMemory)

`SEC_RUN_PENDING="task routes,auth routes,workspaces/"`: **70 pass · 1 fail · 5 skip · 38 todo**.

- **PASS (task, 19):** SEC-02, 03, 04, 05, 06, 07, 08, 10, 11, 12, 12b, 12c, 42, 43, 44, 45, TASK-LIST, TASK-VC (409 + `currentVersion`, no-op version cũ vẫn 409 — ADR-091, DELETE `?expectedVersion` cũ 409), TASK-VC-RACE (10 PATCH song song ⇒ đúng 1×200, 9×409).
- **FAIL SEC-23b (không ổn định, 1/2 lần × 20 vòng) = A4 TÁI HIỆN BẰNG HỘP ĐEN:** change-password 200, login song song 200, sau đó **mật khẩu mới bị 401** — login đọc user ngoài UoW rồi `save` cả aggregate, đè hash cũ. Bằng chứng thực nghiệm cho ADR-104; sửa ở T-020. SEC-23b + SEC-21c là **cổng bắt buộc** của T-020: chạy lặp nhiều lần, ghi tỉ lệ.
- **TODO:** SEC-09 (cần API xóa user ⇒ `createdById = null`); realtime không rò sang workspace khác (cần `socket.io-client` — TL đã duyệt).
- Lỗi của chính tôi được sửa trong quá trình: title `'x'` vi phạm min 3 ký tự ⇒ 400 trước khi tới bước cần kiểm (SEC-03/10); SEC-23b thêm assertion change-password phải 200 (không xanh giả nếu đổi mật khẩu thất bại).
