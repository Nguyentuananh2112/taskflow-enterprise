# perf/task-read-raw — Báo cáo: đọc task bằng một câu SQL thay cho `findMany` lồng của Prisma

**Người làm:** Engineer A · **Branch:** `perf/task-read-raw` (từ main `3b16a6e`) · **Ngày:** 2026-10-16
**Căn cứ:** cpu-prof T-027c (`@prisma/client` ~33 % thời gian bận của API); đề xuất (A) được Tech Lead
duyệt 2026-10-16 sau bước 0; tiêu chí giữ/bỏ: điểm gãy 1 bản **+20 %** HOẶC CPU API ở 150 RPS **−15 %**,
không đạt thì **không merge**. B review SQL thô, D đo trước/sau.

## 1. Bước 0 (đo trước khi chọn)

Đo tạm trên Postgres test (5434), cột 200 task, test tạm đã xóa:

| | Câu SQL / lần đọc | CPU tiến trình (2 lượt × 100 lần) | wall |
|---|---|---|---|
| Prisma `findMany` + `select` lồng | **4** (tasks; `projects IN` 200 tham số; `users IN` × 2) | 8,3 / 6,4 ms | 10,6 / 9,8 ms |
| SQL thô 1 câu (JOIN) | **1** | 3,0 / 3,6 ms | 6,0 / 6,0 ms |

Kết quả 200 DTO của hai cách **bằng nhau** (`toEqual`). Phương án (B) `relationJoins` bị bác: Prisma
7.10.0 chỉ sinh `relationLoadStrategy` khi `isPreviewFeatureOn("relationJoins")` (`prisma/build/cli.js`)
⇒ vẫn preview; không chồng thêm preview (Tech Lead).

## 2. Đã làm

`apps/api/src/modules/task/infrastructure/persistence/prisma/prisma-task-read-model.ts`:

- `getTask` + `listTasks` = **một** `$queryRaw` (`Prisma.sql`, mọi giá trị là tham số):
  `tasks t JOIN projects p ON (p.id, p.workspace_id) = (t.project_id, t.workspace_id) JOIN workspaces w
  ON w.id = t.workspace_id AND w.deleted_at IS NULL LEFT JOIN users a/c`, `WHERE t.workspace_id = $ws AND
  t.project_id = $p AND t.deleted_at IS NULL AND …` — **3 điều kiện tenant + `deleted_at`** (ADR-020/047).
- `taskDtoOfRow` map dòng → `TaskDto` (giữ y hệt DTO cũ: `key`, `dueDate` ngày thuần, ISO string).
- Keyset khớp `ORDER BY t.status, t.rank, t.id`:
  - **có lọc status** (đường nóng của board, `?status=…&limit=200`): chỉ `(t.rank > $r OR (t.rank = $r AND
    t.id > $i))` ⇒ điều kiện index `project_id =, status =, rank >` (tiền tố `tasks_rank_live_key`).
    Cursor của status KHÁC (chỉ khi client tự chế) giữ đúng ngữ nghĩa so sánh bộ cũ: status đứng trước ⇒
    không lọc thêm; đứng sau ⇒ trả rỗng (không chạy SQL).
  - không lọc status: `t.status > $s OR (t.status = $s AND …)` (enum so theo thứ tự khai báo).
- `taskExists` (audit-log) và `listAuditLogs` giữ Prisma (không có quan hệ lồng nặng).

**Không đổi:** contract/DTO, phía ghi, middleware, FE, schema.

## 3. EXPLAIN (yêu cầu của Tech Lead)

Seed cỡ k6 (`load/seed/seed.sql`: 27 500 task, 25 project) trên DB riêng `taskflow_load_a3`; SQL + tham
số lấy nguyên từ log query của Prisma cho **cả câu cũ lẫn mới**. Output đầy đủ:
[perf-task-read-raw-explain.md](perf-task-read-raw-explain.md).

