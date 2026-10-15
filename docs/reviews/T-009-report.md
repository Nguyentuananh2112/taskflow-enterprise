# T-009 Report — Core kernel của API

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Branch `feat/T-009` (worktree `D:\TaskFlow_wt\T-009`)

## Kết quả Definition of Done (Windows 11, Node 24.18, pnpm 11.28.2)

```text
$ pnpm install --frozen-lockfile                                   [exit 0]
$ pnpm typecheck      config · contracts · api · web: Done          [exit 0]
$ pnpm lint           prettier ✔ · eslint 0 lỗi
  apps/api lint:deps: ✔ no dependency violations found (82 modules, 160 dependencies cruised)
  apps/web lint:deps: ✔ no dependency violations found (12 modules, 10 dependencies cruised)
                                                                    [exit 0]
$ pnpm test           Test Files 24 passed (24) · Tests 295 passed (295)   [exit 0]
$ pnpm build          api: tsdown → dist/main.js ✔ · web: next build ✔      [exit 0]

$ pnpm --filter @taskflow/api test:coverage   (ngưỡng src/core/**: lines/stmts/funcs 90, branches 85)
All files          | Stmts 98.01 | Branch 94.92 | Funcs 96.53 | Lines 98.90
 src/core/http     |       96.82 |        92.77 |       94.23 |       97.45
 src/core/lifecycle|       97.82 |        83.33 |       93.75 |      100.00
 src/core/persistence |   100.00 |        92.85 |      100.00 |      100.00
 src/core/events   |      100.00 |        87.50 |      100.00 |      100.00
 core/infrastructure |     95.00 |       100.00 |       90.90 |       94.11
 (core/domain, core/errors, core/logging, config: 100%)              [exit 0 — đạt ngưỡng]
```

**Chạy thật** (`tsx src/main.ts`, env dev):
- Không DB, không Valkey: `/healthz` 200 `{status:"ok",gitSha}` · `/readyz` **503** `{"db":"down","valkey":"degraded"}` · route lạ 404 envelope `RESOURCE_NOT_FOUND` · lỗi Valkey chỉ log 1 lần (throttle) · log không chứa secret.
- **Valkey 9.1.2 thật** (`127.0.0.1:6380`, ADR-097): `valkey.ready`, `/readyz` `{"db":"down","valkey":"ok"}`; preflight CORS từ `http://localhost:3001` được phép.
- Thiếu env: in `Biến môi trường thiếu hoặc không hợp lệ: DATABASE_URL, JWT_ACCESS_SECRET` (chỉ tên) rồi exit 1.

## Đã làm (TDD: mỗi phần có test cùng thư mục `*.test.ts`)

