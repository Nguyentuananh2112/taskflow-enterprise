# T-018 — Module Task: domain + use cases (TDD, InMemory)

**Giao cho:** Engineer C (`taskflow-enterprise-d7`) · **Phase:** 2 · **Phụ thuộc:** main ≥ b957a6d (core + auth + contracts + Prisma)

## Nguồn
`docs/design/test-spec-task.md` (~190 case — nguồn chính) · `docs/design/data-and-api.md` §1.2–1.3, §2.7, §4, §6 · `docs/design/security.md` (permission task, ADR-022/041/044/045) · DECISIONS (ADR-010–013, 015, 022, 041–045, 080, 091–093).

## Worktree
`../TaskFlow_wt/T-018`, branch `feat/T-018` từ `main`.

## Việc cần làm (test trước, theo mã case trong test spec)
1. Domain: aggregate `Task` — state machine (bảng `ALLOWED_TRANSITIONS` là nguồn sự thật — ADR-043), `rank` (fractional-indexing, tính từ `afterId`/`beforeId`, server là nguồn sự thật), `assignTo`, `update`, `softDelete`, `version` (no-op không tăng version; `expectedVersion` kiểm **trước** no-op — ADR-091), domain events đủ bộ (ADR-013).
2. `TaskPolicy` theo bảng permission (ADR-022/041/044/045): MEMBER sửa/move mọi task, xóa task của mình, gán theo `task:assign:own/any`, project archived cấm ghi (trừ bỏ gán hệ thống — ADR-092).
3. Use cases: CreateTask (cấp số TF-n — interface để Prisma làm `UPDATE … RETURNING`, InMemory mô phỏng), MoveTask (status + rank, `expectedVersion` → 409 kèm `details.current`), AssignTask, UpdateTask, DeleteTask, GetTask, ListTasksByProject (query CQRS-lite, ADR-015), ListTaskAuditLog (cursor).
4. Audit log ghi trong **cùng UoW** (ADR-012); realtime notifier gọi qua `uow.afterCommit` với payload đủ để FE không refetch (DTO đầy đủ + version — data-and-api §4).
5. Hiện thực port `ITaskAssignmentCleaner` (Workspace định nghĩa — B đang làm T-015; thống nhất chữ ký với B (`taskflow-enterprise-87`), dùng `import type` qua `modules/workspace/index.ts` type-only như cách Auth đã làm).
6. Parity test: `TASK_STATUS_TRANSITIONS` của contracts ↔ domain (ADR-043/080).
7. InMemory repositories rollback được với FakeUnitOfWork.

## Không làm
Prisma repository + test concurrency tầng I/C (ticket sau, ghi danh sách case tầng I/C chưa làm vào report), routes, Socket listener.

## Phạm vi sở hữu
`apps/api/src/modules/task/**`.

## Done
DoD; coverage domain ≥ 90%, application ≥ 80%; bảng truy vết case U → file test. Nhắn `DONE T-018 feat/T-018`.
