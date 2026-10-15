# Đặc tả test (TDD) — Auth & Workspace/Member/Project (T-006)

**Tác giả:** Engineer B (`taskflow-enterprise-87`) · **Dùng cho:** Phase 2 (hiện thực Auth + Workspace/RBAC) và Phase 3 (integration)
**Nguồn:** `DECISIONS.md` (đến ADR-051) · `docs/design/security.md` (SEC-xx) · `docs/design/data-and-api.md` (contract, R-xx)

> Mỗi dòng là một test viết **trước** code. Dòng nào có cột SEC thì test đó là hiện thực (một phần hoặc toàn bộ) của test bảo mật bắt buộc tương ứng. Khi cả 2 tầng đều ghi, viết unit trước để dẫn dắt thiết kế, integration sau để chứng minh hành vi thật.

---

## 0. Quy ước

### 0.1 Tầng test

| Ký hiệu | Tầng | Công cụ | Dùng khi |
|---|---|---|---|
| **U** | Unit — UseCase/Policy/Entity với InMemory repo và fake | Vitest, không I/O | Luật nghiệp vụ, nhánh lỗi, thứ tự gọi port, tính toán thời gian |
| **I** | Integration — HTTP thật (app Express) + Postgres + Valkey thật (Docker) | Vitest + supertest + client socket.io | Transaction, khóa dòng, unique constraint, middleware, cookie/header, rate limit, Redis, socket |
| **E** | E2E trình duyệt | Playwright | Chỉ ghi tham chiếu, không thuộc phạm vi tài liệu này |

**Không chứng minh ở U:** race / `FOR UPDATE` / `FOR SHARE`, unique constraint của DB, cookie, rate limit. InMemory repo không mô phỏng khóa. Mọi test race là **I**, lặp 20 lần, dùng 2 kết nối DB riêng (`Promise.all` trên 2 request HTTP).

### 0.2 Fake dùng ở tầng U (port ở `application/ports`)

| Port | Fake | Khả năng cần có cho test |
|---|---|---|
| `IUserRepository`, `IRefreshTokenRepository`, `IWorkspaceRepository`, `IWorkspaceMemberRepository`, `IProjectRepository` | `InMemory*` | Cùng implement interface với bản Prisma (LSP). Có thể "seed" và đọc lại trạng thái |
| `ITaskAssignmentCleaner` — port do **module Workspace** định nghĩa, module Task hiện thực, wire ở composition root (ADR-093) | `SpyTaskAssignmentCleaner` | Ghi lại `unassignAllForUser({ workspaceId, userId, actorId })` (chữ ký theo test-spec-task.md §3.3); trả `{ unassignedTaskCount }` cấu hình được. Test U của Workspace **không** import gì từ module Task |
| `IUnitOfWork` | `FakeUnitOfWork` | Ghi lại thứ tự `begin/commit/rollback`; chạy callback sau commit; lỗi trong callback ⇒ rollback toàn bộ trạng thái InMemory (snapshot) |
| `IPasswordHasher` | `FakePasswordHasher` | `hash(p) = "h:" + p`, ghi lại các lần `verify(hash, p)` (để kiểm DUMMY_HASH), `needsRehash` cấu hình được. Bản thật argon2id có test riêng ở T-013 |
| `ITokenService` | `FakeTokenService` hoặc bản thật với secret test | Ký/verify thật (JWT là logic thuần, chạy được ở U) |
| `IClock` | `FakeClock` | `now()` cố định, `advance(ms)` |
| `IRandom` | `FakeRandom` | Hàng đợi giá trị định sẵn cho refresh token, slug suffix, uuid |
| `ISessionCache` (Valkey `auth:tv`, `auth:sid-revoked`) | `InMemorySessionCache` | Bật/tắt chế độ "lỗi" để test fallback |
| `IRealtimeNotifier` (socket) | `SpyRealtimeNotifier` | Ghi lại lệnh `disconnectUser`, `disconnectSession`, `revokeWorkspaceAccess`, `emitRoleChanged`; khẳng định chỉ được gọi **sau** commit |
| `ISecurityLog` | `SpySecurityLog` | Ghi lại sự kiện bảo mật |
| `ICommonPasswordList` | `SetCommonPasswordList` | Danh sách nhỏ cho test |

### 0.3 Nhân vật và dữ liệu mẫu (giống security.md mục 7)

- ws **A**: Alice (OWNER), Pam (PM), Mia (MEMBER), Vic (VIEWER). ws **B**: Bob (OWNER). Olga: OWNER thứ hai của A (chỉ dùng khi test cần 2 OWNER).
- Mật khẩu hợp lệ mặc định: `correct-horse-12` (16 ký tự, không trong danh sách phổ biến).
- `NOW` = `2026-11-01T00:00:00.000Z` (FakeClock).

### 0.4 Quy ước ID và khẳng định chung

- ID: `<NHÓM>-<số>`. VD `REG-03`.
- "**404 chuẩn**" = `404`, `error.code = RESOURCE_NOT_FOUND`, body giống hệt response cho một uuid ngẫu nhiên không tồn tại (cùng `error.message`, `details.resource`) — chỉ bỏ qua `meta.requestId` và `meta.timestamp` khi so sánh.
- Mọi test **I** ghi dữ liệu phải kiểm thêm "không có thay đổi ngoài ý muốn" ở nhánh lỗi: đếm dòng bảng liên quan trước/sau.
- Mọi test **U** của UseCase ghi phải kiểm: thành công ⇒ `commit` được gọi đúng 1 lần; lỗi ⇒ `rollback`, notifier **không** được gọi.

