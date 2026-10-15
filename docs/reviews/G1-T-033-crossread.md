# G1 — Đọc chéo T-033 (scheduler bảo trì + rebalance rank) — góc đồng thời / tenant

**Người đọc:** Engineer B · **Chủ code:** Engineer C · **Mốc:** `main` sau merge `637e489` · **Ngày:** 2026-10-15
**Cách làm:** đọc mã trên `main` (chỉ đọc), mỗi finding High được B kiểm lại trực tiếp trên code. Không sửa code của người khác (BACKLOG G1).

## Findings

### High

**F1 — Kéo task TRONG CHÍNH CỘT CỦA NÓ khi rebalance chạy ⇒ task kẹt ở rank tạm `~<id>` ⇒ tạo task / kéo xuống cuối cột đó trả 500 vĩnh viễn**

| | |
|---|---|
| Vị trí | `task-rank-rebalancer.ts` (vòng lặp bỏ qua task đang kéo), `prisma-task.repository.ts:105-108` (`stashColumnRanks`), `move-task.use-case.ts:57-60`, `task.ts:123` |
| Cơ chế | Pha 1 `stashColumnRanks` đặt `rank = '~' \|\| id` cho **mọi** task sống của cột đích, gồm cả task đang kéo nếu nó vốn ở cột đó. Vòng lặp rebalancer gặp task đang kéo thì `movingRank = key; continue` — không ghi. Use case gọi `task.moveTo(target, rank)`; nếu khóa mới **trùng** rank cũ (`spread()` sinh `a0, a1, a2…` — đúng các khóa append thường dùng ⇒ trùng là chuyện thật) thì `moveTo` trả `false` và use case **trả DTO mà không save** ⇒ transaction commit với rank `~<uuid>`. |
| Kịch bản | Cột: P=`a0`, Q=`a1`, R=`a2`, L=`a2VVVV…` (dài, sau nhiều lần thả sát nhau), X=`a3`. Kéo X lên ngay trên L (`afterId=R`) ⇒ `wanted` > 64 ký tự ⇒ rebalance ⇒ thứ tự mới P,Q,R,X,L ⇒ khóa của X = `a3` = rank cũ ⇒ không save. |
| Hậu quả | X nhảy xuống cuối cột (`~` sắp sau mọi ký tự). `lastRank` = `~…` ⇒ `generateKeyBetween('~…', null)` ném "invalid order key head" ⇒ **mọi** tạo task (cột TODO) và kéo xuống cuối cột đó trả 500 cho tới khi sửa dữ liệu tay. MEMBER bất kỳ gây ra được bằng thao tác kéo thả bình thường. |
| Vì sao test không bắt | `rank-rebalance.test.ts` và CC-RB01 chỉ kéo task **từ cột khác** vào. |
| Đề xuất | Trong `MoveTaskUseCase`: khi rebalance đã chạy mà `moveTo` trả `false` ⇒ vẫn `tasks.save(task, expectedVersion)` (giống nhánh của task khác trong rebalancer); hoặc loại `moving.id` khỏi stash. Test: kéo trong cùng cột có rebalance ⇒ DB không còn rank `~`. Lưới an toàn tùy chọn: `CHECK (rank !~ '^~')` `DEFERRABLE INITIALLY DEFERRED`. Dữ liệu đã có: `SELECT id FROM tasks WHERE rank LIKE '~%' AND deleted_at IS NULL`. |

### Medium

| ID | Lỗi | Vị trí | Đề xuất |
|---|---|---|---|
| F2 | Rebalance cột lớn vượt timeout transaction 10s. Mỗi task: UPDATE có version, INSERT audit, `buildTaskDto` (tra user), 1 event realtime. Cột 3.000–5.000 task ⇒ P2028, 500, **không retry**; cột không đổi ⇒ thả lại vào chỗ đó lại rebalance lại lỗi. Trong lúc chạy giữ khóa cột + khóa dòng cả cột tới 10s. Phụ: n dòng audit `MOVED`, n event `task:moved` (vài MB / socket). | `task-rank-rebalancer.ts:50-71`; `composition/persistence.ts:93`; `task-commands.ts:110-152` | UPDATE hàng loạt `… FROM (VALUES …)` kèm `version + 1`; audit hàng loạt; tra user một lần; một event `task:column_rebalanced` thay vì n event; hoặc timeout riêng / trần n. T-027 đo 5.000 task. |
| F3 | `pg_advisory_xact_lock` chờ **không giới hạn**. Một rebalance giữ khóa vài giây ⇒ `DATABASE_POOL_MAX` request tạo / kéo vào cùng cột giữ hết connection ⇒ request của **workspace khác** trên instance đó lỗi chờ pool ⇒ ảnh hưởng chéo tenant. | `prisma-task.repository.ts:91-94`; gọi từ create / move | `SET LOCAL lock_timeout = '2s'` trước khi khóa, map SQLSTATE 55P03 ⇒ 409 / 503 thử lại được; hoặc `pg_try_advisory_xact_lock` + vòng thử ngắn. |
| F4 | Một workspace lỗi làm **dừng cả lượt purge, mọi lượt, mãi mãi**: không try/catch theo workspace, sắp theo `purgeAt asc` ⇒ workspace lỗi luôn đứng đầu. | `purge-deleted-workspaces.job.ts:30-38`; `maintenance-jobs.ts:120-128` | Bắt lỗi từng workspace (trừ `PurgeRunBusyError`), log `{workspaceId, errCode}`, đếm failed rồi đi tiếp; timeout riêng hoặc chia nhiều transaction cho workspace lớn. *(Use case purge là của B — B sửa phần try/catch nếu Tech Lead giao.)* |