| Truy vấn | Index | Execution |
|---|---|---|
| Prisma cũ — trang 1 `status=TODO` limit 200 | Bitmap Index Scan **`tasks_rank_live_key`** (`project_id`, `status`) | 0,95 ms |
| Prisma cũ — trang 2 (cursor) | `tasks_rank_live_key` ×3 trong BitmapOr — **có một nhánh mâu thuẫn** (`status IN (sau) AND status = TODO`) do Prisma mở `OR` 3 nhánh | 0,62 ms |
| **Raw — trang 1** | **`tasks_rank_live_key`** (`project_id`, `status`) | 1,15 ms (gồm JOIN 2 user — Prisma làm bằng 3 câu riêng) |
| **Raw — trang 2 (cursor)** | **`tasks_rank_live_key`** (`project_id`, `status`, `rank >`) + (`rank =`) | 0,68 ms |
| Prisma cũ — không lọc status, cursor | `tasks_project_id_number_key` (đọc 2000 dòng của project) | 3,91 ms |
| Raw — không lọc status, cursor | `tasks_project_id_number_key` (như cũ) | 2,66 ms |

⇒ Đường nóng dùng **`tasks_rank_live_key`** ở cả hai trang; không trường hợp nào raw tệ hơn Prisma. Đường
không lọc status (board không dùng) như cũ — đọc cả project rồi sort; chỉ đáng index riêng nếu sau này có
màn danh sách lớn không lọc.

Ghi chú bước 0: với 200 dòng planner chọn seq scan; so sánh bộ `(status, rank, id) > (…)` không khớp tiền
tố index ⇒ đã viết keyset dạng tách như trên.

## 4. Test

- Bộ `task.queries.test.ts` chạy **cả InMemory và Postgres** (runner LSP `task.task.queries.lsp.int.ts`) —
  14 test, gồm sẵn có: sắp status → rank → id, lọc status/assignee/`none`, phân trang 45 task, UC-LS11 DTO
  đầy đủ + user ẩn danh "Người dùng đã xóa", collation "C" (UC-MV23 ở `task-persistence.int.ts`), workspace
  đã xóa ⇒ 404, cursor sai ⇒ 400. Thêm:
  - phân trang từng task (limit 1) qua ranh giới status, không lọc ⇒ đúng thứ tự, không trùng/sót;
  - lọc status + cursor của status khác ⇒ trước: cả cột; sau: rỗng; cùng status: sau `(rank, id)`.

## 5. Kết quả lệnh

Worktree `D:\TaskFlow_wt\T-024`, base main `3b16a6e` (không đổi lúc chạy), sau `pnpm install --frozen-lockfile`:

| Lệnh | Exit | Kết quả |
|---|---|---|
| `VITEST_MAX_WORKERS=2 VALKEY_URL_TEST=redis://127.0.0.1:6380/14 REQUIRE_INTEGRATION=1 pnpm verify` | **0** | lint 0 · typecheck 0 · test 0 (1739) · audit 0 |
| `pnpm --filter @taskflow/api test:integration` — **toàn bộ** (DB riêng `taskflow_a3`, Valkey db 14, không `VITEST_MAX_WORKERS`) | **0** | 44 file / 387 test (gồm runner LSP của mọi module) |

## 6. Việc còn lại

- **D đo trước/sau** khi máy yên: `load/run.sh` board 8 bậc + `CPU_PROF=1` (1 bản), so điểm gãy và CPU API ở
  150 RPS với lượt T-027c. **Không đạt tiêu chí ⇒ không merge** (giữ Prisma vì dễ bảo trì hơn).
- **B review** SQL thô: tham số hóa, phạm vi tenant 3 điều kiện + `deleted_at`.
- Rủi ro bảo trì: đổi cột `tasks`/`users`/`projects` ⇒ sửa `SELECT` + `TaskRow` (ghi trong comment đầu
  file); test LSP + `toEqual` DTO sẽ đỏ nếu lệch.
- DB `taskflow_load_a3` (5434) giữ lại cho lần đo lại; xóa khi merge.