---

## 1. Auth

### 1.1 RegisterUseCase — `POST /auth/register`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| REG-01 | U, I | Không có user nào | Register `{email:"alice@example.com", password: hợp lệ, fullName:"Alice Nguyen"}` | `201`; trong **một** transaction tạo: 1 user, 1 workspace, 1 membership OWNER, 1 project mặc định (keyPrefix `TF`), 1 refresh token (family mới, `familyExpiresAt = NOW+30d`, `expiresAt = NOW+7d`). Response có `accessToken`, `expiresIn = 900`, `user`, `defaultWorkspaceId` + `Set-Cookie` | |
| REG-02 | U | — | Register với email `"  Alice@Example.COM "` | User lưu email `alice@example.com` | |
| REG-03 | U, I | Đã có `alice@example.com` | Register lại cùng email (kể cả khác hoa/thường) | `409 EMAIL_ALREADY_EXISTS`; số dòng users/workspaces/members/projects/refresh_tokens không đổi (I: lỗi từ unique constraint, không phải từ SELECT trước) | SEC-40 |
| REG-04 | U | — | Password 11 ký tự / 12 ký tự | `400 VALIDATION_ERROR` / `201` (ADR-049) | SEC-32 |
| REG-05 | U | — | Password 257 ký tự / 256 ký tự / 100 ký tự tiếng Việt có dấu (~250 byte) | `400 VALIDATION_ERROR` và hasher **không** được gọi / `201` / `201` (ADR-065: không còn giới hạn byte) | SEC-32 |
| REG-06 | U | `password123456` nằm trong danh sách phổ biến | Register với mật khẩu đó | `400 VALIDATION_ERROR` | SEC-32 |
| REG-07 | U | — | Password chứa phần local của email (`alice` trong `alice-secret-pw1`) | `400 VALIDATION_ERROR` | SEC-32 |
| REG-08 | U | — | `fullName` = `"   "` / 101 ký tự / `"  Alice "` | `400` / `400` / lưu `"Alice"` | |
| REG-09 | U | — | Body thừa field (`role`, `tokenVersion`) | `400 VALIDATION_ERROR` (Zod strict) | SEC-04 |
| REG-10 | U | — | Register hợp lệ | `hash()` được gọi **trước** `uow.begin()` (không giữ transaction mở trong lúc băm) | |
| REG-11 | U | Slug `alice-nguyen` đã tồn tại; FakeRandom trả suffix `def456` | Register `fullName: "Alice Nguyen"` | `201`, slug = `alice-nguyen-def456`; toàn bộ transaction được thử lại (không để lại user từ lần 1) | |
| REG-12 | U | Slug gốc và mọi suffix FakeRandom trả đều trùng | Register | `500 INTERNAL_ERROR` sau đúng 5 lần thử (R19); không có dữ liệu nào được tạo | |
| REG-13 | U | — | Register với email `alice@example.com` | Slug **không** chứa chuỗi `alice@` hay domain email | |
| REG-13b | U | — | Register `fullName: "Nguyễn Văn Đức"` / `"Admin"` / `"李"` | Slug `nguyen-van-duc` / `workspace-xxxxxx` (trùng slug dành riêng) / `workspace-xxxxxx` (dưới 3 ký tự) | |
| REG-14 | I | Slug của ws đã xóa mềm trùng với slug sinh ra | Register | Va chạm được xử lý như REG-11 (slug giữ chỗ, ADR-050) | |
| REG-15 | I | — | 2 register đồng thời cùng `fullName`, email khác | Cả hai `201`, slug khác nhau | SEC-40 |
| REG-16 | I | — | 6 register từ cùng IP trong 1 giờ | Lần 6: `429 RATE_LIMITED` + `Retry-After` | |
| REG-17 | I | — | Register thành công | Cookie đúng thuộc tính (xem LOG-10); access token verify được với `tv = 0`, `sid = familyId` | SEC-34 |
| REG-18 | I | Log capture | Register | Log không chứa password, access token, refresh token | SEC-33 |

