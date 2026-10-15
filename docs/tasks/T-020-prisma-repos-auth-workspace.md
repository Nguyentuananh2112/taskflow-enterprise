# T-020 — Prisma repositories cho Auth + Workspace, test tầng I (Postgres thật)

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 3 · **Phụ thuộc:** main ≥ 2ae41e9 (T-010 schema + T-014 + T-015)

## Nguồn
Port repository/query của `modules/auth` và `modules/workspace` · `docs/design/data-and-api.md` §1 (schema, index, khóa) · `docs/design/test-spec-auth-workspace.md` (các case tầng **I**) · `docs/design/security.md` §3.5–3.6 · DECISIONS (ADR-012, 015, 046, 047, 050, 051, 062, 093, 095).

## Worktree
`../TaskFlow_wt/T-020`, branch `feat/T-020` từ `main`.

## Việc 0 (commit riêng)
Sửa `docs/design/test-spec-auth-workspace.md` §0.2 và ROL-06: `unassignAllInWorkspace` → `unassignAllForUser({ workspaceId, userId, actorId })` cho khớp code (thêm file này vào phạm vi).

## Việc chính
1. Prisma repository/query cho mọi port của Auth (User, RefreshToken — `markRotated` có điều kiện, `revokeFamily`) và Workspace (Workspace, Membership — `lockOwners` bằng `SELECT … FOR UPDATE ORDER BY id`, assign `FOR SHARE`; Project — `nextTaskNumber` bằng `$queryRaw UPDATE … RETURNING`; purge theo lô với `pg_try_advisory_xact_lock`). Dùng `uow.db()` của `PrismaUnitOfWork` (T-009) — không tạo transaction riêng.
2. Phía đọc (CQRS-lite, ADR-015): query trả DTO thẳng bằng `select`, mọi query **có phạm vi tenant** và loại workspace đã xóa mềm.
3. Adapter `ISessionRevocationStore` trên Valkey (node-redis 6, `MGET` một round-trip, `SET NX`), fail-closed theo security.md.
4. **Test tầng I** (Postgres 5434 DB test, Valkey 6380 — dùng compose của D khi đã merge, trước đó container tạm và ghi lại): mọi case "I" của test spec phần Auth/Workspace, gồm race LAST_OWNER (ROL-05/07, lặp 20 lần, 3 biến thể), REM-07, unique slug/email, refresh rotation đồng thời (chỉ một bên thắng), restore vs purge race.
5. Chạy lại toàn bộ unit test use case với repo **Prisma** ở chế độ integration (cùng bộ test, đổi factory) để chứng minh LSP: InMemory ↔ Prisma cho cùng kết quả.

## Không làm
Routes/controller/middleware HTTP (ticket sau, chờ T-016 rev2).

## Phạm vi sở hữu
`apps/api/src/modules/auth/infrastructure/**`, `apps/api/src/modules/workspace/infrastructure/**`, `apps/api/test/integration/**` (phần auth/workspace), `docs/design/test-spec-auth-workspace.md` (Việc 0).

## Done
DoD + `pnpm --filter @taskflow/api test:integration` xanh (dán output); bảng case I → test. Không vượt chặn `migrate reset` của Prisma. Nhắn `DONE T-020 feat/T-020`.
