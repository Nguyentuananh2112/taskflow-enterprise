# T-061a — Quản trị công ty: quyền (`/admin/access`) + workspace mồ côi (`/admin/workspaces`) — báo cáo Engineer A

Nhánh `feat/T-061a-admin`, dựng trên `feat/company-level` @62a5992 (B giao phần admin của T-061, TL duyệt). Merge vào
nhánh tích hợp `feat/company-level`, **không** vào `main`. Nguồn: `docs/design/company-level.md` v2.1 — ADR-133 (nhiệm kỳ
bằng ngày, `ROLE_CHANGED`), ADR-134 (Admin không phải nhân viên, ws mồ côi), ADR-135 (thứ tự lỗi), ADR-136 (bảng khóa).

## Commit

| Commit | Nội dung |
|---|---|
| `d9b20bf` | **dùng chung với T-062 (B cherry-pick)**: `IUserRepository.findManyByIds` (3 bản + contract), `profiles(userIds)` ở `AuthAccounts` / `ICompanyAccounts`, `offboard-leave.port.ts` |
| `0b1bb85` | `/admin/access` (GET + PUT) |
| `3d6b1f1` | phía workspace của `/admin/workspaces` (WIP) |
| `83a5b09` | `/admin/workspaces` (GET, POST owner, POST archive) + nối `offboardCleanup` thật từ leave |
| (commit này) | test integration Prisma + report |

## Hành vi

**`GET /admin/access`** (`company:admin`): mọi người đang thuộc công ty, sắp theo tên — role, grants, trạng thái suy ra
(chờ kích hoạt / đang làm / có lịch nghỉ), email (PII — chỉ route Admin, `no-store`, không log). Một truy vấn cho hồ sơ.

**`PUT /admin/access/:userId {role, grants, expectedVersion}`** (`company:grant`):
- Thứ tự khóa ADR-136: `taskflow:company:admins` → (nâng) `leave:<U>` rồi `punch:<U>` (D HIGH-1) → dòng actor FOR SHARE
  (`authorizeWrite`, luật self tuyệt đối ⇒ 403) → dòng người bị đổi FOR SHARE.
- **Nâng EMPLOYEE→ADMIN** (CO-08): departure `ROLE_CHANGED` `first_day = start_date`, `last_day` = hôm nay (ngày đổi vẫn tính
  công) → `offboardCleanup` (leave: PENDING ⇒ CANCELLED, APPROVED bắt đầu sau ⇒ REVOKED, vắt qua giữ; một thông báo
  `OFFBOARD_CLEANUP` cho HR) TRƯỚC khi UPDATE dòng → `promoteToAdmin` → thu hồi phiên (ADR-105) → audit `COMPANY_ROLE_SET`.
  Membership workspace giữ nguyên.
- **Hạ ADMIN→EMPLOYEE** (CO-09): nhiệm kỳ mới `start_date` = ngày mai, grants mới, thu hồi phiên; còn đúng một Admin ⇒ 409
  `last_admin` (phòng thủ — qua route luôn còn ≥ 2 vì người gọi là Admin khác).
- **Chỉ đổi grants** của EMPLOYEE: `GRANT_SET`, không thu hồi phiên (quyền đọc DB mỗi request).
- Admin + grants ⇒ 422 `GRANT_NOT_ALLOWED`; lệch version (hoặc role đổi giữa lúc đọc và lúc khóa) ⇒ 409 `VERSION_CONFLICT`;
  không thuộc công ty ⇒ 404 `user`. Có đổi ⇒ thông báo bền `ACCESS_CHANGED` (cùng transaction) + realtime
  `company:access-changed` sau commit.

**`GET /admin/workspaces`** (`company:admin`): mọi workspace — tên, OWNER, số thành viên, cờ mồ côi, xóa mềm / lưu trữ;
**không** dự án / task. Khi mồ côi: `members [{userId, fullName}]` để chọn người giao (TL chốt với B/E), còn lại `[]`.

**`POST /admin/workspaces/:id/owner {userId}`**: khóa `company:admins` → `authorizeWrite company:admin` → người được giao
phải còn thuộc công ty và **không** có lịch nghỉ, không thì 422 `NOT_WORKSPACE_MEMBER` → trong workspace: khóa dòng OWNER
(ADR-046) → còn OWNER ⇒ 409 `workspace_has_owner`; xóa mềm / lưu trữ ⇒ 409 `workspace_deleted`; không là thành viên ⇒ 422
`NOT_WORKSPACE_MEMBER` → role OWNER, `member:role-changed` sau commit, audit `WORKSPACE_OWNER_ASSIGNED`. Admin tự nhận
được chỉ khi vốn là thành viên ws.