### 1.2 LoginUseCase — `POST /auth/login`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| LOG-01 | U, I | Alice tồn tại | Login đúng | `200`; family mới; `lastLoginAt = NOW`; access token có `tv = user.tokenVersion` | |
| LOG-02 | U | Alice tồn tại | Login email `" ALICE@example.com"` | `200` (chuẩn hóa email) | |
| LOG-03 | U | Alice tồn tại | Sai mật khẩu | `401 INVALID_CREDENTIALS`; không tạo refresh token; `lastLoginAt` không đổi | |
| LOG-04 | U | Không có `ghost@example.com` | Login email đó | `401 INVALID_CREDENTIALS` **cùng message** với LOG-03; hasher đã `compare` với `DUMMY_HASH` đúng 1 lần | SEC-27 |
| LOG-05 | U | Alice có `deletedAt` | Login đúng mật khẩu | `401 INVALID_CREDENTIALS`, giống LOG-03 | |
| LOG-06 | U | Hash của Alice có tham số argon2 khác cấu hình (`needsRehash = true`) | Login đúng | Hash mới được lưu; login thành công. `needsRehash = false` ⇒ hash không đổi | |
| LOG-07 | U | — | Login thành công | Payload access token: có `sub, tv, sid, jti, iat, exp, iss="taskflow-api", aud="taskflow-web"`; `exp - iat = 900`; **không** có `role`, `workspaceId`, `email` | |
| LOG-08 | I | — | 20 lần login "không có email" và 20 lần "sai mật khẩu" | Chênh lệch trung vị thời gian < 50ms | SEC-27 |
| LOG-09 | I | — | 6 lần login sai cùng IP + email trong 15 phút | Lần 6 `429` + `Retry-After`; login **đúng** không làm tăng bộ đếm thất bại | SEC-28 |
| LOG-10 | I | `NODE_ENV=production` (config test) / `development` | Login | Prod: `__Host-tf_rt; HttpOnly; Secure; SameSite=Strict; Path=/`, không `Domain` (ADR-109). Dev: `tf_rt`, không `Secure`, `Path=/api/v1/auth` | SEC-34 |
| LOG-11 | I | Valkey tắt | Login; register; gọi `GET /readyz`; gọi `GET /auth/me` bằng access token hợp lệ | Login/register `503 SERVICE_UNAVAILABLE` và không gọi hasher (fail-closed, security.md 6.4); `/readyz` vẫn xanh (ADR-074); `/auth/me` `200` (fallback DB) | |
| LOG-12 | I | — | Login với `Content-Type: text/plain` | `415 UNSUPPORTED_MEDIA_TYPE` | SEC-31 |
| LOG-13 | I | — | Response login | Có `Cache-Control: no-store` | |

### 1.3 RefreshUseCase — `POST /auth/refresh`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| REF-01 | U, I | Token T1 hợp lệ | Refresh với T1 | `200`; T2 được tạo cùng `familyId` và `familyExpiresAt`; T1 `revokedReason = ROTATED`, `revokedAt = NOW`, `replacedById = T2.id`; cookie mới chứa T2 | SEC-17 |
| REF-02 | U | — | Không có cookie | `401 REFRESH_TOKEN_INVALID` | |
| REF-03 | U | — | Cookie chứa chuỗi ngẫu nhiên không có trong DB | `401 REFRESH_TOKEN_INVALID`; response xóa cookie | |
| REF-04 | U | T1 đã xoay sang T2 lúc `NOW`; clock `advance(11s)` | Refresh với T1 | `401 REFRESH_TOKEN_INVALID`; **mọi** token chưa thu hồi trong family (T2) ⇒ `REUSE_DETECTED`; `sid-revoked:{familyId}` được ghi; `SecurityLog` có `refresh.reuse_detected` | SEC-18 |
| REF-05 | U | T1 đã xoay sang T2 lúc `NOW`; clock `advance(5s)` | Refresh với T1 | `409 REFRESH_IN_PROGRESS`; T2 vẫn còn hiệu lực; không cấp token mới | SEC-19 |
| REF-06 | I | T1 hợp lệ | 2 refresh đồng thời với T1 (lặp 20 lần) | Mỗi lần đúng 1 `200` và 1 `409 REFRESH_IN_PROGRESS`; family không bị thu hồi | SEC-19 |
| REF-07 | U | T1 có `expiresAt < NOW` | Refresh | `401 REFRESH_TOKEN_INVALID`, family **không** bị thu hồi | SEC-20 |
| REF-08 | U | T1 có `familyExpiresAt < NOW` (dù `expiresAt` còn) | Refresh | `401 REFRESH_TOKEN_INVALID` | SEC-20 |
| REF-09 | U | `familyExpiresAt = NOW + 3d` | Refresh hợp lệ | T2 có `expiresAt = NOW + 3d` (= min(NOW+7d, familyExpiresAt)) | |
| REF-10 | U | T1 bị thu hồi với reason `LOGOUT` | Refresh với T1 | `401`; **không** ghi thêm thu hồi hay sự kiện reuse | |
| REF-11 | U | User của T1 có `deletedAt` | Refresh | `401 REFRESH_TOKEN_INVALID` | |
| REF-12 | U | `users.tokenVersion` = 3 | Refresh hợp lệ | Access token mới có `tv = 3` (đọc từ DB, không copy từ token cũ) | |
| REF-13 | I | — | Refresh không có header `Origin` / `Origin: https://evil.example` | `403 ORIGIN_NOT_ALLOWED`; T1 **không** bị xoay | SEC-29 |
| REF-14 | U | — | Refresh hợp lệ | DB chỉ lưu `sha256(token)` dạng hex 64 ký tự, không lưu token thô | |

### 1.4 LogoutUseCase — `POST /auth/logout`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| OUT-01 | U | Alice có phiên S1 (T1, T2 đã xoay) | Logout với cookie T2 | `204`; mọi token chưa thu hồi của S1 ⇒ `LOGOUT`; `sid-revoked:{S1}` TTL 900s; sau commit notifier `disconnectSession(S1)`; cookie bị xóa | |
| OUT-02 | U | — | Logout không có cookie / cookie lạ | `204`, xóa cookie, không lỗi (idempotent) | |
| OUT-03 | I | Alice có phiên S1 và S2 | Logout S1 | Access token của S1 ⇒ `401`; access token và refresh của S2 vẫn hoạt động | SEC-22 |
| OUT-04 | I | — | Logout với `Origin` lạ | `403 ORIGIN_NOT_ALLOWED`; phiên không bị thu hồi | SEC-29 |

