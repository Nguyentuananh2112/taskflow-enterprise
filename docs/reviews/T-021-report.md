# T-021 Report — HTTP presentation cho Auth + Workspace/Member/Project + composition root

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Branch `feat/T-021` (worktree `D:\TaskFlow_wt\T-021`, base `main` @ 791f6fa)

## Definition of Done

```text
$ pnpm typecheck      config · contracts · api · web: Done                         [exit 0]
$ pnpm lint           prettier ✔ · eslint 0 lỗi
  apps/api lint:deps: ✔ no dependency violations found (212 modules, 822 dependencies cruised)
  apps/web lint:deps: ✔ no dependency violations found                           [exit 0]
$ pnpm test           Test Files 83 passed (83) · Tests 845 passed (845)  — chạy 2 lần liên tiếp đều xanh
$ pnpm build          api tsdown ✔ · web next build ✔                               [exit 0]
$ pnpm --filter @taskflow/api test:coverage   Statements 97.91% · Branches 94.27%  [exit 0]
```

## Việc 0 (commit riêng `4d9f075`)
- `AppError.code` có kiểu `ErrorCode` của contracts — **import type-only** (bị xóa khi biên dịch ⇒ domain ném AppError vẫn không phụ thuộc contracts lúc chạy, ADR-043). Bỏ danh sách `ERROR_CODES` trùng lặp.
- `validationErrorFromZod` dùng `toValidationIssues` của contracts; composition root gọi `applyVietnameseZodLocale()` của contracts (bỏ bản sao locale).
- Test parity: mỗi `ErrorCode` có **đúng một** lớp `AppError` (không thiếu, không thừa) + mọi lớp con `AppError` được export đều nằm trong catalog test.

## Việc chính (commit `081779c` + các commit sau)

