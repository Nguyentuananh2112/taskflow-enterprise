# T-015 Report — Module Workspace / Member / Project (TDD, InMemory)

**Người làm:** Engineer B · **Branch:** `feat/T-015` (rebase trên `main` 6378fef — đã có T-010, T-012) · **Ngày:** 2026-10-15

## Commit

```
a768f8d feat(T-015): workspace/member/project module — domain, use cases, adapters
95b5423 feat(T-015): expose access-token exp on AuthenticatedUser   ← commit riêng, nhỏ (quyết định 1)
```

`95b5423` là bản sau rebase của `774ba4b` đã báo A (nội dung giống hệt). A cherry-pick bản nào cũng merge sạch.

## Quyết định của Tech Lead trong ticket này (ghi theo yêu cầu)

1. **`exp` trong `AuthenticatedUser`:** cho phép mở rộng phạm vi sang `modules/auth` đúng cho thay đổi này, làm **commit riêng đầu tiên** để A (T-016) cherry-pick. Đã làm: `95b5423` (2 file, có test).
2. **Phụ thuộc giữa module — phương án chặt:**
   - `modules/auth/index.ts` và `modules/workspace/index.ts` **chỉ export type**. Mỗi file có test khẳng định `Object.keys(module) === []`.
   - Workspace `import type` qua `modules/auth` và khai `implements IWorkspaceProvisioner` / `implements IMembershipReader` tường minh. Phụ thuộc một chiều Workspace → Auth, chỉ ở mức type. Auth không import Workspace.
   - `pnpm lint:deps`: **0 vi phạm** (180 module). Rule `no-circular` **đã có sẵn** trong `packages/config/depcruise/api.cjs` (áp cho mọi file, kể cả giữa module), cùng `module-public-api-only` — không cần A bổ sung.
3. **(Phát sinh) Port liên module có ≥ 2 tham số cùng kiểu ⇒ object có tên.** C đề xuất, Tech Lead chốt. Đã áp dụng cho:
   - `ITaskAssignmentCleaner`;
   - `IWorkspaceRealtimeNotifier` (3 method);
   - `IProjectAccessChecker`.
   A đã đổi gateway theo đúng các chữ ký này.

## Đã làm

Đường dẫn tương đối với `apps/api/src/modules/workspace/`.

| Ticket | File | Ghi chú |
|---|---|---|
| 1. Domain | `domain/workspace.ts`, `membership.ts`, `project.ts`, `names.ts` | Workspace: slug R19 (kiểm định dạng ở entity), `softDelete` (purgeAt = +30 ngày), `isRestorable`. Membership: `changeRole` trả `false` khi không đổi (ROL-08). Project: keyPrefix R17 bất biến, description ≤ 2000 (rỗng ⇒ null), `update` ném `ProjectArchivedError`, archive/unarchive idempotent. `slugifyName`: bỏ dấu tiếng Việt, `đ→d`, cắt 40 ký tự, không kết thúc bằng `-`. |
| 2. Permission | `domain/roles.ts` | Bảng chính thức security.md 3.2. `roleAllows` hỗ trợ permission cha `task:assign` / `task:delete` (thỏa khi có `:any` hoặc `:own`) cho middleware chặn sớm. **Parity test** với `ROLE_PERMISSIONS` của contracts: `application/role-permissions-parity.test.ts` (đặt ở application vì domain không import contracts — ADR-043). |
| 3. Use cases | `application/use-cases/*` | CreateWorkspace, ListMyWorkspaces / GetWorkspace (`workspace.queries.ts`), UpdateWorkspace, DeleteWorkspace, RestoreWorkspace, PurgeDeletedWorkspaces (`*.job.ts`), AddMember, ChangeMemberRole, RemoveMember (gồm tự rời), ListMembers (`q`), CreateProject, UpdateProject, SetProjectArchived, ListProjects / GetProject. Use case nhận `Actor` do middleware dựng; mọi truy vấn lọc theo `actor.workspaceId`. |
| 4. Port của Auth | `application/adapters/workspace-provisioner.ts`, `membership-reader.ts` | `implements` tường minh qua `modules/auth`. Provisioner tạo ws (slug từ họ tên theo R19, `attempt`), OWNER, project mặc định. Trùng slug ⇒ `ResourceConflictError` field `slug` (khớp hợp đồng Register). |
| 4b. Port của socket | `application/adapters/project-access-checker.ts`, `workspace-access.ts` | `canAccessProject({ userId, workspaceId, projectId })` — archived vẫn `true`. `WorkspaceAccess.resolveActor` = lõi của `loadMembership`: không phải member / ws không tồn tại / đã xóa ⇒ cùng `404 workspace`. |
| 5. `ITaskAssignmentCleaner` | `application/ports/collaborators.port.ts` | Chữ ký theo **test-spec-task.md §3.3** (đã duyệt ADR-090), chốt với C: `unassignAllForUser({ workspaceId, userId, actorId }) → { unassignedTaskCount }`. Gọi TRONG transaction khi hạ xuống VIEWER và khi xóa/tự rời. |
| 6. InMemory | `infrastructure/persistence/in-memory/*`, `testing/harness.ts` | Repo có snapshot/restore (FakeUnitOfWork rollback thật), mô phỏng unique: slug toàn bảng kể cả ws đã xóa, `(ws, user)`, `(ws, keyPrefix)`. `InMemoryWorkspaceQueries`, `InMemoryUserDirectory`, `InMemoryWorkspacePurger` (cascade 3 bảng, kiểm lại purgeAt). |