### Low

| ID | Lỗi | Đề xuất |
|---|---|---|
| F5 | Hai rebalance chéo cột cùng project (A→B ‖ B→A) có thể deadlock (stash khóa cả cột đích, rồi save task nguồn) ⇒ 40P01 không được map ⇒ 500. | Khóa cả cột nguồn, theo thứ tự cố định; hoặc map 40P01 / 40001 ⇒ thử lại trong `inTransactionWithRankRetry`. |
| F6 | Lượt purge đầu tiên chỉ chạy sau **một chu kỳ đầy đủ** (60–65 phút); restart thường xuyên hơn ⇒ purge không bao giờ chạy (vi phạm ngầm ADR-047). | Lượt đầu chỉ chờ jitter (≥ 30s sau listen), sau đó mới theo chu kỳ. |
| F7 | Graceful shutdown không hủy lượt đang chạy ⇒ pool đóng giữa transaction, log lỗi ồn (dữ liệu an toàn vì rollback + idempotent). | Truyền `AbortSignal` / `isStopped()`, kiểm giữa các workspace. |

### Info

- Rebalance tăng `version` mọi task đổi rank ⇒ người khác đang sửa task trong cột nhận 409 (theo thiết kế; F2 gộp event giảm ồn).
- Khóa "exclusive run" theo **transaction**, không theo lượt — an toàn nhờ try-lock từng workspace + kiểm lại `purge_at FOR UPDATE`.
- Task xóa mềm giữ rank cũ, có thể trùng khóa mới — vô hại vì unique index là partial; nếu sau này có "khôi phục task" phải xếp lại rank khi vi phạm unique.

## Đạt

- SQL thô mới đều tagged template, tham số hóa, có ép kiểu `::uuid` / `::"TaskStatus"`; không `Unsafe`.
- Phạm vi tenant đúng: stash / `listColumn` lọc `project_id + status + deleted_at IS NULL`; project đã được xác minh thuộc workspace trước khi khóa; `save()` giữ `workspaceId + projectId + version`.
- Không vi phạm `tasks_rank_live_key` giữa chừng: stash là MỘT câu UPDATE sang `'~'||id` (duy nhất theo id); pha 2 ghi khóa phân biệt sau khi mọi dòng sống đã rời rank cũ.
- Khóa advisory không đụng nhau: `hashtextextended` 64-bit của các namespace khác nhau (`purge-run`, `purge:<id>`, `rank:<project>:<status>`); không có khóa session-level.
- Purge: try-lock trong cùng transaction, giải phóng khi commit / rollback; kiểm lại `purge_at FOR UPDATE` (có test race restore ‖ purge); chạy bằng role app (DELETE đã được cấp), không dùng migrator lúc runtime.
- Scheduler: `setTimeout` nối chuỗi (không chồng lượt), `unref()`, mọi rejection được bắt, log chỉ id / số đếm, dừng trước Prisma / pool; không có route / socket nào kích hoạt được job.
- Move đọc lại task sau khi khóa + giữ kiểm version.

## Chưa kiểm

- Không chạy test (đọc chéo chỉ đọc). Hành vi `generateNKeysBetween(null, null, n)` ⇒ `a0, a1…` theo thuật toán của thư viện và báo cáo T-033 ("mọi rank ≤ 3 ký tự").
- Test tích hợp T-033 chạy bằng `taskflow_migrator` — chưa thấy purge chạy dưới `taskflow_app` thật (quyền nhìn đủ).
- Cách 40P01 / P2028 hiện ra ở HTTP ngoài việc không có xử lý riêng.
