# DECISIONS — Blueprint v1.1 (ghi đè v1.0)

Chủ sở hữu: Tech Lead (session `taskflow-enterprise-0b`). Chỉ Tech Lead được sửa file này.
Agent nào thấy cần đổi một quyết định → ghi đề xuất vào báo cáo ticket, KHÔNG tự sửa.

Trạng thái: ✅ Đã chốt · 🟡 Chờ nghiên cứu Phase 0 xác nhận

## Bối cảnh sản phẩm
- ADR-000 ✅ **Mục tiêu: chạy production thật.** Một instance backend ở giai đoạn đầu, nhưng không được chặn đường scale ngang (không giữ state quan trọng trong RAM).

## Repo & công nghệ
- ADR-001 ✅ **pnpm monorepo**: `apps/api` (Express), `apps/web` (Next.js), `packages/contracts` (Zod schema + types dùng chung FE/BE), `packages/config` (eslint/tsconfig chung). Thay cho `backend/` + `frontend/` của v1.0.
- ADR-002 ⛔ (THAY BỞI ADR-060) **Phiên bản ổn định mới nhất**: Next.js 16, Express 5, Zod 4, Prisma 7, Socket.io 4.x, TypeScript 5.x, Node 24 LTS, PostgreSQL 17/18, Redis 7/8. Con số chính xác + breaking changes do T-001 xác nhận → `docs/research/stack-versions.md`.
- ADR-003 ✅ Test: Vitest (unit + integration), Postgres thật qua Docker cho integration, Playwright cho E2E, k6 cho tải.
- ADR-004 ✅ Quy tắc kiến trúc phải được **máy ép**: ESLint `max-lines` (component 150, backend class 200), `no-restricted-imports` (domain cấm prisma/express/redis/socket.io/zod-infra), `dependency-cruiser` cho ranh giới tầng & module. Lint đỏ = không merge.

## Sửa lỗi code mẫu v1.0
- ADR-010 ✅ Optimistic locking thật: `updateMany({ where: { id, version: expectedVersion } })`; `count === 0` → `ConflictError` (409, code `VERSION_CONFLICT`). Client gửi `expectedVersion` khi PATCH.
- ADR-011 ✅ Sắp xếp: `rank String` (thư viện `fractional-indexing`, collation "C") thay `positionIndex Float`. Task mới vào cuối cột. Kéo thả gửi `{ beforeId?, afterId? }` hoặc rank do server tính — server là nguồn sự thật.
- ADR-012 ✅ Audit log ghi **trong cùng transaction** với thay đổi task (qua `IUnitOfWork`/`ITransactionManager` dùng AsyncLocalStorage). Realtime broadcast **sau commit**, fire-and-forget, có log lỗi. Không còn `Promise.allSettled` nuốt lỗi im lặng.
- ADR-013 ✅ Domain events đủ bộ: `TaskCreated`, `TaskStatusChanged`, `TaskMoved`(đổi rank), `TaskAssigneeChanged`, `TaskUpdated`, `TaskDeleted`. Có `task.assignTo()`.
- ADR-014 ✅ Không có actor `'system'`. Mọi request ghi phải có user đã xác thực; `req.user` được khai báo kiểu (module augmentation), cấm `as any`.
- ADR-015 ✅ CQRS-lite: phía ghi đi qua Entity; phía đọc dùng Query handler trả DTO thẳng từ Prisma `select`. Controller chỉ gọi UseCase/Query, không gọi repository.
- ADR-016 ✅ Không singleton toàn cục cho EventBus/Prisma trong code nghiệp vụ; mọi thứ wire tại composition root (`*.module.ts`).
- ADR-017 ✅ Express 5: không cần try/catch trong controller (async error tự chuyển tới error middleware). Zod 4: dùng `z.flattenError()`/`z.treeifyError()` thay `err.flatten()`.