### 1.5 LogoutAllUseCase — `POST /auth/logout-all`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| ALL-01 | U | Alice `tokenVersion = 0`, có 3 phiên | Logout-all | `204`; `tokenVersion = 1`; mọi token chưa thu hồi ⇒ `LOGOUT_ALL`; cache `tv` = 1 được ghi **sau** commit; notifier `disconnectUser(alice)` sau commit | |
| ALL-02 | I | Alice có access token còn hạn + refresh token ở 2 thiết bị | Logout-all, rồi dùng token cũ | Access ⇒ `401 UNAUTHORIZED`; refresh ⇒ `401 REFRESH_TOKEN_INVALID`; socket của Alice bị ngắt | SEC-21 |
| ALL-03 | I | Valkey tắt | Logout-all, rồi gọi API bằng access token cũ | `401` (fallback đọc `tv` từ DB) | SEC-24 |
| ALL-04 | U | `SessionCache` ở chế độ lỗi khi ghi | Logout-all | Vẫn `204` (DB là nguồn sự thật), có log cảnh báo | |
| ALL-05 | I | Valkey bật, key `auth:tv:alice` chưa có | Một request đọc `tv` (miss ⇒ load DB) chạy chen với logout-all | Sau khi cả hai xong, giá trị trong Valkey = `tv` mới (reader dùng `SET NX`, writer ghi đè) | |

### 1.6 ChangePasswordUseCase — `POST /auth/change-password`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| PWD-01 | U | Alice có phiên S1 (hiện tại) và S2 | Đổi mật khẩu đúng | `200`; hash mới; `passwordChangedAt = NOW`; `tokenVersion + 1`; mọi refresh token cũ ⇒ `PASSWORD_CHANGED`; tạo family **mới** cho thiết bị hiện tại; access token mới có `tv` mới; sau commit `disconnectUser(alice)` + ghi cache `tv` | |
| PWD-02 | U | — | `currentPassword` sai | `400 INVALID_CURRENT_PASSWORD`; không thay đổi gì | |
| PWD-03 | U | — | `newPassword` = mật khẩu hiện tại | `400 VALIDATION_ERROR` | |
| PWD-04 | U | — | `newPassword` 11 ký tự / trong danh sách phổ biến | `400 VALIDATION_ERROR` | SEC-32 |
| PWD-05 | I | Alice có S1, S2 | Đổi mật khẩu từ S1 | S2 (access + refresh) ⇒ `401`; S1 dùng token mới ⇒ `200`; login bằng mật khẩu cũ ⇒ `401` | SEC-23 |
| PWD-06 | I | — | 6 lần change-password trong 15 phút | Lần 6 `429` | |
| PWD-07 | U | Hash mới | Đổi mật khẩu | `hash()` gọi trước `uow.begin()` | |

### 1.7 Middleware `authenticate` (HTTP) và handshake socket

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| MW-01 | U, I | — | Không có header Authorization | `401 UNAUTHORIZED` | |
| MW-02 | U | — | JWT `alg: none`; ký bằng secret khác; sửa `sub` sau khi ký; thiếu `tv`; sai `iss`; sai `aud` | `401 UNAUTHORIZED` cho cả 6 trường hợp | SEC-25 |
| MW-03 | U | — | JWT hết hạn 6 giây trước (`clockTolerance` 5s) / hết hạn 4 giây trước | `401 TOKEN_EXPIRED` / qua | SEC-26 |
| MW-04 | U | Cache `tv` = 2, token `tv = 1` | Gọi API | `401 UNAUTHORIZED` | SEC-21 |
| MW-05 | U | `sid-revoked:{S1}` có trong cache | Gọi API với token có `sid = S1` | `401 UNAUTHORIZED` | SEC-22 |
| MW-06 | U | Cache lỗi; DB có `tokenVersion = 2` | Token `tv = 1` | `401` (fallback DB) | SEC-24 |
| MW-07 | U | Cache lỗi và DB lỗi | Gọi API | `503 SERVICE_UNAVAILABLE` | |
| MW-08 | U | Token hợp lệ | Gọi API | `req.user = { id, sid, tv }`; cache được đọc bằng **1** lệnh `MGET` | |
| MW-09 | I | JWT ký bằng `JWT_ACCESS_SECRET_PREVIOUS` với `kid` cũ | Gọi API | Qua (hỗ trợ xoay khóa) | |
| MW-10 | I | — | Handshake socket không token / token sai / `tv` cũ | `connect_error` với `data.code = UNAUTHORIZED` cho cả 3; token hết hạn ⇒ `TOKEN_EXPIRED` | SEC-35 |
| MW-11 | I | Token hợp lệ | Handshake với `Origin` lạ / không có Origin / transport `polling` | Bị từ chối cả 3 (chỉ websocket + kiểm Origin, ADR-074) | SEC-56 |

### 1.8 UpdateProfileUseCase — `PATCH /auth/me` (ADR-083)

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| ME-01 | U, I | Alice đăng nhập | `PATCH /auth/me {fullName:"  Alice Tran "}` | `200`, `fullName = "Alice Tran"`; `tokenVersion` và mọi phiên không đổi | |
| ME-02 | U | — | `fullName` rỗng sau trim / 101 ký tự / chứa ký tự điều khiển | `400 VALIDATION_ERROR` | |
| ME-03 | U, I | — | Body có `email` / `tokenVersion` / `id` / `passwordHash` | `400 VALIDATION_ERROR` (strict); không trường nào đổi | SEC-57 |
| ME-04 | I | — | Không có access token | `401` | |
| ME-05 | I | — | 31 lần trong 1 giờ | Lần 31 `429` | |
| ME-06 | I | Alice là member A | Đổi tên rồi Pam `GET /workspaces/A/members` | Thấy tên mới (không cache tên trong membership) | |

