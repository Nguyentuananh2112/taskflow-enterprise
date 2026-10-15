# T-021 — HTTP presentation cho Auth + Workspace/Member/Project + composition root

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 3 · **Phụ thuộc:** main ≥ e7dfb57 (T-014, T-015, T-016). Repo Prisma của B (T-020) đang làm song song.

## Nguồn
`docs/design/data-and-api.md` §2.1–2.6 (route, permission, request/response, mã lỗi) · `docs/design/security.md` (thứ tự kiểm 401→400→404→403→422→409, cookie `__Secure-tf_rt`/`tf_rt`, Origin trên refresh/logout, §6.4 rate limit theo endpoint) · DECISIONS (ADR-020, 021, 024–029, 081–083, 096, 098, 102, 103).

## Worktree
`../TaskFlow_wt/T-021`, branch `feat/T-021` từ `main`.

## Việc 0 — follow-up (commit riêng)
`core/http/zod.ts` + `core/errors` đang trùng locale và danh mục mã lỗi với `@taskflow/contracts` (C báo ở T-010): gõ kiểu `errorCode` bằng `ErrorCode` của contracts, dùng locale từ contracts; test parity mọi `AppError` con ↔ `ErrorCode` (không thiếu, không thừa).

## Việc chính
1. Middleware: `authenticate` (bọc `AccessTokenAuthenticator`, gắn `req.user` có kiểu — ADR-014), `loadMembership(wsId)` (404 khi không phải thành viên / ws đã xóa — ADR-020), `requirePermission(perm)` dùng ma trận của Workspace; rate limit `authenticated` theo user sau `authenticate`.
2. Controller + routes cho mọi endpoint Auth (register/login/refresh/logout/logout-all/me GET+PATCH/change-password) và Workspace/Member/Project theo §2.4–2.6, validate bằng **schema của contracts**, response bằng envelope. Controller **chỉ** gọi use case/query (ADR-015).
3. Cookie refresh: thuộc tính theo security.md (HttpOnly, SameSite=Strict, Path=/api/v1/auth, Secure + tiền tố `__Secure-` khi prod), kiểm Origin trên refresh/logout.
4. Composition root (`app.ts`/`main.ts` + `*.module.ts` mỗi module): wire use case ↔ repo. Repo dùng **factory chọn InMemory hoặc Prisma** — Prisma của B vào sau khi T-020 merge (để TODO rõ ràng nếu chưa có). Wire `socketAuthenticatorFrom(AccessTokenAuthenticator)` + `IProjectAccessChecker` của Workspace vào gateway (bỏ stub T-016).
5. Test HTTP (supertest) với InMemory: mọi route, mọi mã lỗi trong bảng §2, thứ tự kiểm lỗi, cookie, mass assignment (field lạ ⇒ 400 — SEC-57/58), IDOR chéo workspace trả 404.

## Phạm vi sở hữu
`apps/api/src/core/http/**`, `apps/api/src/core/errors/**`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/*/presentation/**`, `apps/api/src/modules/*/*.module.ts`.

## Phối hợp
B (T-020) sở hữu `modules/*/infrastructure/**` — không sửa. QA F (`taskflow-enterprise-bb`) có bộ test bảo mật đầu-cuối đang chờ route: báo F khi route chạy được để F bật các case PENDING-ROUTE.

## Done
DoD; mọi route trong §2.4–2.6 có test; F chạy được bộ SEC trên branch của bạn (dán kết quả). Nhắn `DONE T-021 feat/T-021`.
