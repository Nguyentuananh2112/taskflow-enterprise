# T-028 — Rà soát bảo mật toàn hệ thống trước Phase 5

**Người làm:** Engineer B · **Branch:** `feat/T-028` · **Ngày:** 2026-10-15 · **Mốc code:** main `bc8d7c5`
**Chuẩn:** OWASP ASVS 5.0 mức L2 (mục liên quan) + `docs/design/security.md`.

## Phạm vi và cách làm

| Vùng | Chủ code | Ai rà | Trạng thái |
|---|---|---|---|
| `core/http`, `core/errors`, `core/logging`, `config`, `composition`, `main.ts` | A | B | Xong |
| `core/realtime` (Socket.io, redis-adapter) | A | B | Xong |
| `apps/web` | E | B | Xong |
| `modules/auth`, `modules/workspace` | **B** | **F đọc chéo** (người viết không tự chấm) | Xong: `docs/reviews/T-028-crossread-F.md` (branch `feat/T-028-crossread-F`). X1 sửa ở đây; X2–X9 ⇒ **T-032** (B) |
| `modules/task`: domain / application (main, T-018) + Prisma (`feat/T-023`, chưa merge) | C | B | Xong — đọc branch qua `git show`, findings gửi C trước merge |
| `modules/task`: HTTP + tenant guard + realtime (`feat/T-024`, chưa merge) | A | B | Xong — findings gửi A trước merge |
| Dependency (`pnpm audit --prod`) | — | B | Xong |

- Đọc code đã merge, mỗi vùng đọc end-to-end từ route tới DB.
- Mọi lỗi **High** đều được xác minh lại trước khi báo:
  - H1 bằng Node: `new URL` chuẩn hóa dot-segment;
  - H2 bằng cách đối chiếu code client với middleware server;
  - H3 bằng mã nguồn `@socket.io/redis-adapter` 8.3.0;
  - H4 bằng probe trên Postgres thật (`taskflow_t020`, ADR-106) qua chính `createLogger` của app. Script probe đã xóa, không commit.
- Lỗi High được báo Tech Lead ngay khi xác nhận, không đợi DONE (ticket mục 5).

## Findings

Mức độ theo ảnh hưởng × khả năng khai thác hiện tại. "Chủ" là module phải sửa. Lỗi module của người khác ⇒ chỉ báo Tech Lead, không tự sửa.

### High