| Mục ticket | File | Ghi chú |
|---|---|---|
| 1. `core/domain` | `domain/aggregate-root.ts`, `domain-event.ts`, `ports.ts` | `Entity` (equals theo lớp+id), `AggregateRoot` (`addDomainEvent`, `pullDomainEvents` trả rồi xóa), `IDomainEvent`, port `IClock`, `IIdGenerator`, `IRandom`. Không dùng `Result` — lỗi nghiệp vụ đi bằng exception có kiểu (đủ cho thứ tự kiểm tra 404→403→422→409). |
| 2. `core/errors` | `errors/*.ts` | `AppError` + **21 lớp cho đủ 21 code** của data-and-api §3.2 (test catalog khẳng định `ERROR_CODES` ↔ lớp 1-1). Mỗi lớp tự mang `statusCode`/`code`/`details`/`headers` (`RateLimitedError` → `Retry-After`). Không import zod/express/contracts ⇒ domain được ném. |
| 2. Error handler | `http/error-handler.ts` | Chuỗi `ErrorTranslator` (AppError → ZodError → lỗi body-parser) thay if/else; lỗi lạ → `InternalError` 500, message cố định; `details.debug` chỉ khi không production. 5xx log `error` kèm nguyên nhân. ZodError → `VALIDATION_ERROR {issues:[{path,code,message}]}` **không có input** (ADR-096, test bằng mật khẩu giả). |
| 3. `core/http` | `envelope.ts`, `cursor.ts`, `validate.ts`, `middleware.ts`, `zod.ts` | `HttpResponder.ok/created` (meta.timestamp từ `IClock`, requestId từ AsyncLocalStorage, `meta.page`); cursor opaque base64url gắn `kind` (dùng sai endpoint ⇒ 400 trên `cursor`); `validate({params,query,body})` thay giá trị đã parse (Express 5 `req.query` getter ⇒ ghi đè bằng own property); requestId (giữ uuid của client, không thì sinh) + pino-http + ALS; helmet/CORS đúng security §6.2–6.3; 415 cho POST/PUT/PATCH không `application/json` (kể cả không body); body 100kb ⇒ 413; `requireAllowedOrigin` cho endpoint cookie (B dùng ở Phase 2); locale `vi` của Zod (ADR-081). |
| 4. `core/persistence` | `unit-of-work.ts`, `prisma-unit-of-work.ts`, `database.ts` | `IUnitOfWork` (= `ITransactionManager`): `run(work, {isolationLevel})`, `afterCommit(hook)`, `inTransaction`. `PrismaUnitOfWork<TDb>` trên interactive transaction + ALS: `db()` trả tx hoặc client gốc; lồng nhau dùng lại tx ngoài; hook chỉ chạy sau commit, tuần tự, lỗi hook được log không đổi kết quả (ADR-012); `afterCommit` ngoài `run` ⇒ ném lỗi lập trình. Pool `pg` dùng chung (Prisma adapter + readiness), `createPrismaClient(PrismaClient, pool)` nhận lớp client sinh ra qua tham số. |
| 4. Fake | `test/support/fake-unit-of-work.ts` | Ghi `begin/commit/rollback`, rollback InMemory repo bằng `Snapshottable`, hook sau commit. |
| 5. `core/events` | `events/event-bus.ts` | `IEventBus` + `InProcessEventBus`: handler tuần tự; lỗi được **log** (eventType, aggregateId, tên handler) rồi chạy tiếp. |
| 6. `config/env.ts` | | Toàn bộ biến devops §2.2 + `READINESS_DRAIN_MS`; production: `COOKIE_SECURE=true` (sai ⇒ không khởi động), `rediss://`, CORS https-only, secret không `change-me`/`test-only-` (security §6.9), `APP_ENV` staging/production, bắt buộc `SENTRY_DSN`, `METRICS_TOKEN`. `EnvValidationError` chỉ chứa **tên** biến. |
| 7. Composition root | `app.ts`, `server.ts`, `main.ts` | `createApp(deps)` — mọi phụ thuộc truyền vào (ADR-016), thứ tự middleware security §6.1, router nghiệp vụ gắn `/api/v1`. `server.ts`: HTTP server (`keepAliveTimeout` 65s > idle LB) + chỗ gắn Socket.io. `main.ts`: env → logger → pool → Valkey (kết nối nền, không chặn khởi động) → app → lifecycle. |
| 7. Health | `http/health.ts` | `/healthz` (không chạm DB/Valkey), `/readyz`: probe có timeout (DB 1s critical, Valkey 500ms non-critical ⇒ `degraded`), shutting down ⇒ 503 (ADR-074). |
| 7. Graceful shutdown | `lifecycle/graceful-shutdown.ts` | devops §7.3: cờ shutdown → drain → `server.close` + closer `realtime` (Socket.io sau này) → chờ request đang chạy → `resources` theo thứ tự → exit; hạn chót `SHUTDOWN_TIMEOUT_MS` ⇒ `shutdown.forced` exit 1; gọi lần 2 no-op; SIGTERM/SIGINT ⇒ 0, `unhandledRejection`/`uncaughtException` ⇒ log fatal, exit 1. |
| 8. Prisma factory | `persistence/database.ts` | T-010 chưa merge ⇒ không tự viết schema; factory nhận lớp `PrismaClient` qua tham số; `TODO(T-010 merge)` trong `main.ts` chỉ chỗ wire. |

Fake dùng chung (`test/support`, có test riêng `support.test.ts`): `FakeClock`, `SequentialIdGenerator`, `FakeRandom`, `FakeUnitOfWork` + `Snapshottable`, `SpyEventBus`, `SpyLogger`, `createSpy<T>(uow)` (= `createSpyRealtimeNotifier`, ghi `duringTransaction` để khẳng định realtime chỉ chạy sau commit), `testEnvVars`/`productionEnvVars`, `envelopeOf`/`errorOf` (đọc `res.body` có kiểu).

## Lỗi thật test bắt được

- **Graceful shutdown treo 65s**: `server.close()` chỉ đóng kết nối keep-alive đang nhàn rỗi *tại lúc gọi*; kết nối vừa trả xong request đang chạy giữ server mở tới `keepAliveTimeout` ⇒ mọi lần deploy sẽ rơi vào `shutdown.forced`. Sửa: quét `closeIdleConnections()` mỗi 50ms đến khi server đóng (test "request đang chạy vẫn 200, exit 0" giờ chạy ~0.2s).
- Test kiến trúc ESLint của T-008 timeout `beforeAll` (10s mặc định) khi máy bận ⇒ thêm `hookTimeout: 60_000` (`packages/config/vitest.config.ts`).

## Phối hợp