## Bảo mật & đa tenant
- ADR-020 ✅ **Chống IDOR**: route lồng `/api/v1/workspaces/:wsId/projects/:projectId/tasks[/:taskId]`. Middleware xác thực membership theo `wsId`; UseCase kiểm tra lại project ∈ workspace và task ∈ project (phòng thủ 2 lớp). Resource khác tenant → trả **404** (không lộ sự tồn tại).
- ADR-021 ✅ Phân quyền bằng **Policy object** ở tầng application (`TaskPolicy.canDelete(actor, task)`), middleware chỉ chặn sớm theo role tối thiểu.
- ADR-022 ✅ Xóa task theo **ma trận RBAC**: OWNER/PM xóa mọi task; MEMBER chỉ xóa task do mình tạo; VIEWER không. Thêm cột `createdById` (FK users, `onDelete: SetNull`... chi tiết ở T-003).
- ADR-023 ✅ Luật nghiệp vụ bổ sung: project archived → cấm tạo/sửa/di chuyển task; assignee phải là thành viên workspace.
- ADR-024 ✅ Refresh token: **DB là nguồn sự thật** (tokenHash SHA-256, `familyId`, `replacedById`, `revokedAt`); phát hiện reuse → thu hồi cả family. Cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
- ADR-025 ✅ Đăng xuất mọi thiết bị: thu hồi mọi refresh token + tăng `users.token_version`; access JWT mang `tv`, so khớp với giá trị cache trên Redis (fallback DB).
- ADR-026 ✅ Access token chỉ giữ **trong bộ nhớ** FE; reload trang → gọi `/auth/refresh`. Khu vực dashboard render client-side; Next server chỉ phục vụ shell/landing.
- ADR-027 ✅ Socket.io: xác thực JWT ở handshake; `project:join` kiểm tra membership; rời phòng khi mất quyền. Chuẩn bị `@socket.io/redis-adapter` (bật khi scale).
- ADR-028 ✅ Bắt buộc: `helmet`, CORS whitelist + `credentials`, rate-limit (Redis store) cho login/register/refresh, body size limit, log có requestId (pino), không log token/password.
- ADR-029 ✅ Production: FE và API cùng registrable domain (vd `app.example.com` / `api.example.com`) để cookie SameSite=Strict hoạt động.

## Review Phase 0 — T-002 & T-003 (Tech Lead, 2026-10-15)
- ADR-040 ✅ **Duyệt toàn bộ** "quyết định tự đưa ra" trong `docs/reviews/T-002-report.md` (1–11) và `docs/reviews/T-003-report.md` (1–14). `docs/design/security.md` và `docs/design/data-and-api.md` trở thành tài liệu chính thức, ưu tiên ngay sau file này.
- ADR-041 ✅ Quyền MEMBER (Q1): sửa nội dung + move **mọi** task trong project; khi tạo chỉ được để trống assignee hoặc tự gán; tự nhận/bỏ nhận; gán người khác cần `task:assign:any` (PM+). Đổi assignee của task do mình tạo: được.
- ADR-042 ✅ Task xóa mềm, **chưa có** endpoint khôi phục và job purge ở v1 (Q2). Mở lại khi có yêu cầu.
- ADR-043 ✅ Bảng chuyển trạng thái (Q3): **domain là nguồn sự thật**; `packages/contracts` có bản sao dạng hằng số cho FE + **test parity** bắt buộc trong CI. Domain không import contracts.
- ADR-044 ✅ Assignee phải có role **≥ MEMBER** (Q4 — bác đề xuất của C: VIEWER được giao việc nhưng không kéo được thẻ của chính mình là UX hỏng). Hạ role xuống VIEWER ⇒ bỏ gán task như khi xóa thành viên (có audit + event).
- ADR-045 ✅ Project archived cấm cả xóa task (Q5).
- ADR-046 ✅ Luật LAST_OWNER phải chống race: khóa các dòng OWNER của workspace (`SELECT … FOR UPDATE`) trong transaction trước khi hạ role/xóa/rời.
- ADR-047 ✅ **Workspace xóa mềm** với thời gian ân hạn 30 ngày (`deleted_at`), sau đó job purge. Lý do: production thật, xóa workspace cascade toàn bộ dữ liệu + audit — không được để một cú bấm làm mất hết. Engineer C bổ sung schema ở Phase 1.
- ADR-048 ⛔ (THAY BỞI ADR-065 — argon2id) Băm mật khẩu: giữ bcrypt cost 12 + giới hạn 72 byte **trừ khi** T-001 xác nhận argon2id (không có giới hạn 72 byte) dùng tốt trên Node 24 + Docker alpine/slim — khi đó chuyển sang argon2id.
- ADR-049 ✅ (Người dùng chốt) Register với email đã tồn tại trả `409 EMAIL_ALREADY_EXISTS` ở v1, giảm thiểu bằng rate-limit; **xác minh email đưa vào lộ trình sau v1**. Mật khẩu tối thiểu **12 ký tự** + chặn danh sách mật khẩu phổ biến (danh sách cục bộ, không gọi dịch vụ ngoài); tối đa theo ADR-048. Lệch NIST 800-63B-4 (15) có chủ đích — ghi rõ trong security.md.
- ADR-050 ✅ **Khôi phục workspace ở v1**: OWNER được `POST /workspaces/:wsId/restore` trong 30 ngày ân hạn (ân hạn không có khôi phục thì vô nghĩa). Slug được giữ chỗ trong thời gian ân hạn. Áp dụng đủ yêu cầu bảo mật mục 3.6 security.md (một kiểu 404 cho mọi thất bại, UPDATE có điều kiện `purge_at > now()`, rate-limit, log sự kiện bảo mật) — SEC-51..55 thành bắt buộc.
- ADR-051 ✅ Thêm index `(workspace_id, role)` trên `workspace_members` (phục vụ khóa dòng OWNER, ADR-046).