| Mục | File | Ghi chú |
|---|---|---|
| `authenticate` | `modules/auth/presentation/authenticate.ts`, `core/http/request-user.ts` | Bọc `AccessTokenAuthenticator`; `req.user: { id, sid }` có kiểu qua `declare global namespace Express` (ADR-014) — khai báo ở **core** để module Workspace dùng mà không import auth. |
| `loadMembership` / `permit` | `modules/workspace/presentation/membership.ts` | `WorkspaceAccess.resolveActor` ⇒ 404 (không thành viên / ws xóa mềm — ADR-020/047); `permit(perm)` chặn sớm theo role (ADR-021) ⇒ 403 `{ required }`; Policy chi tiết vẫn trong use case. |
| Rate limit theo route | `auth.routes.ts`, `workspace.routes.ts` | login (3 lớp), register, refresh, logout, logout-all, change-password, PATCH me, add member, create/restore workspace; `RATE_LIMIT_RULES.authenticated` (300/phút/user) **sau** `authenticate`. |
| Controller + route | `modules/*/presentation/*.controller.ts`, `*.routes.ts` | Mọi endpoint §2.4–2.6, validate bằng **schema contracts**, response envelope; controller **chỉ** gọi use case/query (ADR-015). Cursor opaque ↔ `after`/`nextAfter` của query (`core/http/pagination.ts`, `kind` theo endpoint). `X-Client-Id` hợp lệ ⇒ `originClientId`. `compact()` bỏ key `undefined` cho `exactOptionalPropertyTypes`. |
| Cookie refresh | `modules/auth/presentation/refresh-cookie.ts` | security §2.3: `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, không Domain, `Max-Age` = thời gian còn lại; `COOKIE_SECURE` ⇒ `Secure` + `__Secure-tf_rt`, dev ⇒ `tf_rt`. Xóa = `Max-Age=0`. Refresh lỗi `REFRESH_TOKEN_INVALID` ⇒ xóa cookie; `REFRESH_IN_PROGRESS` giữ cookie. Origin ∈ whitelist bắt buộc trên `/refresh`, `/logout` (kiểm **trước** cookie). `/auth/*` trả `Cache-Control: no-store`. |
| Composition root | `modules/auth/auth.module.ts`, `modules/workspace/workspace.module.ts`, `src/composition/*`, `app.ts`, `main.ts` | Mỗi `*.module.ts` chỉ wire nội bộ module của nó; ghép **giữa** module ở `src/composition/` (ngoài `modules/` ⇒ dependency-cruiser cho phép): `AuthUserDirectory` (IUserDirectory của Workspace trên user repo của auth), `LateBoundRealtime` (notifier cho use case — gateway gắn sau khi có HTTP server), `createContainer` (dùng chung main + test). `main.ts` wire gateway với `socketAuthenticatorFrom(AccessTokenAuthenticator)` + `WorkspaceProjectAccessChecker` (**bỏ stub T-016**). |
| Factory lưu trữ | `src/composition/persistence.ts`, `in-memory-unit-of-work.ts` | `createMemoryPersistence()` (repo InMemory của B, không sửa infrastructure của B) + `InMemoryUnitOfWork` (rollback snapshot, **tuần tự hóa** transaction để rollback không ghi đè commit của request khác). `TODO(T-020 merge)`: `createPrismaPersistence` cùng hình dạng. **`main.ts` từ chối khởi động `NODE_ENV=production` với lưu trữ bộ nhớ.** |
| ADR-101 | `app.ts` | HSTS theo `APP_ENV ∈ {staging, production}`, không theo `NODE_ENV` (cờ `hsts` tách khỏi `production`). |

## Test (41 test HTTP mới, `apps/api/test/http/`)
- `auth.http.test.ts` (20): register 201 + DTO đúng khóa + cookie đủ thuộc tính (dev & `__Secure-`), 409 trùng email, 400 (mật khẩu ngắn/phổ biến, email sai), **SEC-57 mass assignment** (field lạ ⇒ 400, không phản chiếu mật khẩu), login 200 / 401 giống hệt cho sai mật khẩu & email lạ, login rate limit 6 lần sai ⇒ 429 + Retry-After, Origin thiếu/lạ ⇒ 403 trên refresh/logout, refresh xoay vòng + **reuse ⇒ 401 + thu hồi cả family**, 409 REFRESH_IN_PROGRESS (giữ cookie), logout 204 idempotent, `/me` GET/PATCH (field lạ ⇒ 400), `TOKEN_EXPIRED`, logout-all làm chết access token (tv) + refresh, change-password 400 `INVALID_CURRENT_PASSWORD` / token mới, token cũ chết.
- `workspace.http.test.ts` (11): CRUD, slug 409/400, xóa mềm → 404 → `?deleted=true` → restore; restore bởi người ngoài ⇒ 404; **IDOR**: workspace của người khác trả 404 **giống hệt** uuid không tồn tại (GET ws/members/projects, PATCH); **thứ tự 401 → 400 uuid → 404 → 403 → 400 body**; member add/404 user/409; PM cấp PM ⇒ 403; MEMBER thêm ⇒ 403; `q` không phân biệt hoa thường; cursor opaque 2 trang; cursor của endpoint khác ⇒ 400 path `cursor`; LAST_OWNER 422; PM xóa OWNER 403; tự rời.
- `project.http.test.ts` (6): project mặc định (ADR-103), 201/409 keyPrefix/400 định dạng, MEMBER tạo ⇒ 403, **IDOR project workspace khác ⇒ 404 project**, archive idempotent ⇒ PATCH 422 `PROJECT_ARCHIVED`, lọc `archived`, unarchive; keyPrefix bất biến ⇒ 400.
- `realtime.http.test.ts` (4): gateway trên container thật — token thật kết nối, token rác bị từ chối; `project:join` dùng membership thật (ws khác ⇒ NOT_FOUND); **`POST /auth/logout-all` ngắt socket đang mở**; xóa thành viên qua HTTP ⇒ `workspace:access-revoked` (actorId đúng).
- **Kiểm tra đột biến**: bỏ tenant guard trong `loadMembership` ⇒ 5 test đỏ (IDOR, thứ tự, Policy); bỏ `permit` ⇒ test thứ tự (403 trước 400 body) đỏ. Đã khôi phục.

## Kết quả bộ SEC của QA F trên branch này (hộp đen: spawn đúng `src/main.ts` của worktree, Valkey 6380/db15)

Lần chạy 1 @ 061976b (nguyên văn tóm tắt của F):
- **PASS (13)**: SEC-01 (IDOR ws khác ⇒ 404, body giống ws không tồn tại) · SEC-18 (reuse refresh >10s ⇒ 401, family thu hồi, access của sid 401) · SEC-21 (logout-all) · SEC-21c (race login‖logout-all ×20) · SEC-23b (race login‖change-password ×20) · SEC-25 (alg none / secret sai / sửa sub / thiếu tv / sai iss, aud) · SEC-29 (refresh Origin lạ/thiếu ⇒ 403, token không xoay) · SEC-30 (CORS, 11 case) · SEC-31 (413/415/bom gzip/JSON hỏng không phản chiếu) · SEC-33 (log không chứa password/token/cookie/authorization) · SEC-56 (WS Origin/polling, 7 case) · SEC-57 (PATCH /auth/me mass assignment) · SEC-58 (member search q=bob/%/_) + cổng T-016 bypass (2 case).
- **FAIL (2)** — đều đã sửa trên branch (mục "Sửa theo QA F"):
  - **SEC-40** (Medium): `InMemoryUnitOfWork.inTransaction` là cờ chung của instance ⇒ request B chạy lọt vào transaction của request A. Tái hiện: 5 register song song (email khác, cùng fullName) ⇒ 3×201 + 2×409 nhưng 2 user "409" vẫn đăng nhập được với memberships = [] (user mồ côi); biến thể 500 `AfterCommitOutsideTransactionError`; rollback của A xóa dữ liệu B.
  - **Finding A5** (Low, core/http): `Content-Type: application/json; charset=utf-7|utf-16le|utf-16be` được chấp nhận (body-parser nhận mọi `utf-*`); RFC 8259 yêu cầu UTF-8.
- **Không chạy được trên branch này**: `production.sec.ts` (main.ts từ chối InMemory ở production — đúng hành vi, chờ T-020); case cần task (SEC-02..12, 42..45) — chờ T-018.
- **F chưa viết thân test** (không tính pass/fail): SEC-13..17, 19, 20, 22, 23, 24, 26..28, 32, 34..39, 41, 46, 47, 51..55.

## Sửa theo QA F
1. **SEC-40** — `InMemoryUnitOfWork` dùng **AsyncLocalStorage** (như `PrismaUnitOfWork`): chỉ `run()` lồng trong CHÍNH chuỗi async mới dùng lại transaction; request khác xếp hàng; `afterCommit` đọc hook từ store của chuỗi async. Test mới: `composition/in-memory-unit-of-work.test.ts` (2 `run` song song — cái sau không chạy trước khi cái đầu xong; rollback của cái đầu không xóa dữ liệu cái sau; `afterCommit` lạc chuỗi ⇒ lỗi) + `auth.http.test.ts` "5 register song song ⇒ 5×201, mỗi người có workspace OWNER". **Chạy lại trên bản cũ**: test HTTP cho `[201, 409, 409, 409, 409]`, test đơn vị đỏ 2/4 ⇒ test thật sự bắt lỗi.
2. **A5** — `requireJsonContentType` (core/http, thuộc phạm vi T-021): `application/json` chỉ chấp nhận không có `charset` hoặc `utf-8`/`utf8` (kể cả có nháy, hoa/thường); charset khác ⇒ 415, áp cả DELETE có body. Test `app.test.ts`: utf-7/utf-16le/UTF-16BE/iso-8859-1 ⇒ 415; 3 dạng UTF-8 hợp lệ ⇒ chấp nhận.
DoD sau sửa: typecheck / lint (api 213 module, 0 vi phạm) / **test 84 file, 858 test** / build — exit 0; coverage API 98.07% stmts / 94.56% branches.

## Quyết định tự đưa ra (có thể bác)
1. **Body/query validate SAU kiểm quyền** (403 trước 400 body): người không có quyền không học được luật validate. Params (uuid) vẫn validate trước (400 trước 404 — data-and-api §2.2).
2. Ghép giữa module ở `src/composition/` (thư mục mới, ngoài danh sách sở hữu nhưng là composition root của ticket) — `*.module.ts` trong `modules/` không thể import nội bộ module khác (dependency-cruiser `module-public-api-only`).
3. `InMemoryUnitOfWork` tuần tự hóa transaction (chỉ chế độ dev/bộ nhớ) — đúng đắn hơn hiệu năng.
4. `ITaskAssignmentCleaner` tạm trả `0` (chưa có module Task — T-018) ⇒ `unassignedTaskCount` luôn 0.
5. Refresh trả `AuthTokenDto` (không kèm `user`) đúng bảng §2.4.
6. Chế độ bộ nhớ: query thành viên InMemory của B đọc tên/email từ bản sao riêng ⇒ `MirroringUserRepository` phản chiếu mọi lần ghi user của auth (Prisma join bảng users nên không cần).
7. Test API: `testTimeout`/`hookTimeout` 20s — lần gọi HTTP đầu mỗi file nạp cả app; chạy 80+ file song song trên máy bận đo được 7–11s (> 5s mặc định) ⇒ flaky.

## Rủi ro / việc để lại
- **Chưa chạy được production**: chờ repository Prisma + session store Valkey của B (T-020) — `createPrismaPersistence` + đóng `prisma.$disconnect()` trước `pool.end()`.
- 404 route không tồn tại có `details.resource = "route"` — `NotFoundDetails` của contracts chưa có giá trị `route` (đề xuất C thêm, hoặc bỏ details cho route).
- Job purge workspace (ADR-095) chưa được lên lịch — chưa có scheduler (devops §7.4).