- **B (T-014)**: commit sớm interface lúc 10:28 (`19bb795`, sau rebase thành `111434d` — cùng nội dung); B đã merge, 206 test xanh. Chữ ký B dùng (AggregateRoot, IClock, IIdGenerator, core/errors, IUnitOfWork/afterCommit, IEventBus, fake) **không đổi** sau đó.
- **Thống nhất với B về JWT secret** (theo T-013 đã merge + security.md §2.1): secret là **chuỗi ≥ 32 byte UTF-8** (khóa = `TextEncoder().encode(secret)`), `kid` do adapter suy từ secret ⇒ **bỏ `JWT_ACCESS_KID`/`_PREVIOUS`**. ⚠️ devops.md §2.2 còn ghi "base64 + `JWT_ACCESS_KID`" — cần D sửa tài liệu + `.env.example` (đề xuất placeholder `JWT_ACCESS_SECRET=change-me-min-32-bytes…` như security §6.9).
- ADR-097: `CORS_ORIGINS` mặc định `http://localhost:3001` ngoài production. ⚠️ Thực tế trên máy: `5433` đang là container `t010-pg` của C; compose của D publish Postgres ở `5435` (dev) / `5434` (test) — khác ADR-097, Tech Lead/D xem lại.

## Sửa ngoài phạm vi sở hữu (Tech Lead duyệt khi merge)

| File | Lý do |
|---|---|
| `pnpm-workspace.yaml` (catalog), `apps/api/package.json`, `pnpm-lock.yaml` | Thêm `pino`, `pino-http`, `helmet`, `cors`, `pg`, `@prisma/adapter-pg`, `redis`, `supertest`, `@vitest/coverage-v8` + `@types/*` (TEAM.md luật 3). Đã gộp với `@node-rs/argon2`, `jose` của T-013 khi rebase (lockfile tạo lại). Script `dev` thêm `--env-file-if-exists=.env`, thêm `test:coverage`. |
| `apps/api/vitest.config.ts` | Ngưỡng coverage `src/core/**`. Dùng `defineConfig` (coverage chỉ cấu hình được ở config gốc — Vitest bỏ qua `coverage` trong project) ⇒ CI (D) chạy `pnpm --filter @taskflow/api test:coverage` để áp ngưỡng. |
| `apps/api/src/main.ts` | Entry point phải đổi theo app/server mới (không có trong danh sách sở hữu). |
| `apps/api/test/healthz.test.ts` (xóa) | Test T-008 cho `createServer` cũ — thay bằng `src/app.test.ts`. |
| `packages/config/vitest.config.ts` | `hookTimeout` (xem trên). |

## Quyết định tự đưa ra (có thể bác)

1. UUID v7 bằng `crypto.randomUUIDv7()` có sẵn từ Node 24.16 — không thêm thư viện. Thứ tự trong cùng mili giây là ngẫu nhiên (RFC 9562 cho phép); không dùng id để sắp xếp.
2. `afterCommit` hook được `await` tuần tự sau commit (lỗi chỉ log) thay vì bắn rời — đơn giản, xác định cho test; chi phí là thời gian emit Socket.io (rất nhỏ) cộng vào response.
3. Lỗi xác thực body (`issues[].path`) **không** có tiền tố `body`/`query`/`params` — FE map thẳng vào field form. Cursor sai báo `path: ['cursor']`, code `invalid_cursor` (data-and-api §3.1 ghi `details.field="cursor"` — kiểu cũ, nay theo khuôn `issues`).
4. Route không tồn tại ⇒ `404 RESOURCE_NOT_FOUND` với `details.resource = "route"` (thêm giá trị `route` vào danh sách resource).
5. `/healthz`, `/readyz` trả body thô (không envelope) — cho LB/Docker/uptime monitor; không log ở mức info.
6. Valkey: `disableOfflineQueue: true` (lệnh thất bại ngay khi mất kết nối ⇒ rate limit fail-open/closed rõ ràng ở Phase 2), reconnect backoff tới 5s, log lỗi tối đa 1 lần/30s.
7. 415 áp cho POST/PUT/PATCH kể cả không có body (security §6.3 "buộc preflight"); DELETE không cần Content-Type.

## Rủi ro / việc để lại

- **PrismaUnitOfWork chưa test với Postgres thật** — cần client sinh từ schema T-010. Đã test đầy đủ hành vi bằng `$transaction` giả (commit/rollback/lồng nhau/song song/ALS). Integration test (rollback thật, afterCommit sau commit thật, pool qua PgBouncer) thuộc Phase 3 khi T-010 + T-011 merge.
- SIGTERM thật không kiểm được trên Windows (Node không nhận SIGTERM ở Windows) — logic đã test bằng process giả + HTTP server thật; T-011 nên thêm smoke test `docker stop` (devops §7.3).
- Rate limit toàn cục (security §6.4) chưa gắn — để `TODO(Phase 2, B)` đúng vị trí trong `app.ts`.
- Đề xuất dependency-cruiser (packages/config — ngoài phạm vi): coi `core/http`, `core/persistence`, `core/infrastructure`, `core/lifecycle` là tầng hạ tầng để luật `domain-is-pure` chặn domain import chúng (hiện ESLint đã chặn domain import express/prisma/pino trực tiếp).

## Câu hỏi mở

1. Duyệt bỏ `JWT_ACCESS_KID` + secret dạng chuỗi (đã thống nhất với B)? Nếu duyệt, ai sửa devops.md §2.2?
2. Cổng Postgres local thực tế (5433 vs 5434/5435) — ADR-097 hay compose của D đúng?
