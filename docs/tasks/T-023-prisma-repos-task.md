# T-023 — Prisma repositories cho Task + test tầng I/C (đồng thời)

**Giao cho:** Engineer C (`taskflow-enterprise-d7`) · **Phase:** 3 · **Phụ thuộc:** main ≥ 4bbe537 (T-018, T-021, compose của D)

## Nguồn
Port của `modules/task` · `docs/design/test-spec-task.md` (case tầng **I** và **C** — danh sách trong report T-018) · `docs/design/data-and-api.md` §1.2–1.3 · DECISIONS (ADR-010–013, 062, 091, 104).

## Việc 0 (commit riêng)
- `test-spec-task.md` §3.2: thay rank ví dụ "b0"/"b1" bằng khóa fractional-indexing hợp lệ.
- Contracts: thêm `"route"` vào `NotFoundDetails.resource` (A báo ở T-021 — 404 route không xác định) hoặc đề xuất cách khác; parity test.

## Việc chính
1. Prisma repo/query: Task (optimistic lock `updateMany({ where: { id, version } })` ⇒ 409 kèm `details.current`), cấp số TF-n bằng `$queryRaw UPDATE projects … RETURNING` trong UoW, rank collation "C" + partial unique, retry khi trùng rank (3 lần), soft delete, audit log cùng transaction, query CQRS-lite có phạm vi tenant + cursor.
2. Hiện thực các port cross-module mà B cần (roleOf / ITaskProjectStore / IUserRefReader) nếu thuộc phía Task.
3. **Test tầng I/C** trên postgres-test (5434): cấp số TF-n đồng thời (50 request song song ⇒ số liên tục, không trùng), move đồng thời cùng task ⇒ đúng một bên thắng, rank va chạm ⇒ retry, collation "C" đúng thứ tự, FK kép chặn task sai workspace, audit không mất khi rollback.
4. Chạy lại bộ unit test use case Task với repo Prisma (LSP: InMemory ↔ Prisma).

## Phạm vi sở hữu
`apps/api/src/modules/task/infrastructure/**`, `apps/api/test/integration/**` (phần task), `packages/contracts/**` (Việc 0), `docs/design/test-spec-task.md`.

## Done
DoD + `test:integration` xanh trên compose (dán output). Không vượt chặn `migrate reset`. Nhắn `DONE T-023 feat/T-023`.
