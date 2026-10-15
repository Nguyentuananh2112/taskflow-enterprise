# T-023 — Báo cáo: Prisma repositories cho Task + test tầng I/C

**Người làm:** Engineer C (`taskflow-enterprise-d7`) · **Branch:** `feat/T-023`, rebase trên `main` @ `31f30cd` (đã có T-020).
**DB test:** `taskflow_t023` trên `taskflow-postgres-test-1` (cổng 5434, user `taskflow_migrator`), tạo theo quy tắc DB test của Tech Lead. Valkey `redis://127.0.0.1:6380/3` (DB index riêng để không giẫm dữ liệu phiên khác). Không dùng `taskflow_template`.

## 1. Commit
| Commit | Nội dung |
|---|---|
| `63c3ec2` | **Việc 0**: rank hợp lệ trong `test-spec-task.md` §3.2 (`"a5"/"a6"` thay `"b0"/"b1"`); contracts `NotFoundDetails.resource` thêm `"route"`; parity `ResourceKind` (core) ↔ contracts ở mức **kiểu** (lệch ⇒ typecheck đỏ) và runtime |
| `9ee6aa5` | Repository Prisma của Task + harness test không phụ thuộc backend (`TaskBackend`) |
| `8b43375` | Test I/C + 6 runner LSP; wire `task` vào `createPrismaPersistence` (`modules.task = 'prisma'`); `TaskRepositories` trong `task.module.ts` |
| `c7ee80e` | `.env.example`: `PERSISTENCE_TASK=prisma`; test khởi động `main.ts` thật ở staging với Prisma đầy đủ |
| `d44307a` | Sửa 4 phát hiện Low của audit bảo mật T-028 (B) — mục 4 |

## 2. Repository Prisma (`modules/task/infrastructure/persistence/prisma/`)
- **`PrismaTaskRepository`**:
  - `findLive` có phạm vi tenant và loại workspace đã xóa mềm.
  - `save` là **một câu UPDATE nguyên tử**, điều kiện gồm: `id + projectId + workspaceId + version = expected`, project chưa archive và ws chưa xóa. `count = 0` ⇒ use case đọc lại để trả `422 PROJECT_ARCHIVED` hoặc `409 VERSION_CONFLICT` kèm `details.current`.
  - Trùng `tasks_rank_live_key` ⇒ `RankConflictError` ⇒ use case thử lại **cả transaction** tối đa 3 lần (Postgres hủy transaction khi vi phạm unique).
  - `listAssignedForUpdate`: `SELECT … ORDER BY id FOR UPDATE`.
  - Hàng xóm rank tính bằng `gt/lt/ORDER BY` dưới collation "C".
- **`PrismaTaskAuditLogRepository`**: append-only, chạy trong UoW của lệnh, `null` ⇒ SQL NULL (`Prisma.DbNull`).
- **`PrismaTaskReadModel`**: CQRS-lite (`select` → DTO). Keyset `(status, rank, id)`: Prisma không có `gt` cho enum nên tách thành `status IN (các cột sau) OR …`. Lịch sử audit có phạm vi `workspaceId + projectId + taskId`.
- Port liên module dùng adapter của B (T-020) trên cùng `uow.db()`: `PrismaTaskProjectStore` (cấp số `UPDATE … RETURNING`), `PrismaAssigneeDirectory` (`FOR SHARE OF m`), `PrismaUserRefReader`.
- **Composition**: `createPrismaPersistence` có `task` ⇒ production khởi động với Prisma đầy đủ. `createMemoryPersistence` **giữ nguyên** theo đề nghị của A: cầu nối bộ nhớ đã có ở T-024 (`task-mirrors.ts`). Vì vậy `Persistence.task` tạm để **tùy chọn**; A đổi thành bắt buộc khi gắn bản bộ nhớ.

## 3. Test
- **LSP**: cùng một bộ test use case của Task (6 file) chạy trên InMemory (tầng A) và Postgres (`test/integration/lsp/task.*.lsp.int.ts`). Chạy trên Postgres lộ ra một lỗi thật của harness: task seed trùng `(project_id, number)` với số mà use case vừa cấp, trong khi InMemory không kiểm. Đã sửa.
- **Tầng I** (`test/integration/task/task-persistence.int.ts`): UC-CR16..CR19, UC-MV23 (thứ tự SQL dưới "C", rank hỗn hợp hoa/thường, move bằng fractional-indexing thật), UC-UP11, UC-DL11..DL13, UC-LS05, UC-AU04, workspace xóa mềm ⇒ 404. UC-CR20..22 và UC-AU07 đã có ở `constraints.int.ts` (T-010).
- **Tầng C** (`task-concurrency.int.ts`, `TASK_CC_REPEAT`: mặc định 1, nightly 20):
  - CC-CR01 + CC-CR05: 50 create song song ⇒ đúng {1..50}, bộ đếm 51, rank không trùng.
  - CC-CR02, CC-CR03 (đúng 1 lỗ số), CC-CR04 (create ‖ archive).
  - CC-MV01/02: 10 move ⇒ 1 thắng, 9 lần 409 với `current.version = 2`, đúng 1 audit.
  - CC-MV03: va chạm rank ⇒ retry, cả hai thành công.
  - CC-MV04, CC-DL01.
  - CC-AR01: update ‖ archive ⇒ chỉ 200/422.
  - CC-UN01: assign ‖ hạ VIEWER ⇒ không bao giờ có VIEWER được gán; Workspace được mô phỏng bằng `FOR UPDATE` membership + cleaner thật.
  - Đã lặp 5 lượt: 50/50 xanh.