## Chốt Phase 0 — T-001, T-004, T-005, T-006, T-007 (Tech Lead + người dùng, 2026-10-15)
### Stack (ghi đè ADR-002) — nguồn: `docs/research/stack-versions.md`
- ADR-060 ✅ Pin chính xác: Node 24.22.0 · pnpm **11.28.x** (12 là bản viết lại bằng Rust vừa ra — xét lại ở Phase 5) · TypeScript **6.0.3** (TS 7 chưa có API, typescript-eslint/dependency-cruiser không chạy) · `prisma` + `@prisma/client` **7.10.0 chính xác** · Zod 4.6.x · Postgres 18.6 · node-redis 6 · jose 6 · tsx + tsdown · `@dnd-kit/react` · fetch wrapper tự viết (không axios).
- ADR-061 ✅ **Cấm `npx prisma`** ở mọi nơi (sẽ kéo 8.0 RC) — chỉ `pnpm exec prisma`. `prisma.config.ts` dùng `process.env.DATABASE_URL ?? ""` để `generate` chạy được lúc build Docker.
- ADR-062 ✅ Dùng preview `partialIndexes` của Prisma 7.10 cho partial unique index (Prisma theo dõi được → không drift migration). Collation "C" của `rank` viết SQL tay trong migration; CI kiểm tra `prisma migrate diff` rỗng.
- ADR-063 ✅ **Valkey** (giấy phép BSD) thay Redis 8 (AGPLv3) cho cache/rate-limit/Socket.io adapter; client node-redis tương thích.
- ADR-064 ✅ Lint: **ESLint 10** cấu hình tay (flat config), không phụ thuộc eslint-config-next; dùng `@next/eslint-plugin-next` nếu tương thích ESLint 10, không thì bỏ.
- ADR-065 ✅ ADR-048 chốt: **argon2id** (`@node-rs/argon2`, OWASP m=47104 t=1 p=1). Bỏ giới hạn 72 byte; giới hạn trên 256 ký tự (chống DoS). Phải kiểm chứng trong container ở Phase 1.

### Hạ tầng & vận hành (người dùng chốt) — nguồn: `docs/design/devops.md`
- ADR-070 ✅ **Làm local trước** (Docker Compose trên máy dev). Chọn hosting trước Phase 5; ứng viên mặc định: DigitalOcean managed (Singapore). Code không được gắn chặt vào nhà cung cấp.
- ADR-071 ✅ Chưa có domain — chỉ cần trước khi deploy staging.
- ADR-072 ✅ **GitHub public repo.** Hệ quả bắt buộc: quét secret (gitleaks) trong CI + pre-commit; không bao giờ commit `.env`, dữ liệu thật, khóa; bật branch protection + required reviewers cho environment production (miễn phí với repo public).
- ADR-073 ✅ Giám sát gói miễn phí (Sentry free + uptime monitor free), cảnh báo qua **email**.
- ADR-074 ✅ Duyệt 8 quyết định tự đưa ra trong `docs/reviews/T-004-report.md`: readyz không đỏ khi Valkey lỗi (nhưng login/register fail-closed theo T-002); Socket.io client chỉ `websocket` (không cần sticky session); web nhận `API_URL` lúc runtime (1 image cho mọi môi trường); tách user DB `taskflow_app` / `taskflow_migrator`; migrate là job riêng trước rollout; coverage domain ≥ 90%, application ≥ 80%; mỗi worker Vitest một DB clone từ template; backup logical ra storage ngoài nhà cung cấp.

