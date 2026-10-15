# T-009 — Core kernel của API

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 1b · **Phụ thuộc:** T-008 đã merge

## Nguồn
DECISIONS (ADR-010..017, 028, 074, 081, 093, 095, 096) · `docs/design/security.md` (thứ tự kiểm tra lỗi, hardening) · `docs/design/data-and-api.md` §3 (envelope, mã lỗi) · `docs/design/devops.md` (env, logging, healthz/readyz, graceful shutdown) · `docs/design/test-spec-*.md` §0 (bộ fake: FakeUnitOfWork, FakeClock, FakeRandom, SpyRealtimeNotifier).

## Worktree
`../TaskFlow_wt/T-009`, branch `feat/T-009`.

## Việc cần làm (TDD — test trước)
1. `core/domain`: `BaseEntity`/`AggregateRoot` (domain events, pull), `IDomainEvent`, kiểu `Result` nếu cần, `Clock` & `IdGenerator` port (uuid v7).
2. `core/errors`: `AppError` + các lớp con cho **toàn bộ** danh mục `error.code` trong data-and-api §3.2; `globalErrorHandler` đa hình (không if/else theo loại), ZodError → VALIDATION_ERROR `{ issues: [{path, code, message}] }` không trả input (ADR-096), lỗi lạ → 500 không lộ stack ở prod.
3. `core/http`: helper envelope thành công (`meta.timestamp`, phân trang cursor), middleware `requestId`, pino-http (redact token/password/cookie), helmet, CORS whitelist + credentials, body limit, `validate(schema)` cho body/query/params.
4. `core/persistence`: `IUnitOfWork`/`ITransactionManager` bằng AsyncLocalStorage trên Prisma interactive transaction, hook `afterCommit()` (realtime chỉ chạy sau commit — ADR-012). Bản Fake cho unit test.
5. `core/events`: `IEventBus` + in-process bus; lỗi handler được **log**, không nuốt im lặng.
6. `config/env.ts`: Zod validate toàn bộ env (danh sách theo devops.md + security.md); prod mà `COOKIE_SECURE=false` ⇒ từ chối khởi động.
7. `app.ts` (composition root, nhận dependency từ ngoài) · `server.ts` (HTTP + chỗ gắn Socket.io sau này, graceful shutdown SIGTERM) · `/healthz`, `/readyz` (DB bắt buộc, Valkey không làm đỏ — ADR-074).
8. Prisma client factory với driver adapter `@prisma/adapter-pg` (đọc schema do C viết ở T-010; nếu T-010 chưa merge, dùng interface + để TODO, không tự viết schema).

## Phạm vi sở hữu
`apps/api/src/core/**`, `apps/api/src/config/**`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/support/**` (fakes dùng chung).

## Không làm
Module nghiệp vụ, Prisma schema (C), Docker/CI (D), auth adapter (B).

## Done
DoD trong TEAM.md; coverage `core/` ≥ 90%. Report `docs/reviews/T-009-report.md` trên branch. Nhắn `DONE T-009 feat/T-009`.