Realtime và log chỉ chạy trong `uow.afterCommit`; test kiểm `duringTransaction: false` qua `createSpy(uow)`.

## Bảng truy vết case "tầng U" (test-spec-auth-workspace.md §2–4) → test

Tiền tố: `apps/api/src/modules/workspace/`. `(U*)` = case gốc là I, có thêm bản mức U ở đây.

| Case | File test |
|---|---|
| WSC-01, 02, 04, 04b, 05, 08, 09, 10; WSC-03 (U*) | `application/use-cases/workspace.use-cases.test.ts` (+ `domain/names.test.ts`, `application/slug-rules.test.ts` cho R19) |
| WSU-01, 02, 04; WSU-03 (U*) | như trên |
| WSD-01, 02, 03; WSD-05 (U*) | `application/use-cases/workspace-lifecycle.test.ts` |
| WSR-01, 04, 08; WSR-02, 03, 05 (U*) | như trên |
| Job purge (ADR-095) | như trên (3 test: quá hạn/còn hạn/idempotent, bị khôi phục giữa chừng, theo lô) |
| WSR-07 | **Chưa có route.** Ở mức use case: `RestoreWorkspaceUseCase` tự kiểm OWNER trên ws đã xóa, còn `WorkspaceAccess` (lõi loadMembership) **không có** cờ `includeDeleted` — ws đã xóa luôn 404 (`adapters.test.ts`). Test "duyệt bảng route" thuộc ticket presentation. |
| MEM-01, 02, 03, 04, 05, 06, 07, 09 | `application/use-cases/members-add-list.test.ts` |
| MLS-04; MLS-01, 02, 03 (U*) | như trên (+ phân trang, limit 1–100) |
| ROL-01, 02, 03, 04, 06, 08, 09, 10 | `application/use-cases/members-role-remove.test.ts` |
| ROL-06b | Thuộc hiện thực `ITaskAssignmentCleaner` (module Task, C — T-018): bỏ gán cả trong project archived. Workspace chỉ đảm bảo luôn gọi cleaner. |
| REM-01, 02, 03, 04, 05, 06, 10 | `application/use-cases/members-role-remove.test.ts` |
| PRJ-01, 02, 05, 06; PRJ-03/04 (U*) | `application/use-cases/projects.use-cases.test.ts` |
| PRU-01, 02, 03, 04; PRU-05 (U*) | như trên |
| ARC-01, 02, 03, 05; ARC-04 (U*) | như trên |
| Domain / permission | `domain/*.test.ts`, `application/role-permissions-parity.test.ts` |
| Adapter (provisioner, reader, access) | `application/adapters/adapters.test.ts` |

**Case tầng I để lại cho ticket Prisma/HTTP:**
- Race LAST_OWNER: ROL-05, REM-07. Khóa `lockOwners` = `SELECT … FOR UPDATE ORDER BY id`.
- Race assign vs hạ VIEWER: ROL-07 (`FOR SHARE` ở module Task).
- Unique thật: WSC-03, WSU-03, PRJ-03/04.
- HTTP/404 chuẩn/rate limit: WSC-06/07, WSL-01..04, WSD-04..07, WSR-02..06, MLS-01..03/05, MEM-08/10/11, REM-08/09, PRJ-07, PRU-05, ARC-04/06/07.