---

## 2. Workspace

### 2.1 CreateWorkspaceUseCase — `POST /workspaces`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| WSC-01 | U, I | Alice đã đăng nhập | Tạo `{name:"Marketing", slug:"marketing"}` | `201 WorkspaceDto` với `myRole = OWNER`; membership OWNER tạo trong cùng transaction | |
| WSC-02 | U | — | Tạo không có `slug` với name `"Đội Phát Triển Sản Phẩm"` | Slug `doi-phat-trien-san-pham`; name dài 80 ký tự ⇒ phần gốc của slug cắt còn ≤ 40 ký tự, không kết thúc bằng `-` (R19) | |
| WSC-03 | I | Đã có ws slug `marketing` (kể cả ws đó đang xóa mềm) | Tạo với `slug:"marketing"` | `409 RESOURCE_CONFLICT`, `details.field = "slug"`; không tạo ws/membership | |
| WSC-04 | U | — | `slug` sai định dạng: `"Has Space"`, `"-abc"`, `"abc-"`, `"a--b"`, `"ab"` (2 ký tự), 51 ký tự, `"Marketing"` (chữ hoa — **không** tự lowercase) / `name` rỗng sau trim, 101 ký tự, chứa ký tự điều khiển | `400 VALIDATION_ERROR` (R19) | |
| WSC-04b | U | — | `slug` = `"abc"` (3 ký tự) / 50 ký tự hợp lệ | `201` (biên hợp lệ) | |
| WSC-05 | U | — | Body thừa `ownerId` / `deletedAt` | `400` (strict) | SEC-04 |
| WSC-06 | I | — | Không đăng nhập | `401` | |
| WSC-07 | I | — | 11 lần tạo ws trong 1 giờ | Lần 11 `429` | |
| WSC-08 | U | — | Tạo với slug dành riêng: `api`, `admin`, `auth`, `login`, `workspaces`, … (đủ 13 giá trị của R19) | `409 RESOURCE_CONFLICT`, `details.field = "slug"` — **cùng** response với slug đã có người dùng (không tiết lộ đó là slug dành riêng) | |
| WSC-09 | U | Slug sinh ra `marketing` đã tồn tại | Tạo không có slug, name `"Marketing"` | Slug `marketing-xxxxxx`; tối đa 5 lần thử, sau đó `500` | |
| WSC-10 | U | — | Tạo không có slug, name `"Settings"` (trùng slug dành riêng sau khi sinh) | Slug `workspace-xxxxxx` | |

### 2.2 ListWorkspacesQuery / GetWorkspaceQuery — `GET /workspaces`, `GET ws`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| WSL-01 | I | Alice thuộc A và C; C đã xóa mềm | `GET /workspaces` | Chỉ có A; `myRole` đúng theo membership | SEC-47 |
| WSL-02 | I | A đã xóa mềm; Alice là OWNER, Pam là PM; ws D của Alice đã quá `purgeAt` (job chưa chạy) | `GET /workspaces?deleted=true` bởi Alice / Pam / Bob | Alice: chỉ A (có `purgeAt`), không có D; Pam: rỗng; Bob: rỗng | SEC-54 |
| WSL-03 | I | — | Bob `GET /workspaces/A` | 404 chuẩn | SEC-01 |
| WSL-04 | I | — | `GET /workspaces/not-a-uuid` | `400 VALIDATION_ERROR` | |

### 2.3 DeleteWorkspaceUseCase — `DELETE ws`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| WSD-01 | U, I | ws A, slug `acme` | Alice xóa với `{confirmSlug:"acme"}` | `200 DeletedWorkspaceDto`; `deletedAt = NOW`, `purgeAt = NOW + 30d`, `deletedById = Alice`; membership/project/task **không** đổi; sau commit notifier `revokeWorkspaceAccess(A)` (gửi `workspace:access-revoked` tới mọi member + `socketsLeave` phòng project) | |
| WSD-02 | U | — | `confirmSlug` sai | `400 VALIDATION_ERROR`; không xóa | |
| WSD-03 | U, I | — | Pam (PM) xóa A | `403 FORBIDDEN_ACCESS` | |
| WSD-04 | I | — | Bob xóa A | 404 chuẩn | SEC-01 |
| WSD-05 | I | A đã xóa mềm | Alice xóa lại A | 404 chuẩn | |
| WSD-06 | I | A đã xóa mềm | Alice và Mia gọi `GET ws`, `GET ws/projects`, `GET ws/p/t/audit-logs`, `POST ws/members`, `PATCH ws/members/:id`; `GET /auth/me` | Mọi route ws ⇒ 404 chuẩn; `/auth/me` không có A | SEC-47, SEC-55 |
| WSD-07 | I | Mia đang ở phòng `project:P1` của A | Alice xóa A | Mia nhận `workspace:access-revoked {workspaceId: A}`, rời phòng; `project:join` P1 sau đó ⇒ ack `RESOURCE_NOT_FOUND` | SEC-47 |