- **Khởi động**: `test/integration/startup/task-prisma-startup.int.ts` chạy `main.ts` thật, `APP_ENV=staging`, không đặt `PERSISTENCE*` (dùng mặc định) ⇒ `/readyz` 200, không có cảnh báo module bộ nhớ. Unit test `persistence.test.ts` khẳng định `modules = { auth, workspace, task: 'prisma' }` qua được guard production. *Lưu ý trung thực:* trước T-023 guard cũng không chặn, vì `modules` lúc đó **không có** `task` (chứ không phải `task: 'memory'`). Test này chứng minh trạng thái mới, không phải hồi quy của trạng thái cũ.

## 4. Audit bảo mật T-028 (B) — đã sửa cả 4 mục Low
| # | Vấn đề | Sửa | Test |
|---|---|---|---|
| L1 | Race archive ‖ update/move/assign/delete lách được ADR-023/045 | Điều kiện "project chưa archive" nằm **trong** câu UPDATE (READ COMMITTED: archive đã commit luôn được thấy). Không thêm khóa `FOR SHARE`. Chỉ cleaner bỏ qua (`allowArchivedProject`, ADR-092) | Chèn archive đúng giữa lúc kiểm và lúc ghi, cho 4 lệnh, trên cả 2 backend + CC-AR01 |
| L2 | `save` không có phạm vi tenant | where `{ id, projectId, workspaceId, version }` ở cả 2 backend | Task giả mạo workspace ⇒ không ghi |
| L3 | `listAuditLogs` chỉ lọc theo `taskId` | Port `listAuditLogs(workspaceId, projectId, taskId, …)` | Project khác ⇒ rỗng |
| L4 | Cursor có id không phải uuid ⇒ 500 | `id: z.uuid()`, `rank.max(1024)` | Cursor đúng định dạng nhưng id sai ⇒ 400 |

Các mục Info của B: không thêm chỗ log lỗi Prisma thô nào (liên quan T-031 mục 0 của A). Lỗi `(project_id, number)` trùng hay priority sai enum vẫn ra 500 như trước; cả hai không xảy ra qua luồng hợp lệ.

## 5. Definition of Done (sau rebase lên `31f30cd`)
```
$ pnpm typecheck && pnpm lint && pnpm test --maxWorkers=2          # exit 0
apps/api lint:deps: ✔ no dependency violations found (288 modules, 1099 dependencies cruised)
apps/web lint:deps: ✔ no dependency violations found (170 modules, 382 dependencies cruised)
 Test Files  117 passed (117)
      Tests  1215 passed (1215)

$ CHECKPOINT_DISABLE=1 \
  DATABASE_URL_TEST=postgresql://taskflow_migrator:***@127.0.0.1:5434/taskflow_t023 \
  VALKEY_URL_TEST=redis://127.0.0.1:6380/3 \
  pnpm --filter @taskflow/api test:integration --maxWorkers=2        # exit 0
No difference detected.            # migrate diff rỗng (ADR-062)
 Test Files  32 passed (32)
      Tests  329 passed (329)
```
Mọi commit đều chạy qua hook lefthook (gitleaks, prettier, eslint), không dùng `--no-verify`. Không chạy `migrate reset`: globalSetup dựng lại schema bằng `migrate deploy` trên DB riêng.

## 6. Quyết định tự đưa ra
1. L1 sửa bằng điều kiện trong câu UPDATE thay vì `SELECT … FOR SHARE` project. Lý do: không tạo khóa dính giữa create (UPDATE dòng project) và các lệnh sửa; thứ tự kết quả vẫn tương đương tuần tự. B đồng ý.
2. Parity `resource` đặt ở `apps/api/test/`, vì contracts không import được API.
3. CC-UN01 mô phỏng thứ tự khóa của `ChangeMemberRole`, không gọi use case của module khác.
4. Valkey test dùng DB index `/3` riêng.
5. UC-LS12 (`EXPLAIN` với ≥ 10 000 task) để nightly theo đặc tả, chưa viết.

## 7. Việc cho người khác / câu hỏi mở
- **Tech Lead**: bảng mã lỗi trong `data-and-api.md` §3.2 (dòng `RESOURCE_NOT_FOUND`) chưa ghi `"route"`. File này không thuộc phạm vi T-023.
- **A (T-024)**: gắn `task` vào `createMemoryPersistence` (task-mirrors) rồi đổi `Persistence.task` thành bắt buộc. Cờ `PERSISTENCE_TASK` (dạng lai) A xử lý trong `main.ts`.
- Dọn máy theo ADR-107: đã gỡ worktree T-010, T-018 (đã merge, kiểm sạch trước khi xóa). Còn các thư mục `D:\TaskFlow_wt\T-011`, `T-015`, `T-016` không còn trong `git worktree list` (của người khác). Tôi không đụng.
