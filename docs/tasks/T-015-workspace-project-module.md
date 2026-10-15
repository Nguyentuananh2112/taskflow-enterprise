# T-015 — Module Workspace / Member / Project: domain + use cases (TDD, InMemory)

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 2 · **Phụ thuộc:** main ≥ 92ab432 (core + auth)

## Nguồn
`docs/design/test-spec-auth-workspace.md` (phần Workspace/Member/Project) · `docs/design/security.md` §3 (permission, LAST_OWNER, ADR-044/046) · `docs/design/data-and-api.md` §1.7–1.9, §2.5–2.6, R14–R19 · DECISIONS (ADR-020–023, 041–047, 050, 051, 092–095).

## Worktree
`../TaskFlow_wt/T-015`, branch `feat/T-015` từ `main`.

## Việc cần làm (test trước, theo mã case trong test spec)
1. Domain: aggregate `Workspace` (slug R19, xóa mềm/khôi phục 30 ngày, purge_at), `Membership` (role, LAST_OWNER), `Project` (keyPrefix bất biến, archive/unarchive, `nextTaskNumber`).
2. `RolePolicy`/`WorkspacePolicy`: bảng permission chính thức của security.md (dùng chung được cho middleware RBAC sau này). Domain không import contracts (ADR-043) — parity test với `ROLE_PERMISSIONS` của contracts **thêm sau khi T-010 merge**, ghi TODO.
3. Use cases: CreateWorkspace, ListMyWorkspaces, GetWorkspace, UpdateWorkspace, DeleteWorkspace, RestoreWorkspace, PurgeDeletedWorkspaces (job, ADR-095), AddMember, ChangeMemberRole, RemoveMember/Leave, ListMembers (`q`), CreateProject, UpdateProject, Archive/UnarchiveProject, ListProjects.
4. **Hiện thực các port mà Auth đã định nghĩa** (ADR-093): `IWorkspaceProvisioner` (hợp đồng attempt + `ResourceConflictError` field `slug`) và `IMembershipReader`. Đặt adapter ở module Workspace, wire ở composition root — Auth không import Workspace.
5. Port `ITaskAssignmentCleaner` do Workspace định nghĩa (module Task sẽ hiện thực); InMemory fake cho test bỏ gán khi hạ VIEWER / xóa thành viên.
6. InMemory repositories (rollback được với FakeUnitOfWork của A). Ghi rõ những case tầng I (race LAST_OWNER, FOR UPDATE) để làm ở ticket Prisma sau.

## Không làm
Prisma repository, routes/controller, middleware RBAC HTTP (ticket sau).

## Phạm vi sở hữu
`apps/api/src/modules/workspace/**` (module mới), cùng mục wiring tối thiểu nếu cần ghi trong report (không sửa `app.ts`).

## Done
DoD; coverage domain ≥ 90%, application ≥ 80%; bảng truy vết case U → file test. Nhắn `DONE T-015 feat/T-015`.