### 2.4 RestoreWorkspaceUseCase — `POST ws/restore` (ADR-050)

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| WSR-01 | U, I | A xóa mềm lúc `NOW - 10d` | Alice restore | `200 WorkspaceDto`; `deletedAt`, `purgeAt`, `deletedById` = null; Mia lại truy cập được `GET ws/projects`; `SecurityLog` có `workspace.restored` | |
| WSR-02 | I | A đã xóa mềm | Pam (PM), Mia, Vic, Bob restore | 404 chuẩn cho cả 4 (không có `403`); A vẫn bị xóa | SEC-51 |
| WSR-03 | I | A chưa xóa | Alice restore | 404 chuẩn | SEC-52 |
| WSR-04 | U, I | A có `purgeAt < NOW` (job chưa chạy) | Alice restore | 404 chuẩn; A vẫn ở trạng thái xóa | SEC-52 |
| WSR-05 | I | A có `purgeAt` vừa tới | Restore và job purge chạy đồng thời (lặp 20 lần) | Đúng một bên thành công; nếu restore thắng thì toàn bộ project/task/audit còn nguyên; nếu purge thắng thì restore ⇒ 404 | SEC-53 |
| WSR-06 | I | — | 11 lần restore trong 1 giờ | Lần 11 `429` | |
| WSR-07 | U | — | Duyệt bảng route đã đăng ký | `includeDeleted: true` chỉ xuất hiện ở đúng route restore | SEC-55 |
| WSR-08 | U | A đã xóa mềm | Restore thành công | Notifier **không** được gọi (không có event socket) | |

### 2.5 UpdateWorkspaceUseCase — `PATCH ws` (bổ sung cho đủ ma trận quyền)

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| WSU-01 | U | — | Alice đổi `name` | `200`, tên mới | |
| WSU-02 | U, I | — | Pam đổi `name` | `403` | |
| WSU-03 | I | Slug `beta` đã thuộc ws khác | Alice đổi slug thành `beta` | `409 RESOURCE_CONFLICT` | |
| WSU-04 | U | — | Alice đổi slug thành `admin` (dành riêng) / `Beta` (chữ hoa) | `409 RESOURCE_CONFLICT` / `400 VALIDATION_ERROR` | |

---

## 3. Member