| ID | Lỗi | Bằng chứng | Kịch bản | Đề xuất sửa | Chủ / xử lý |
|---|---|---|---|---|---|
| **H1** | Open redirect sau login: `safeNextPath` kiểm `//` trên chuỗi thô, rồi trả `url.pathname` **sau** khi URL parser chuẩn hóa | `apps/web/src/shared/lib/safe-next-path.ts:7-14`; `app/gates/guest-gate.tsx:24` | `/.//evil.com`, `/..//evil.com`, `/a/..//evil.com`, `/%2e//evil.com` ⇒ pathname `//evil.com` ⇒ Next coi là URL ngoài, điều hướng cứng. User đã đăng nhập bấm `https://app/login?next=/.//evil.com/login` ⇒ sang trang phishing | Kiểm lại kết quả sau chuẩn hóa (cấm đầu `//`, `/\`), hoặc allow-list segment đầu; thêm test dot-segment/`%2e` | E — **T-029** |
| **H2** | Web gửi POST không body (refresh / logout / logout-all) **không có** `Content-Type: application/json` ⇒ API thật trả 415 ⇒ logout không kết thúc phiên phía server | `apps/web/src/shared/api/http.ts:70`; `entities/session/api/auth.api.ts:24-26`; `entities/session/model/session.ts:107`; server `core/http/middleware.ts:103-109` | UI báo đã đăng xuất, nhưng family refresh và cookie `tf_rt` còn sống tới 30 ngày (ASVS V7.4.1, nguy hiểm trên máy dùng chung). Refresh cũng 415. Lỗi bị che vì mock MSW không kiểm Content-Type | Luôn gửi Content-Type cho POST/PUT/PATCH; mock phải kiểm Content-Type/Origin như server; contract test | E — **T-029** |
| **H3** | `SOCKET_REDIS_ADAPTER=true` + Valkey chớp ⇒ process crash ở mọi thao tác realtime, mất thu hồi kể cả trên node cục bộ | `core/infrastructure/valkey.ts:8` (`disableOfflineQueue`); `core/realtime/redis-adapter.ts:20-21` (`duplicate`); adapter `dist/index.js:473,613,629` gọi `publish` không await/catch; `core/lifecycle/graceful-shutdown.ts:86` | Valkey offline ⇒ `publish` reject ⇒ unhandledRejection ⇒ `shutdown(1)`. Thao tác remote (`socketsLeave`, `disconnectSockets`) chỉ áp cục bộ khi nhận lại message của chính mình ⇒ xóa thành viên / logout-all không ngắt socket | Bọc `pub.publish` với `.catch(log)`; gateway gọi thêm `io.local…` để node cục bộ luôn thu hồi; integration test | A — **T-030, đã merge** (`3ae9b78`); rủi ro còn lại ghi ở security.md §5.4 |
| **H4** | Log lỗi Prisma chứa **email + password_hash** (nguyên dòng) | `core/http/error-handler.ts:86` log `err`; adapter-pg đưa `DETAIL` của Postgres vào `err.meta.driverAdapterError.cause.detail`; redact (`core/logging/pino-logger.ts:7-23`) theo key, không phủ được | Probe thật: vi phạm `users_email_lowercase_chk` ⇒ log có `"Failing row contains (<id>, <EMAIL>, $argon2id$…, …)"`. Mọi vi phạm CHECK/NOT NULL đều kèm dòng lỗi. `PrismaClientValidationError` in cả cây tham số. Hiện chưa thấy đường người dùng tự kích hoạt trên `users` (email qua `z.email()` + lowercase ở app), nhưng một bug validation tương lai là đủ | Serializer `err` theo allow-list cho lỗi Prisma (bỏ `detail` / `originalMessage` / message ValidationError); lọc mẫu email / `$argon2` / chuỗi dài cho lỗi không nhận diện; `details.debug` dùng cùng serializer; test với dòng lỗi thật | A — **T-031 mục 0** (Tech Lead xếp High) |

### Medium

| ID | Lỗi | Bằng chứng | Đề xuất | Chủ / xử lý |
|---|---|---|---|---|
| M1 | Kiểm charset (QA A5) vô hiệu: regex **mất toàn bộ dấu `\`** trong mã nguồn, `s` thành chữ "s" ⇒ `charset = utf-7` (có khoảng trắng) và mọi charset chứa chữ "s" lọt 415; body-parser vẫn giải mã UTF-7/16 | `core/http/middleware.ts:91` (đã kiểm từng byte) | Dùng `contentType.parse()` hoặc khôi phục `\s`; test có khoảng trắng | A — đã sửa trên `feat/T-024`, đóng khi merge |
| M2 | `/readyz` công khai, không rate limit, mỗi request 1 query trên pool chính (10 kết nối) + 1 Valkey PING ⇒ flood làm query user chờ pool, readyz 503 ⇒ LB rút mọi replica | `app.ts:67-73`; `core/http/health.ts:46-69`; `core/persistence/database.ts:18-28` | Chặn ở edge / cổng nội bộ, cache probe ~1s, hoặc pool riêng | A/devops — T-031 |
| M3 | Thiếu log sự kiện bảo mật (ASVS V16): access log không có IP/userId; log ngoài `req.log` không có reqId; event bus không có subscriber; không log login fail / logout-all / đổi role / xóa member | `core/http/middleware.ts:37-44`; `core/logging/pino-logger.ts:32-42` | Phần logger/access log ⇒ A. Phần sự kiện trong use case auth/workspace ⇒ B | A — T-031 · **B — đã sửa trên branch này (xem dưới)** |
| M4 | Limiter login theo email (50/giờ, key chỉ là hash email, chạy **trước** validate nên 400 cũng bị đếm) ⇒ biết email nạn nhân + khoảng 10 IP là khóa được mật khẩu đúng của họ 1 giờ, gia hạn mãi (trái §1.2 "không khóa cứng") | `core/http/rate-limit/rules.ts:48-55`; `modules/auth/presentation/auth.routes.ts:39` | — | Tech Lead quyết **ADR-108**: chỉ đếm 401, chạy sau validate, 100/giờ + bucket (IP, emailHash) 10/15 phút; rủi ro còn lại chấp nhận có chủ đích; CAPTCHA/backoff sau v1 |
| M5 | Socket `auth:renew` không rate limit, mỗi message khoảng 60 query (recheck 20 room) ⇒ một user có thể làm cạn pool DB | `core/realtime/socket-handlers.ts:120-164` | Throttle per-socket; bỏ qua recheck nếu vừa làm < 60s; ngân sách message qua `socket.use()` | A — **T-030, đã merge** (`3ae9b78`); rủi ro còn lại ghi ở security.md §5.4 |
| M6 | Form login/register trước hydration submit bằng GET ⇒ mật khẩu lên URL / history / access log proxy | `apps/web/src/features/auth-login/ui/login-form.tsx:36`; `features/auth-register/ui/register-form.tsx:39` | `method="post"` hoặc disable nút submit tới khi mount | E — **T-029** |
| M7 | Web: thiếu `APP_ENV` ⇒ mặc định `local` (fail-open) ⇒ không HSTS / upgrade-insecure-requests, có thể bật mock API trong image production | `apps/web/src/app/config/server-env.ts:17`; `app/mock-api/mock-flag.ts:7-8`; `app/security/csp.ts:28,54,66` | Bắt buộc APP_ENV khi NODE_ENV=production (như API); mock theo allow-list `{local, test}`; staging/prod bắt https cho API_URL/WS_URL | E — **T-029** |

### Low

| ID | Lỗi | Bằng chứng | Chủ / xử lý |
|---|---|---|---|
| L1 | Hardening production của API phụ thuộc `NODE_ENV`, không phải `APP_ENV` ⇒ `APP_ENV=production` + `NODE_ENV=development` khởi động với secret `change-me`, cookie không Secure, CORS http, stack trace trong 500. `TRUST_PROXY_HOPS` không ràng buộc ở prod | `config/env.ts:71-85`; `app.ts:32-33` | A/devops — T-031 |
| L2 | Limiter change-password fail-**open** khi Valkey chết ⇒ người cầm access token trộm được thì dò được mật khẩu hiện tại | `core/http/rate-limit/rules.ts:65-73` | Tech Lead quyết: chuyển fail-closed |
| L3 | Lỗi do client gây ra thành 500 + log mức error: path `%E0%A4%A` (URIError), body-parser `request.aborted` / `size.invalid` ⇒ bất kỳ user nào cũng làm ngập alert được | `core/http/error-handler.ts:21-62` | A — T-031 |
| L4 | Response có xác thực chứa PII (members kèm email) thiếu `Cache-Control: no-store` | chỉ có ở `auth.routes.ts:18-21`, `health.ts` | A — T-031 |
| L5 | Access log ghi nguyên query string ⇒ `?q=<email>` của tìm member lọt vào log | `core/http/middleware.ts:38` | A — T-031 |
| L6 | Socket: không giới hạn số kết nối đồng thời theo user/IP; ngân sách join reset khi reconnect | `core/realtime/socket-handlers.ts:59`; `rules.ts:121-123` | A — T-030 (gợi ý) |
| L7 | Socket: rời mạng giữa `await` của join/renew ⇒ entry room "ma" + timer giữ socket chết (rò bộ nhớ chậm) | `socket-handlers.ts:85-90,141,145` | A — T-030 (gợi ý: `if (!socket.connected) return` sau mỗi await) |
| L8 | Socket: cửa sổ race thu hồi (handshake ‖ logout-all; project mới ‖ xóa member); `recheckRooms` fail-open. Mỗi cửa sổ bị chặn trên bởi TTL access 15 phút | `core/realtime/gateway.ts:95-111`; `socket-handlers.ts:157-159`; `remove-member.use-case.ts:51` | A (realtime) — T-030; phần remove-member của B: theo dõi |
| L9 | Chạy nhiều instance mà không bật redis-adapter không bị chặn ⇒ logout-all / xóa member không ngắt socket ở node khác | `config/env.ts:49`; `main.ts:88` | A/devops — T-031 |
| L10 | Web không bắt https/wss cho `API_URL` / `WS_URL` ở staging/prod | `apps/web/src/app/config/server-env.ts:12-16` | E — T-029 (gộp M7) |
| L11 | Access token nằm trong cache mutation của React Query 5 phút (lệch W-TOKEN-1; không tăng khả năng khai thác vì XSS đã đọc được bằng đường khác) | `features/auth-login/model/use-login.ts:9` và tương tự | E |
| L12 | ESLint chưa cấm `no-eval`, `no-new-func`, `react/jsx-no-script-url` (W-XSS-1); hiện chưa có vi phạm, CSP prod vẫn chặn eval | `packages/config/eslint/index.js:222-237` | Tech Lead / packages/config |
| L13 | Logout có thể race với refresh đang bay ⇒ token mới ghi lại vào store sau `end()` | `apps/web/src/entities/session/model/session.ts:36-39,107-110` | E — cần kiểm thêm |
| L14 | Cookie tossing: `RefreshCookie.read` lấy cookie **đầu tiên** trùng tên ⇒ subdomain anh em đặt `__Secure-tf_rt; Domain=…; Path` hẹp hơn ⇒ nạn nhân bị đăng nhập vào phiên của kẻ tấn công | `modules/auth/presentation/refresh-cookie.ts:42-55` (trước khi sửa) | **B — đã sửa** |

### Info

- `/healthz` lộ `gitSha`. Repo công khai nên map được sang commit cụ thể. Có chủ đích (devops.md), cân nhắc chặn ở edge.
- Limiter toàn cục chọn bucket theo việc **có header** `Authorization`: gửi `Authorization: x` nâng bucket lên 1000/phút. Route nhạy cảm đều có limiter riêng.
- `X-Request-Id` từ client được tin (chỉ UUID ⇒ không log injection được, nhưng có thể làm rối truy vết).
- Body 404 có `details.resource`, lệch §4.2; không lộ sự tồn tại.
- Valkey không có timeout theo lệnh.
- `SENTRY_DSN` / `METRICS_TOKEN` bắt buộc ở prod nhưng chưa wire.
- Kênh pub/sub Socket.io dùng key mặc định `socket.io`: ai có quyền PUBLISH trên Valkey đều giả được event. Cần key theo môi trường + ACL Valkey.
- Socket: lỗi xác thực handshake/renew không được log.
- Nonce CSP nằm trong payload RSC. Rủi ro tối thiểu.
- Đổi mật khẩu ở một tab đăng xuất cả tab đó (an toàn, chỉ là vấn đề UX).

## Đã sửa trên `feat/T-028` (module của B, có test)

| Commit | Nội dung |
|---|---|
| `fix(T-028): reject ambiguous refresh cookie` | **L14:** nhiều cookie refresh trùng tên ⇒ coi như không có ⇒ `401 REFRESH_TOKEN_INVALID` + xóa cookie. Test `refresh-cookie.test.ts` (1 cookie, rỗng / sai mã, tên gần giống, 2 cookie trùng tên). |
| `feat(T-028): security event logs …` | **M3 (phần B), tên sự kiện theo kiểu `<miền>.<sự_kiện>` như `refresh.reuse_detected` / `workspace.restored`:** `auth.login_failed` (warn, `userId` hoặc `null` + `ip`, **không email**); `auth.logout_all`; `auth.password_changed` (`userId`, `ip`); `refresh.reuse_detected` thêm `ip` + `userAgent` (§1.4); `member.role_changed` (`from` / `to`, `actorId`); `member.removed`. Tất cả ghi **sau commit**, rollback ⇒ không có sự kiện. Test `security-events.test.ts` ở cả 2 module; REF-04 kiểm thêm ip/ua. |
| (cùng commit) | Controller đặt trường server suy ra (`userId`, `meta`) **sau** `...body`. Hiện an toàn nhờ `z.strictObject`; sửa để body không bao giờ ghi đè được. |

**DoD phần sửa** (exit code từng lệnh):
- `vitest` auth + workspace: exit 0, 365 test;
- `pnpm --filter @taskflow/api typecheck`: exit 0;
- `pnpm lint`: exit 0, depcruise sạch;
- pre-commit gitleaks + prettier + eslint: xanh.

**Ghi chú:** gitleaks từng chặn chuỗi mật khẩu sai trong test (`password: '…'`). Đã đổi test, không dùng `--no-verify`.

## Bảng kiểm ASVS 5.0 L2 / security.md

Đ = Đạt · K = Không đạt (xem finding) · N/A = không áp dụng · ⏳ = chưa rà (chờ).

| Mục | Yêu cầu | Bằng chứng | KQ |
|---|---|---|---|
| V3.4 / §6.1 | Header bảo mật API: CSP `default-src 'none'; frame-ancestors 'none'`, nosniff, Referrer-Policy, CORP, không `x-powered-by` | `core/http/middleware.ts:62-71`; `app.ts:62` | Đ |
| V3.4 | HSTS 1 năm + includeSubDomains, chỉ staging/prod | `middleware.ts:67-69`; `app.ts:33` | Đ (phụ thuộc APP_ENV — L1) |
| V3.5 / §6.3 | CORS: whitelist so khớp chính xác, không phản chiếu, `null` không thể vào whitelist | `middleware.ts:73-81`; `config/env.ts:21-29` | Đ |
| V3.5 / §6.3 | CSRF endpoint cookie: Origin ∈ whitelist, thiếu Origin ⇒ 403 | `middleware.ts:120-126`; `auth.routes.ts:40-41` | Đ |
| V3.3 / §2.3 | Cookie refresh: HttpOnly, Secure, SameSite=Strict, Path hẹp, không Domain, tiền tố `__Secure-` | `modules/auth/presentation/refresh-cookie.ts:22-30` | Đ (cookie tossing — L14 đã sửa) |
| V4.1 / §6.3 | POST/PUT/PATCH bắt buộc `application/json`; chỉ UTF-8 | `middleware.ts:98-109` | K (M1) |
| V4.1 / §6.7 | Body 100kb, `strict`, không urlencoded; lỗi 413 / JSON không nhắc lại input | `app.ts:34`; `middleware.ts:112-114`; `error-handler.ts:30-38` | Đ |
| V2.2 / V15.3 | Chống mass assignment: mọi body `z.strictObject`; `validate()` thay `req.*` bằng output đã parse | `packages/contracts/src/*/…schemas.ts`; `core/http/validate.ts:28-46` | Đ |
| V15.3 | Prototype pollution (`__proto__`) bị strictObject chặn | `core/http/compact.ts:71-75` | Đ |
| V8 / §4.2 | Thứ tự 401 → 400 (params) → 404 (membership) → 403 (permission) → 400 (body) | `modules/workspace/presentation/workspace.routes.ts:44-56` | Đ |
| V8 / §4.2 | 404 đồng nhất cho ws không tồn tại / không phải member / đã xóa mềm | `modules/workspace/application/workspace-access.ts:15-22` | Đ (F đọc chéo) |
| V6.3 / §6.4 | Rate limit đủ route nhạy cảm, chạy trước argon2 | `rules.ts:38-129`; `auth.routes.ts:35-57`; `workspace.routes.ts:44-92` | Đ (M4 → ADR-108) |
| §6.4 | Fail mode: login / register / refresh fail-closed | `core/http/rate-limit/store.ts:82-93` | Đ (L2: change-password chuyển closed) |
| §6.4 | Key IP sau trust proxy, IPv6 /56; email chuẩn hóa + băm | `rate-limit.ts:20-28` | Đ (cần xác nhận TRUST_PROXY_HOPS theo môi trường) |
| V16.5 | Lỗi không rõ ⇒ 500 thông điệp cố định; debug chỉ khi NODE_ENV≠production | `error-handler.ts:85-94` | Đ (L1, L3) |
| V16 | Log không chứa token / cookie / mật khẩu | `core/logging/pino-logger.ts:7-23` | **K (H4: lỗi Prisma)** |
| V16.2-3 | Log sự kiện bảo mật có ip / userId / reqId | xem M3 | K → phần B đã sửa; phần A ở T-031 |
| V13 | Secret prod: JWT ≥ 32 byte, cấm placeholder, cookie Secure, `rediss://`, CORS https, cấm lưu trữ bộ nhớ | `config/env.ts:9-85`; `composition/persistence.ts:99-112` | Đ (phụ thuộc NODE_ENV — L1) |
| V13 | Health không lộ chi tiết lỗi | `core/http/health.ts:42-56` | Đ (M2 về tải; gitSha — Info) |
| V7 / §2.5 | Xác thực access token: jose verify, `tv` + `sid-revoked`, fallback DB, fail-closed 503 | `modules/auth/application/access-token-authenticator.ts:42-96` | Đ (F đọc chéo) |
| V7.4.1 | Logout kết thúc phiên phía server | server: `logout.use-case.ts`; client: H2 | K (client — H2) |
| §5.1 / V4 WS | Token socket chỉ qua `handshake.auth`, không qua query | `core/realtime/gateway.ts:92-95` | Đ |
| §5.1 | Origin socket whitelist, thiếu Origin ⇒ từ chối trước auth; chỉ websocket | `gateway.ts:70-79` | Đ |
| §5.2 | Join room: Zod UUID, kiểm membership + project ∈ ws, kiểm lại sau join (TOCTOU), 30 join/phút, 20 room | `socket-handlers.ts:59-105`; `project-access-checker.ts:30-43` | Đ |
| §5.3 | Token hết hạn ⇒ `auth:expired` + ngắt; renew cùng `sub` | `socket-handlers.ts:36-52,120-148` | Đ (M5: thiếu throttle) |
| §5.4 | Thu hồi realtime: logout / reuse ⇒ `disconnectSession`; logout-all / đổi mật khẩu ⇒ `disconnectUser`; xóa member ⇒ `socketsLeave` — đều sau commit | các use case auth/workspace; `gateway.ts:127-158` | Đ một instance; **K đa instance khi Valkey lỗi (H3)** |
| §5.2 | Payload event chỉ tới `project:{id}`, không email / hash / token | `task-dto.ts:17-34` | Đ |
| V3.2 / W-XSS-1 | Không `dangerouslySetInnerHTML` / `innerHTML` / `eval` / href động; dữ liệu user chỉ render dạng text | grep `apps/web/src` | Đ (L12: rule ESLint) |
| W-CSP-1..4 | CSP nonce 128-bit mỗi request, `strict-dynamic`, không unsafe-inline/eval ở prod; `object-src`/`base-uri` none; `frame-ancestors` none | `apps/web/src/app/security/csp.ts:7-68`; `proxy.ts:11-34` | Đ |
| W-TOKEN-1 / ADR-026 | Access token chỉ ở biến module, không ở storage / URL / log; `credentials: include` chỉ cho `/auth/*` | `entities/session/model/token-store.ts:6-21`; `shared/api/http.ts:71-82` | Đ (L11) |
| Open redirect | `?next=` chỉ nhận đường dẫn cùng origin | `shared/lib/safe-next-path.ts` | **K (H1)** |
| W-MOCK | Mock API không bật được ở staging/prod | `app/mock-api/mock-flag.ts:7-8` | K khi thiếu APP_ENV (M7) |
| V14 | Không có dữ liệu nhạy cảm trong URL | form login/register | K (M6) |
| §4.1 / §3 | Query đọc của task (cursor, audit log) phạm vi tenant; IDOR qua taskId / anchor / assignee | `task.queries.ts`, `feat/T-023:…/prisma-task-read-model.ts`, `feat/T-024:…/task.routes.ts` | Đ (không IDOR; T-L2/T-L3/T-L4 là phòng thủ chiều sâu) |
| V8 / §3.2 | TaskPolicy khớp ma trận (ADR-022/041/044/045); 409 `details.current` chỉ sau 404/403 và cùng phạm vi | `task-commands.ts`, `workspace/domain/roles.ts:45-68` | Đ (T-L1 race archive) |
| §5.2 | Realtime task (`emitToProject` qua LateBoundRealtime, sau commit, chỉ `project:{id}`, UserRef không email) | `feat/T-024:composition/late-realtime.ts`; `task-realtime.ts` | Đ |
| — | Xóa / ẩn danh user (D2) ⇒ `disconnectUser`, thu hồi | — | N/A (chưa có use case) |
| V4 WS client | Client Socket.io: `withCredentials:false`, token trong `auth` | `apps/web` | N/A (chưa có client) |

## Dependency — `pnpm audit --prod`

```text
$ pnpm audit --prod   → exit 0
All found vulnerabilities were already reviewed and decided to be ignored
1 ignored: 1 high
```

| Advisory | Gói | Đánh giá khai thác thực tế |
|---|---|---|
| GHSA-vfj7-8cjw-p6xm (high, DoS khi glob lồng sâu) | `braces` ≤ 3.0.3, chưa có bản vá | Chỉ đi qua công cụ lint: `packages/config > @next/eslint-plugin-next > fast-glob > micromatch > braces`. **Không có trong image runtime**, và mọi pattern do repo tự viết ⇒ không có đường cho input của người dùng. Chấp nhận như quyết định đã ghi ở `pnpm-workspace.yaml:92-97`; xét lại 2026-11-15 hoặc khi có bản vá. |

Không có advisory nào khác đang mở cho dependency production.

## Module task (T-018 trên main; T-023 / T-024 chưa merge)

Không có Critical / High / Medium. Không có IDOR: tenant guard hai lớp đứng vững trên cả 8 route task. Findings gửi thẳng chủ code để sửa **trước khi merge** (cc Tech Lead).

| ID | Mức | Lỗi | Vị trí | Chủ |
|---|---|---|---|---|
| T-L1 | Low | Race lách luật archive (ADR-023/045): `loadProject` đọc project không khóa ⇒ update/move/assign/delete ‖ archive ⇒ sửa task trong project đã archive (create không bị — cấp số nguyên tử) | `task-commands.ts:59-78`; `PrismaTaskProjectStore.findInWorkspace` | C (+ B nếu thêm biến thể `FOR SHARE` ở port workspace) |
| T-L2 | Low | `save()` cập nhật không có phạm vi tenant (`where { id, version }`) — §4.1.2; chưa khai thác được | `feat/T-023:…/prisma-task.repository.ts:110`; in-memory tương tự | C |
| T-L3 | Low | `listAuditLogs` lọc chỉ theo `taskId` (§4.1.5); đang được `taskExists` có phạm vi che | `task-read-model.port.ts:40`; `feat/T-023:…/prisma-task-read-model.ts:123-129` | C |
| T-L4 | Low | Cursor tự chế với `id` không phải uuid ⇒ 500 (ASVS V2), ai cũng làm ngập alert được | `task.queries.ts:31-36` | C |
| T-L5 | Low | Mọi request task đi qua `authenticate` + limiter `api-user` **hai lần** (router workspace catch-all mount trước) ⇒ hạn thực tế 150/phút thay vì 300 (§6.4) | `feat/T-024:composition/container.ts:146-147`; `workspace.routes.ts:46` | A (B phối hợp router workspace) |
| T-L6 | Low | OWNER / PM gửi body assign / query delete sai ⇒ 403 thay vì 400 (permission tối thiểu `:own` mà OWNER / PM chỉ có `:any`) | `feat/T-024:…/task.routes.ts:61,67`; `task-membership.ts:68` | A |
| T-L7 | Low | Response task thiếu `Cache-Control: no-store` (ASVS V14.3.2) | `feat/T-024:…/task.controller.ts` | A (hoặc toàn cục — T-031 L4) |
| T-L8 | Low (cần kiểm) | `charset` lặp: middleware lấy cái **đầu**, body-parser lấy cái **cuối** ⇒ `charset=utf-8; charset=utf-16le` có thể lọt 415 | `feat/T-024:core/http/middleware.ts:89-93` | A |

**Info:**
- `edgeRank` / `rankBefore` / `rankAfter` và việc đọc lại trong `listAssignedForUpdate` không lọc workspace. An toàn vì đã kiểm trong cùng transaction.
- Domain không kiểm enum `priority`.
- Lỗi Prisma được ném nguyên ⇒ 500, và log mang detail (xem H4 / T-031).
- Validate body / query chạy trước 404 project / task. Không rò vì kết quả không phụ thuộc vào sự tồn tại.

## X1 — cookie tossing (F) ⇒ ADR-109

- F chỉ ra bản sửa L14 (`4faa10c`) bị vượt: `clear()` host-only xóa cookie **của nạn nhân**, cookie `Domain=` của kẻ tấn công ở lại ⇒ hoán đổi phiên. Nạn nhân không có cookie thì nhận ngay cookie kẻ tấn công.
- **Đã sửa trên `feat/T-028-task`:**
  1. Cookie trùng tên ⇒ refresh / logout thu hồi family của **mọi** giá trị rồi mới xóa.
  2. Quá 4 giá trị ⇒ 401 ngay, không thu hồi, không xóa (chặn khuếch đại; cookie nạn nhân còn nên vẫn "trùng").
  3. **ADR-109:** staging / production dùng `__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/`, không Domain. Server **chỉ** đọc tên này. Trình duyệt cấm `Domain=` với tiền tố `__Host-` ⇒ đóng cả lớp tấn công, kể cả kiểu "đặt lại token sống sau khi bị xóa" và tràn cookie jar mà F nêu.
- **Test:**
  - `cookie-tossing.http.test.ts`: trùng tên ⇒ mọi family chết; nạn nhân không cookie + cookie kẻ tấn công khác tên (`tf_rt` / `__Secure-tf_rt`) ⇒ 401; trần 4;
  - `auth.http.test.ts`: thuộc tính `__Host-` ở prod;
  - `refresh-cookie.test.ts`: chỉ đọc đúng tên;
  - `refresh-cookie-logging.test.ts`: header Cookie / Set-Cookie bị redact.
- **Tài liệu:** security.md §2.3, SEC-34; test-spec LOG-10.
- **Còn cập nhật (chủ tài liệu khác):** checklist `devops.md:620` (D) vẫn ghi `__Secure-tf_rt; Path=/api/v1/auth`; suite đen `test/security/auth.sec.ts:274` (F).

## Việc còn lại

1. **Lỗi đọc chéo X2–X9 của F** ⇒ ticket **T-032** (B):
   - ADR-110: version có điều kiện cho Workspace / Project;
   - X3: cache miss kiểm `sid-revoked` trong DB;
   - X4: `FOR SHARE` user trong transaction refresh;
   - X5–X9.
2. **C / A sửa T-L1…T-L8 trước khi merge T-023 / T-024.** Sau khi merge, rà lại nhanh phần diff.
3. **Kiểm thực tế còn treo (của người nhận ticket sửa):**
   - H3 bằng integration test (bật adapter, tắt Valkey);
   - `ipKeyGenerator` có ném lỗi với IPv6 zone-id (`fe80::1%eth0`) trong `allowRequest` của socket không (nếu có ⇒ uncaughtException);
   - L13 (logout ‖ refresh) trên API thật.