## Definition of Done (worktree, Windows, Node 24.18.0, pnpm 11.28.2)

```
$ pnpm typecheck   → apps/api, apps/web, packages/*: Done
$ pnpm lint        → prettier ✔ · eslint ✔ · depcruise api: ✔ no dependency violations found (180 modules, 573 dependencies cruised)
$ pnpm test        → Test Files 73 passed (73) · Tests 742 passed (742)

$ vitest --project api --coverage (include **/modules/workspace/**, trừ *.test.ts, testing/**, *.port.ts, index.ts)
Statements 96.31% · Branches 93.65% · Functions 95.18% · Lines 97.71%
  domain          statements 92.4%  branches 100.0%   (yêu cầu ≥ 90%)
  application     statements 97.0%  branches 93.1%    (yêu cầu ≥ 80%)
  infrastructure  statements 98.3%  branches 91.3%
```

## Quyết định tự đưa ra

1. **Tên mặc định khi đăng ký** (spec không nêu): workspace `"Workspace của {fullName}"` (cắt 100 ký tự), project `"Dự án đầu tiên"`, keyPrefix `TF`.
2. **Slug:** client gửi slug trùng ⇒ 409 ngay (không thử lại). Chỉ slug tự sinh mới thử lại tối đa 5 lần. Slug dành riêng ⇒ cùng lỗi (message + details) với slug đã có người dùng.
3. **Thứ tự lỗi:**
   - Use case: `403` quyền chung (từ role của actor) → `404` (user/project ∉ ws) → `403` theo role mục tiêu (PM xóa OWNER/PM) → `422` (LAST_OWNER / PROJECT_ARCHIVED).
   - AddMember: kiểm quyền cấp role **trước** khi tra email (MEM-03).
4. **LAST_OWNER:** luôn `lockOwners` trước khi đọc dòng mục tiêu (`owner-guard.ts`). Chỉ kiểm khi thao tác làm mục tiêu mất OWNER.
5. **RemoveMember luôn gọi cleaner** (cả khi tự rời). ChangeMemberRole chỉ gọi khi thật sự đổi sang VIEWER.
6. **Restore:** `uow.run` gồm kiểm OWNER + `restoreIfWithinGrace` (UPDATE có điều kiện). Log `workspace.restored` sau commit. Không gọi notifier.
7. **Purge:** một port `IWorkspacePurger` (Prisma: advisory xact lock + xóa theo lô + kiểm lại purge_at). Mỗi workspace một transaction. Job trả `{ purged, skipped }`.
8. **`IUserDirectory`:** port của Workspace; bản Prisma đọc bảng `users` trực tiếp (chỉ đọc), không đi qua module auth. Chuẩn hóa email (trim, NFC, lowercase) được **lặp lại** trong Workspace (`normalizeEmail`) vì không import runtime từ auth. Ứng viên đưa vào core sau.
9. **Phân trang ở application:** keyset `{ after: id, limit }` ⇒ `{ items, nextAfter }`. Presentation mã hóa/giải mã cursor bằng `encodeCursor` / `decodeCursor` của core.

## Rủi ro / ghi chú

- **Lệch tài liệu:** `test-spec-auth-workspace.md` (spec của tôi), mục §0.2 và ROL-06, vẫn ghi `unassignAllInWorkspace(A, Mia, Alice)`. Chữ ký chuẩn là `unassignAllForUser({ … }) → { unassignedTaskCount }` theo test-spec-task.md §3.3. File ngoài phạm vi T-015 — nhờ Tech Lead sửa (hoặc giao tôi).
- **Gateway (A) ở `src/core/realtime`** nên không `implements` được port của Workspace (core-no-modules). Kiểm khớp chữ ký xảy ra ở composition root. A khai bản sao `RealtimeEventMeta` / `WorkspaceRole` cùng hình dạng. `WorkspaceProjectAccessChecker` cũng implements bản sao cục bộ của `IProjectAccessChecker` vì cùng lý do.
- **ADR-045 vs ADR-092:** bỏ gán trong project archived là việc của C. Đã ghi rõ trong JSDoc của port.
- **InMemory không chứng minh được khóa.** Mọi khẳng định race nằm ở test I (danh sách trên).