**`POST /admin/workspaces/:id/archive`**: 0 thành viên ⇒ `archived_at` (có điều kiện, không purge, giữ dữ liệu); còn thành
viên ⇒ 409 `workspace_has_members`; đã lưu trữ ⇒ trả như cũ; audit `WORKSPACE_ARCHIVED`. Body strict `{}`.

`isOrphanWorkspace` (domain workspace, thuần) dùng chung với T-062 (`endMembership` báo ws mồ côi).

## File chính

- company: `application/use-cases/admin-access.use-cases.ts`, `admin-workspaces.use-cases.ts`; ports
  `offboard-leave.port.ts`, `access-events.port.ts`, `admin-workspaces.port.ts`; repo `listAll` / `setGrants` /
  `demoteToEmployee` (memory + Prisma — `prisma-company-roles.ts`); `presentation/admin.routes.ts` (`createAdminRouter`,
  `permitCompany`); `company.module.ts` (`routers()` gom `/hr` + `/admin`).
- workspace: `domain/workspace.ts` (`archivedAt`, `isOrphanWorkspace`), `IWorkspaceRepository.archive`,
  `IWorkspaceQueries.listForAdmin/findForAdmin`, `application/use-cases/admin-workspace-ops.ts`.
- auth: `findManyByIds`, `AuthAccounts.profiles`.
- composition: `company-adapters.ts` (`companyAdminDeps`: thông báo + realtime, `offboardLeaveFrom(() => leave.employment)`,
  `adminWorkspaces` đọc trễ), `container.ts`.
- contracts: `AdminWorkspaceDto.members`; OpenAPI 5 route `/admin/*`.

## Kiểm tra (exit code, máy chung, 2 worker)

`tsc` api 0 · `tsc` contracts 0 · typecheck web 0 (mirror của E khớp `members`) · eslint file đổi 0 · `lint:deps` 0 (520
module) · `vitest --project api` 0 — 155 file / 1646 test.

Test mới: use case access (10 — thứ tự khóa, ROLE_CHANGED, nhiệm kỳ 1 ngày, CO-09, last-admin, rollback khi thu hồi phiên
lỗi), use case workspaces company (4), `AdminWorkspaceOps` (5), HTTP admin (11 — gồm nâng Admin dọn đơn nghỉ thật qua leave
của D: CANCELLED / REVOKED / giữ, `decidedBy` = Admin, ghi chú hệ thống, một `OFFBOARD_CLEANUP`, Admin ⇒ 403 `leave:self`),
contract `findManyByIds`. Kiểm ngược: bỏ `lockEmployeeWork` / `offboardCleanup` / guard Admin cuối ⇒ mỗi lần 1 test đỏ.

**Integration (lượt máy sau D):** `company-admin-repos.int.ts` + `auth/auth-contracts.int.ts` (contract user repo Prisma, gồm
`findManyByIds`) — DB riêng, exit 0, 2 file / 20 test. Lượt 1 đỏ 1 ca do dữ liệu test (xóa mềm thiếu `purge_at` —
`workspaces_soft_delete_chk`), đã sửa.

## Quyết định tự đưa ra

- Mọi lệnh `/admin/*` ghi đều lấy `taskflow:company:admins` trước (đơn giản, hiếm) — cũng tuần tự hai Admin giao OWNER
  cùng một ws.
- Role đổi giữa lúc đọc không khóa và lúc khóa ⇒ 409 thay vì cố lấy khóa leave/punch muộn (sai thứ tự khóa).
- `hrRoutes` / `adminRoutes` bỏ khỏi `CompanyModule`; thay bằng `routers()` (container gắn một lần, giữ < 200 dòng).

## Việc cho người khác

- **B (T-062):** cherry-pick `d9b20bf`; dùng `isOrphanWorkspace`; tránh các method đã thêm ở `company-member.port.ts`.
- **E:** `members` trong `AdminWorkspaceDto` đã chốt; route 5 cái như OpenAPI.
- **F:** SEC-HR-30/31/32/38 + CO-08/09 có thể chạy trên route thật.
