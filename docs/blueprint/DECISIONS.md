# DECISIONS — Blueprint v1.1 (ghi đè v1.0)

Chủ sở hữu: Tech Lead (session `taskflow-enterprise-0b`). Chỉ Tech Lead được sửa file này.
Agent nào thấy cần đổi một quyết định → ghi đề xuất vào báo cáo ticket, KHÔNG tự sửa.

Trạng thái: ✅ Đã chốt · 🟡 Chờ nghiên cứu Phase 0 xác nhận

## Bối cảnh sản phẩm
- ADR-000 ✅ **Mục tiêu: chạy production thật.** Một instance backend ở giai đoạn đầu, nhưng không được chặn đường scale ngang (không giữ state quan trọng trong RAM).

## Repo & công nghệ
- ADR-001 ✅ **pnpm monorepo**: `apps/api` (Express), `apps/web` (Next.js), `packages/contracts` (Zod schema + types dùng chung FE/BE), `packages/config` (eslint/tsconfig chung). Thay cho `backend/` + `frontend/` của v1.0.
- ADR-002 🟡 **Phiên bản ổn định mới nhất**: Next.js 16, Express 5, Zod 4, Prisma 7, Socket.io 4.x, TypeScript 5.x, Node 24 LTS, PostgreSQL 17/18, Redis 7/8. Con số chính xác + breaking changes do T-001 xác nhận → `docs/research/stack-versions.md`.
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
- ADR-048 🟡 Băm mật khẩu: giữ bcrypt cost 12 + giới hạn 72 byte **trừ khi** T-001 xác nhận argon2id (không có giới hạn 72 byte) dùng tốt trên Node 24 + Docker alpine/slim — khi đó chuyển sang argon2id.
- ADR-049 ✅ (Người dùng chốt) Register với email đã tồn tại trả `409 EMAIL_ALREADY_EXISTS` ở v1, giảm thiểu bằng rate-limit; **xác minh email đưa vào lộ trình sau v1**. Mật khẩu tối thiểu **12 ký tự** + chặn danh sách mật khẩu phổ biến (danh sách cục bộ, không gọi dịch vụ ngoài); tối đa theo ADR-048. Lệch NIST 800-63B-4 (15) có chủ đích — ghi rõ trong security.md.
- ADR-050 ✅ **Khôi phục workspace ở v1**: OWNER được `POST /workspaces/:wsId/restore` trong 30 ngày ân hạn (ân hạn không có khôi phục thì vô nghĩa). Slug được giữ chỗ trong thời gian ân hạn. Áp dụng đủ yêu cầu bảo mật mục 3.6 security.md (một kiểu 404 cho mọi thất bại, UPDATE có điều kiện `purge_at > now()`, rate-limit, log sự kiện bảo mật) — SEC-51..55 thành bắt buộc.
- ADR-051 ✅ Thêm index `(workspace_id, role)` trên `workspace_members` (phục vụ khóa dòng OWNER, ADR-046).

## Hiệu năng
- ADR-030 ✅ P95 đọc <150ms, ghi <300ms **không áp dụng cho login/register** (bcrypt cost 12). Đo bằng k6 ở Phase 5.