### Contract & frontend — nguồn: `docs/design/frontend.md`, `data-and-api.md`
- ADR-080 ✅ `packages/contracts` có `TASK_STATUS_TRANSITIONS` và `ROLE_PERMISSIONS` dạng dữ liệu thuần, test parity với domain API trong CI (mở rộng ADR-043).
- ADR-081 ✅ API bật locale `vi` của Zod; `details` vẫn giữ issue `code` + `path` để FE xử lý theo máy.
- ADR-082 ✅ Giải mâu thuẫn T-002/T-003 — **contract của C thắng**: gán người là `PATCH …/tasks/:taskId/assignee`; xóa task trả `200 { id, version }`. B sửa SEC-07..09.
- ADR-083 ✅ Bổ sung API: `PATCH /auth/me` (sửa họ tên) và tham số `q` tìm kiếm cho `GET members`.
- ADR-084 ✅ Dashboard render động là chấp nhận được (CSP nonce); cấu hình runtime theo ADR-074.

### Test spec — nguồn: `docs/design/test-spec-*.md`
- ADR-090 ✅ Duyệt `test-spec-auth-workspace.md` (156 case) và `test-spec-task.md` (~190 case) làm đặc tả TDD cho Phase 2. Duyệt thay đổi của B: `member:add` với email lạ trả 404 theo contract + rate-limit 30/giờ/user.
- ADR-091 ✅ `expectedVersion` được kiểm tra **trước** no-op (no-op với version cũ vẫn 409).
- ADR-092 ✅ Bỏ gán do hệ thống (hạ VIEWER / xóa thành viên) được chạy cả trong project archived — ngoại lệ có chủ đích của ADR-045.
- ADR-093 ✅ Giao tiếp giữa module theo DIP: module Workspace định nghĩa port `ITaskAssignmentCleaner` ở tầng application của nó; module Task hiện thực; wire ở composition root. **Module không import thẳng nội bộ module khác** — dependency-cruiser chặn; chỉ được import qua `modules/<x>/index.ts` (public API) nếu thật cần.

- ADR-094 ✅ Luật slug/name workspace theo R19 trong `data-and-api.md` (slug `^[a-z0-9]+(-[a-z0-9]+)*$` 3–50, danh sách slug dành riêng ⇒ 409, tự sinh slug từ tên tiếng Việt, chỉ thêm hậu tố khi trùng, thử tối đa 5 lần).
- ADR-095 ✅ Job purge workspace: `setInterval` mỗi giờ trong process API, chỉ chạy khi giành được khóa advisory. **Dùng `pg_try_advisory_xact_lock` bên trong transaction** (khóa mức session không an toàn với connection pool của Prisma). Không thêm hàng đợi, không phụ thuộc Valkey. Xử lý theo lô, idempotent.
- ADR-096 ✅ Lỗi validation **không trả lại input** của người dùng (tránh phản xạ dữ liệu nhạy cảm như mật khẩu vào log/response).

- ADR-097 ✅ **Cổng local riêng cho TaskFlow** (máy dev có dự án khác chiếm 5432/6379/3000): Postgres host **5433**, Valkey host **6380**, web **3001**, API **4000**. Bên trong mạng Docker vẫn dùng cổng chuẩn (5432/6379). Mọi giá trị đi qua `.env`; `FRONTEND_URL`/`CORS_ORIGINS` mặc định `http://localhost:3001`. Đặt `name: taskflow` cho compose project để không lẫn container. **Sửa đổi (sau T-009):** Postgres của docker-compose dùng host **5435** (dev) và **5434** (DB test) — theo compose của D; cổng 5433 chỉ là container tạm của C, xóa sau khi T-011 merge.
- ADR-098 ✅ JWT access secret là chuỗi UTF-8 ≥ 32 byte; `kid` **suy ra từ secret** (đã hiện thực ở T-013) ⇒ **bỏ** biến `JWT_ACCESS_KID` / `JWT_ACCESS_KID_PREVIOUS`. Chỉ còn `JWT_ACCESS_SECRET` + `JWT_ACCESS_SECRET_PREVIOUS`.

