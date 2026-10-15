# G1 — Đọc lại bản sửa T-033 của A (cổng của người tìm ra lỗi)

**Người đọc:** Engineer B · **Branch được đọc:** `fix/T-033-same-column-rebalance` (A) — `4946721`, `27e1256`, `49dfb44` · **Ngày:** 2026-10-15
**Kết luận:** **APPROVE**, kèm 2 ghi chú không chặn merge (mục 3).

## 1. F1 (High) — rank kẹt `~<id>`

- `task-rank-rebalancer.ts`: trong vòng lặp, khi gặp task đang kéo, nếu nó **đang ở cột đích** và khóa mới **trùng** rank cũ ⇒ `tasks.save(moving, moving.version)` ghi lại rank cũ, không bump version, không audit, không event. Đây đúng là nhánh "khóa trùng" sẵn có của các task khác. Bất biến mới: rebalance ghi lại **mọi** dòng đã stash trước khi trả về.
- Test `rank-rebalance.test.ts`, ca "F1 (HIGH, review B)": đúng kịch bản (X cuối cột, rank `a2`, kéo lên ngay dưới L dài ⇒ khóa mới `a2`):
  - không còn rank `~`;
  - thứ tự đúng;
  - tạo task sau đó nằm cuối cột.

  Chạy trên InMemory và Postgres (LSP); A báo **đỏ trên cả hai** khi gỡ bản sửa.
- Cổng hộp đen `rank-tilde.e2e.ts` của F (`feat/T-026` @ `6e465fe`) đỏ trên `main` theo đúng kịch bản B gửi (N = 372); F đang chạy lại trên snapshot bản sửa.

**Còn đường nào để lại `~` không?** Không tìm thấy:

| Đường | Kết quả |
|---|---|
| Task kéo từ cột KHÁC vào | Không bị stash (stash chỉ cột đích) |
| Kéo trong cùng cột, khóa mới ≠ rank cũ | `moveTo` = true ⇒ use case `persist` ghi rank mới |
| Kéo trong cùng cột, khóa mới = rank cũ | Sửa ở `4946721` |
| Lỗi giữa chừng (version conflict, 55P03, 40P01, 503) | Ném ⇒ cả transaction rollback, kể cả câu stash |
| Cột > `RANK_REBALANCE_MAX_TASKS` (500) | `return wanted` **trước** stash ⇒ không có dòng nào bị đổi sang `~` |

## 2. F2 / F3 / F5 — `27e1256`

- **`lock_timeout` không lọt ra ngoài transaction:** `SELECT set_config('lock_timeout', '2s', true)` — `is_local = true` ⇒ chỉ sống tới hết transaction hiện tại. Được đặt **trước** `pg_advisory_xact_lock`. Áp luôn cho khóa dòng sau đó trong cùng transaction (đã ghi chú).
- **Retry không lặp `afterCommit` / emit realtime:**
  - lỗi tạm thời ⇒ transaction đã rollback ⇒ `inTransactionWithRankRetry` chạy lại **cả** transaction;
  - hook `afterCommit` gắn với transaction đã rollback **không bao giờ chạy** (đã kiểm ở G1 realtime: hook của lượt retry bị rollback bị bỏ);
  - hết số lần ⇒ `ServiceUnavailableError` 503 (không còn 500).
- **`transientDbErrorCode`:** đọc SQLSTATE theo cấu trúc (adapter-pg `meta.driverAdapterError.cause.originalCode`, `code`, chuỗi `cause` ≤ 4 tầng); chỉ 40P01 / 40001 / 55P03. Có unit test. 40P01 phủ F5 (deadlock giữa hai rebalance chéo cột).
- **F2:** cột > 500 task ⇒ bỏ qua rebalance, log `task.rank_rebalance_skipped_large_column`, giữ rank dài (hợp lệ, cột `text`). Chấp nhận được cho v1; con số chốt theo k6 (T-027).

## 3. Ghi chú (không chặn merge)

1. **F7 mới sửa một phần:**
   - scheduler truyền `AbortSignal`, wrapper purge chỉ kiểm `signal.aborted` **ở đầu lượt**;
   - `PurgeDeletedWorkspacesJob` (module workspace của **B**) chưa kiểm giữa các workspace ⇒ một lượt đang chạy vẫn đi hết tối đa 50 workspace khi shutdown;
   - **B** sẽ thêm `execute({ signal })` kiểm giữa các workspace trên `fix/purge-batch-resilience` (cùng file với F4), composition truyền `signal` xuống.
2. **Xung đột merge:** `composition/maintenance-jobs.ts` bị sửa ở cả branch này (chữ ký `run(signal)`, `firstRunAfterMs`) và `fix/purge-batch-resilience` của B (`failed` trong tổng kết + `PurgeIncompleteError`). Đề xuất: merge branch của A trước, B rebase + giải xung đột + thêm F7 phần job.