### 3.0 ListMembersQuery — `GET ws/members?q=` (ADR-083)

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| MLS-01 | I | — | Vic `GET /workspaces/A/members?q=mia` | `200`, chỉ Mia (khớp không phân biệt hoa thường theo tên hoặc email) | |
| MLS-02 | I | Bob chỉ thuộc B | Alice `GET /workspaces/A/members?q=bob` | Danh sách rỗng — tìm kiếm luôn giới hạn trong ws A | SEC-58 |
| MLS-03 | I | — | `q=%` / `q=_` / `q=\` | Chỉ khớp member có đúng ký tự đó trong tên/email (thường là rỗng), **không** trả toàn bộ | SEC-58 |
| MLS-04 | U | — | `q` 101 ký tự / `q="   "` | `400` / coi như không lọc | |
| MLS-05 | I | — | Bob `GET /workspaces/A/members?q=a` | 404 chuẩn | SEC-01 |

### 3.1 AddMemberUseCase — `POST ws/members`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| MEM-01 | U, I | Nina có tài khoản, chưa thuộc A | Alice thêm `{email:"nina@…", role:"PM"}` | `201 MemberDto` | |
| MEM-02 | U | — | Pam thêm Nina với role MEMBER / VIEWER | `201` | |
| MEM-03 | U, I | — | Pam thêm Nina với role PM / OWNER | `403 FORBIDDEN_ACCESS`; kiểm Policy cấp role **trước** khi tra user (không tốn query) | SEC-13 |
| MEM-04 | U, I | — | Mia (MEMBER) / Vic thêm bất kỳ ai | `403` | |
| MEM-05 | U | — | Alice thêm `ghost@example.com` (không có tài khoản) | `404 RESOURCE_NOT_FOUND`, `details.resource = "user"` | |
| MEM-06 | U, I | Mia đã thuộc A | Alice thêm Mia | `409 RESOURCE_CONFLICT`; role Mia không đổi | |
| MEM-07 | U | — | Alice thêm `"  NINA@Example.com "` | Tìm được Nina (email chuẩn hóa) | |
| MEM-08 | I | — | Bob thêm member vào A | 404 chuẩn (`resource: "workspace"`) | SEC-01 |
| MEM-09 | U | — | `role: "ADMIN"` / thiếu role | `400 VALIDATION_ERROR` | |
| MEM-10 | I | — | Pam thêm member 31 lần trong 1 giờ | Lần 31 `429` | |
| MEM-11 | I | Nina là user đã ẩn danh hóa (`deletedAt`) | Alice thêm theo email cũ của Nina | `404` (email đã bị thay khi ẩn danh hóa) | |

### 3.2 ChangeMemberRoleUseCase — `PATCH ws/members/:userId`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| ROL-01 | U, I | — | Alice đổi Mia MEMBER → PM | `200 { member, unassignedTaskCount: 0 }`; sau commit `emitRoleChanged(Mia, A, PM)` | |
| ROL-02 | U, I | — | Pam đổi role bất kỳ ai | `403` | SEC-13 |
| ROL-03 | U, I | Alice là OWNER duy nhất | Alice tự hạ xuống PM | `422 BUSINESS_RULE_VIOLATION`, `details.rule = "LAST_OWNER"`; role không đổi | SEC-15 |
| ROL-04 | U | A có Alice và Olga là OWNER | Alice hạ Olga xuống PM | `200` | |
| ROL-05 | I | A có đúng 2 OWNER Alice, Olga | Alice hạ Olga **đồng thời** với Olga hạ Alice (lặp 20 lần) | Mỗi lần đúng 1 `200`, 1 bị từ chối an toàn — `422 LAST_OWNER`, hoặc (từ X6, T-032: role của actor đọc lại sau khóa owners) `403` / `404` vì bên thắng đã hạ / xóa chính actor đó; cuối cùng còn đúng 1 OWNER; không deadlock (không có lỗi `40P01`) | SEC-46 |
| ROL-06 | U, I | Mia được gán 3 task: T1, T2 (chưa xóa), T3 (đã xóa mềm) | Alice hạ Mia xuống VIEWER | `200 { unassignedTaskCount: 2 }`; U: `ITaskAssignmentCleaner.unassignAllForUser({ workspaceId: A, userId: Mia, actorId: Alice })` được gọi đúng 1 lần **trong** transaction; I: T1, T2 có `assigneeId = null`, `version + 1`, mỗi task 1 audit `ASSIGNEE_CHANGED` actor = Alice; T3 không đổi; sau commit event `task:updated` cho T1, T2 và `member:role-changed` | SEC-44 |
| ROL-06b | U, I | Mia được gán T4 thuộc project **archived** | Alice hạ Mia xuống VIEWER (hoặc xóa Mia) | T4 cũng bị bỏ gán, có audit — ngoại lệ có chủ đích của ADR-045 (ADR-092) | SEC-44 |
| ROL-07 | I | — | Pam gán T1 cho Mia **đồng thời** với Alice hạ Mia xuống VIEWER (lặp 20 lần) | Không lần nào kết thúc với task gán cho Mia khi Mia là VIEWER | SEC-45 |
| ROL-08 | U | Mia là MEMBER | Alice đổi Mia sang MEMBER (không đổi) | `200`, `unassignedTaskCount: 0`; không audit, không event | |
| ROL-09 | U, I | Nina không thuộc A | Alice đổi role Nina | 404 chuẩn (`resource: "user"` theo contract) | |
| ROL-10 | U | Mia là MEMBER có task | Alice nâng Mia lên PM | Không bỏ gán task nào | |

### 3.3 RemoveMemberUseCase / Leave — `DELETE ws/members/:userId`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| REM-01 | U, I | Mia được gán 2 task | Pam xóa Mia | `200 { userId: Mia, unassignedTaskCount: 2 }`; membership bị xóa; 2 task bỏ gán + audit (actor Pam); sau commit `revokeWorkspaceAccess` cho Mia | |
| REM-02 | U, I | — | Pam xóa Alice (OWNER) / Pam xóa một PM khác | `403`; membership không đổi | SEC-14 |
| REM-03 | U, I | — | Mia xóa Vic | `403` | SEC-14 |
| REM-04 | U | — | Vic tự rời (`userId` = Vic) | `200` (min role VIEWER đủ cho tự rời) | |
| REM-05 | U, I | Alice là OWNER duy nhất | Alice tự rời | `422 LAST_OWNER`; membership còn nguyên | SEC-15 |
| REM-06 | U | A có Alice, Olga là OWNER | Alice xóa Olga | `200` | |
| REM-07 | I | A có đúng 2 OWNER | (a) Alice hạ Olga + **Alice** tự rời đồng thời (nếu cả hai thành công thì không còn OWNER — "Alice hạ Olga + Olga tự rời" không bao giờ về 0 OWNER nên không kiểm được luật, sửa ở T-020); (b) Alice xóa Olga + Olga xóa Alice đồng thời (lặp 20 lần mỗi biến thể) | Mỗi lần còn ≥ 1 OWNER; đúng 1 thao tác thành công; không deadlock | SEC-46 |
| REM-08 | I | Mia có access token còn hạn | Pam xóa Mia; Mia gọi `GET ws/projects` ngay sau đó | 404 chuẩn (membership đọc DB mỗi request) | SEC-16 |
| REM-09 | I | Mia ở phòng `project:P1` | Pam xóa Mia | Mia nhận `workspace:access-revoked`, rời phòng, không nhận `task:*` tiếp theo | SEC-37 |
| REM-10 | U, I | — | Xóa `userId` không thuộc A | 404 chuẩn | |

---

## 4. Project

### 4.1 CreateProjectUseCase — `POST ws/projects`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| PRJ-01 | U, I | — | Pam tạo `{name:"Website", keyPrefix:"WEB"}` | `201 ProjectDto`, `isArchived = false`, `workspaceId = A` (lấy từ URL) | |
| PRJ-02 | U, I | — | Mia / Vic tạo project | `403` | |
| PRJ-03 | I | A đã có `WEB` | Pam tạo `WEB` trong A | `409 RESOURCE_CONFLICT`, `details.field = "keyPrefix"` | |
| PRJ-04 | I | B đã có `WEB` | Pam tạo `WEB` trong A | `201` (unique theo workspace) | |
| PRJ-05 | U | — | `keyPrefix` = `"web"`, `"1AB"`, `"A"`, `"ABCDEFGHIJK"` / `"WEB"` | `400` cho 4 giá trị đầu / `201` (R17 `^[A-Z][A-Z0-9]{1,9}$`) | |
| PRJ-06 | U | — | Body có `workspaceId: B` | `400` (strict) — tenant chỉ lấy từ URL | SEC-04 |
| PRJ-07 | I | — | Bob tạo project trong A | 404 chuẩn | SEC-01 |

### 4.2 UpdateProjectUseCase — `PATCH ws/p`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| PRU-01 | U | — | Pam đổi `name` | `200` | |
| PRU-02 | U | — | Body có `keyPrefix` | `400` (bất biến, R17) | |
| PRU-03 | U | P1 archived | Pam đổi `name` | `422 PROJECT_ARCHIVED` | |
| PRU-04 | U | P1 archived | Mia đổi `name` | `403` (403 trước 422) | |
| PRU-05 | I | P9 thuộc B | Pam `PATCH /workspaces/A/projects/P9` | 404 chuẩn | SEC-02 |

### 4.3 Archive / Unarchive — `POST ws/p/archive|unarchive`

| ID | Tầng | Given | When | Then | SEC |
|---|---|---|---|---|---|
| ARC-01 | U, I | P1 chưa archive | Pam archive | `200`, `isArchived = true`, `archivedAt = NOW` | |
| ARC-02 | U | P1 đã archive | Pam archive lại | `200`, `archivedAt` **không** đổi (idempotent) | |
| ARC-03 | U, I | — | Mia / Vic archive | `403` | |
| ARC-04 | I | P9 thuộc B | Pam archive `/workspaces/A/projects/P9` | 404 chuẩn | SEC-02 |
| ARC-05 | U, I | P1 archived | Pam unarchive | `200`, `isArchived = false`, `archivedAt = null`; unarchive lần nữa vẫn `200` | |
| ARC-06 | I | P1 archived | Mia tạo/sửa/move/xóa task trong P1; Pam xóa task bất kỳ | `422 PROJECT_ARCHIVED` (thuộc test domain Task — chỉ tham chiếu để kiểm tích hợp với archive) | SEC-10 |
| ARC-07 | I | P1 archived | Vic `project:join` P1 | ack `{ ok: true }` (archived vẫn đọc được) | |

---

## 5. Ma trận phủ SEC

SEC thuộc phạm vi tài liệu này và nơi hiện thực:

| SEC | Test | SEC | Test |
|---|---|---|---|
| SEC-01 | WSL-03, WSD-04, MEM-08, PRJ-07, MLS-05 | SEC-24 | ALL-03, MW-06 |
| SEC-02 | PRU-05, ARC-04 | SEC-25 | MW-02 |
| SEC-04 | REG-09, WSC-05, PRJ-06 | SEC-26 | MW-03 |
| SEC-10 | ARC-06 (chính ở Task) | SEC-27 | LOG-04, LOG-08 |
| SEC-13 | MEM-03, ROL-02 | SEC-28 | LOG-09 |
| SEC-14 | REM-02, REM-03 | SEC-29 | REF-13, OUT-04 |
| SEC-15 | ROL-03, REM-05 | SEC-31 | LOG-12 |
| SEC-16 | REM-08 | SEC-32 | REG-04..07, PWD-04 |
| SEC-17 | REF-01 | SEC-33 | REG-18 |
| SEC-18 | REF-04 | SEC-34 | LOG-10, REG-17 |
| SEC-19 | REF-05, REF-06 | SEC-35 | MW-10 |
| SEC-20 | REF-07, REF-08 | SEC-37 | REM-09 |
| SEC-21 | ALL-02, MW-04 | SEC-44 | ROL-06, ROL-06b |
| SEC-22 | OUT-03, MW-05 | SEC-45 | ROL-07 |
| SEC-23 | PWD-05 | SEC-46 | ROL-05, REM-07 |
| SEC-40 | REG-03, REG-15 | SEC-47 | WSL-01, WSD-06, WSD-07 |
| SEC-51 | WSR-02 | SEC-52 | WSR-03, WSR-04 |
| SEC-53 | WSR-05 | SEC-54 | WSL-02 |
| SEC-55 | WSD-06, WSR-07 | SEC-56 | MW-11 |
| SEC-57 | ME-03 | SEC-58 | MLS-02, MLS-03 |

**Ngoài phạm vi tài liệu này** (thuộc Task domain / socket project / E2E): SEC-03, 05–09, 11, 12, 12b, 12c, 30, 36, 38, 39, 41, 42, 43, 48–50. SEC-30 (CORS) và SEC-36/38/39 (socket join/renew) nên có test spec riêng khi làm Socket gateway ở Phase 3.

---

## 6. Ghi chú hiện thực cho Phase 2

1. Bắt đầu bằng Policy (`MemberPolicy`, `WorkspacePolicy`, `ProjectPolicy`): test dạng bảng role × tình huống, thuần U, không cần repo.
2. Test U của UseCase dùng một builder chung (`givenWorkspaceA()`) để dựng dữ liệu §0.3. Không lặp code seed trong từng file.
3. Test I chạy theo schema riêng mỗi worker (hoặc truncate giữa các file) để có thể chạy song song. Test race (ROL-05, ROL-07, REM-07, REF-06, WSR-05) gom vào một file chạy tuần tự, đặt timeout rõ ràng.
4. `SpyRealtimeNotifier` + `FakeUnitOfWork` phải cho phép khẳng định "notifier chỉ gọi sau commit". Nếu thiết kế UoW không hỗ trợ `afterCommit` thì đó là tín hiệu thiết kế sai (ADR-012).