### Review T-012 (frontend nền)
- ADR-099 ✅ Font Inter **tự host** (không `next/font/google`: không gọi mạng lúc build, không lộ IP người dùng cho bên thứ ba, hợp CSP).
- ADR-100 ✅ Toast dùng Radix Toast + store tự viết; **không dùng sonner** (tự chèn `<style>` không có nonce ⇒ vi phạm CSP). Thêm `get-nonce` 1.0.1 để style của Radix mang nonce.
- ADR-101 ✅ `upgrade-insecure-requests` + HSTS chỉ bật khi `APP_ENV ∈ {staging, production}` (không theo `NODE_ENV`) — E2E chạy http trên host khác localhost không bị gãy; HSTS không bao giờ gửi ở môi trường local.
- ADR-103 ✅ Tên mặc định khi đăng ký: workspace "Workspace của {fullName}", project "Dự án đầu tiên" với keyPrefix `TF` (T-015). Route khôi phục workspace là route riêng; `WorkspaceAccess` (loadMembership) không có cờ includeDeleted — workspace đã xóa luôn 404, use case restore tự kiểm OWNER bằng query riêng.
- ADR-102 ✅ **Tương thích tiến khi deploy lệch phiên bản**: FE gặp `error.code` lạ (API mới hơn web) ⇒ giữ nguyên `status` + `message`, map về mã chung `UNKNOWN_ERROR` và xử lý như lỗi chung theo HTTP status — **không** coi là `BAD_RESPONSE`. `BAD_RESPONSE` chỉ dành cho body không phải envelope hợp lệ.

### Findings QA (T-017) — bảo mật phiên
- ADR-104 ✅ **Chống lost update trên users (A4)**: bỏ `save(user)` tổng quát cho user đã tồn tại. Repository có lệnh nguyên tử theo mục đích: `recordLogin(id, at)` (chỉ `last_login_at`); `rehashPassword(id, oldHash, newHash)` có điều kiện `password_hash = oldHash` (thua race ⇒ bỏ qua); `changePassword(id, oldHash, newHash, at)` có điều kiện + **tăng `token_version` trong cùng câu lệnh** `RETURNING token_version`; `bumpTokenVersion(id)` = `token_version + 1 RETURNING`; `updateProfile(id, {fullName})`. Aggregate User vẫn kiểm luật; repository chỉ thực thi ý định. Test tầng I: login ‖ change-password và login ‖ logout-all lặp 20 lần.
- ADR-105 ✅ **Thu hồi phiên fail-closed (A3)**: logout / logout-all / change-password / reuse-detected **ghi giá trị thu hồi vào Valkey TRƯỚC commit** (`SET auth:sid-revoked:{sid}`, `SET auth:tv:{userId} = tv mới` — tv mới lấy từ `RETURNING` trong transaction); ghi lỗi ⇒ `503 SERVICE_UNAVAILABLE` + rollback. Sau commit ghi lại lần nữa (best-effort). Nạp cache khi đọc (read-through) **chỉ dùng `SET NX`** — không bao giờ đè giá trị thu hồi. TTL `auth:tv` = **60 giây**. Lý do không "DEL trước commit": request đọc xen giữa sẽ nạp lại tv cũ từ DB chưa commit.

- ADR-106 ✅ Môi trường test dùng chung: mỗi engineer/QA một database riêng trên postgres-test (xem TEAM.md); harness phải từ chối chạy nếu trỏ vào `taskflow_template` hoặc DB dev.

## Hiệu năng
- ADR-030 ✅ P95 đọc <150ms, ghi <300ms **không áp dụng cho login/register** (argon2id — ADR-065). Đo bằng k6 ở Phase 5.
