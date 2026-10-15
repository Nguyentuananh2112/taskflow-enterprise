# T-033 — Báo cáo: Job bảo trì dữ liệu (purge workspace theo lịch + cân bằng lại rank)

**Người làm:** Engineer C (`taskflow-enterprise-d7`) · **Branch:** `feat/T-033` (worktree T-023 dùng lại theo ADR-107), trên `main` @ `1c14631`.
**DB test:** `taskflow_t023` (cổng 5434, user `taskflow_migrator`); Valkey `redis://127.0.0.1:6380/3`.

## 1. Commit
| Commit | Nội dung |
|---|---|
| `2e0f110` | **Việc 0**: `data-and-api.md` §3.2 — `RESOURCE_NOT_FOUND.details.resource` có `"route"` |
| `f0a6d27` | Purge theo lịch: `ExclusivePurgeRun`, `MaintenanceScheduler`, biến env, wiring `main.ts` + graceful shutdown |
| `3440899` | Test tầng I của purge |
| `23b5035` | Rebalance rank theo cột trong move (+ khóa cột cho create/move) |
| `156e9aa` | CC-RB01 + cập nhật `data-and-api.md` §1.3/§1.7 |

## 2. Purge workspace theo lịch (ADR-047/095)
- **Không sửa code của B**: `PurgeDeletedWorkspacesJob` + `PrismaWorkspacePurger` giữ nguyên (đã chốt với B). Thêm file mới `modules/workspace/infrastructure/jobs/exclusive-purge-run.ts`: decorator của `IWorkspacePurger`. Câu **đầu tiên** của mỗi transaction lô là `pg_try_advisory_xact_lock(hashtextextended('taskflow:purge-run', 0))`.
  - Không lấy được khóa ⇒ `PurgeRunBusyError` ⇒ dừng lượt (log info `maintenance.purge_skipped_busy`, không phải lỗi).
  - Khóa tự nhả khi commit/rollback. Không dùng khóa mức session, vì không an toàn với pool (ADR-095).
  - Khóa theo từng ws và bước kiểm lại `purge_at FOR UPDATE` của B vẫn giữ.
- **Scheduler** (`composition/maintenance-jobs.ts`):
  - `setTimeout` nối tiếp: lượt sau chỉ được hẹn khi lượt trước xong ⇒ không chồng lượt. Có jitter, `unref()`.
  - Lỗi job được log chỉ với tên + mã lỗi, không có message: message của lỗi Prisma có thể chứa dữ liệu truy vấn (T-031 mục 0).
  - `stop(timeout)`: không mở lượt mới, chờ lượt đang chạy tối đa timeout.
- **Wiring**:
  - `createPrismaPersistence` có thêm `workspacePurger`. Bản bộ nhớ không có ⇒ không chạy purge ở local/test.
  - `main.ts` khởi động scheduler sau `listen`. Graceful shutdown dừng scheduler **trước** Prisma/pool, chờ ≤ ½ `SHUTDOWN_TIMEOUT_MS`.
- **Env** (đặt cạnh `READINESS_DRAIN_MS`, không đụng `superRefine` — theo đề nghị của A để tránh xung đột với T-031):
  - `MAINTENANCE_JOBS_ENABLED`: tùy chọn. Không đặt ⇒ bật ở staging/production, tắt ở local/test (`maintenanceEnabled`). Sau khi T-031 merge, có thể đổi sang dùng `isDeployed`.
  - `PURGE_INTERVAL_MS`: mặc định 3 600 000, tối thiểu 60 000.
  - `PURGE_JITTER_MS`: mặc định 300 000.
- **Metrics/log**:
  - `maintenance.purge_summary { purged, skipped }`;
  - `maintenance.run_done { job, durationMs }`, `maintenance.run_failed`;
  - `workspace.purged { workspaceId }` (của B).

## 3. Cân bằng lại rank (ADR-011 mở rộng)
**Benchmark** (`fractional-indexing` 4.0.0, chèn 1000 lần vào cùng một khe):

| Kiểu chèn | 100 lần | 500 lần | 1000 lần |
|---|---|---|---|
| Ngay sau phần tử đầu | 19 ký tự | 86 | 169 |
| Ngay trước phần tử cuối | 22 | 102 | 202 |
| Cuối cột / đầu cột | 3 | 3 | 3 |

⇒ Rank chỉ dài khi kéo thả lặp vào cùng một khe (~1 ký tự/5 lần). Create luôn thêm cuối cột nên không bao giờ chạm ngưỡng. Ngưỡng **64** ký tự ≈ 300+ lần chèn vào một khe.

**Thiết kế: thao tác theo cột ngay trong move, không phải job nền.** Lý do: job nền không có actor, mà ADR-014 cấm actor `system`. Audit và vỏ realtime đều bắt buộc có actor đã xác thực.
- Create và move lấy `pg_advisory_xact_lock(hashtextextended('taskflow:rank:<project>:<status>'))` **trước** khi đọc hàng xóm. Move **đọc lại task sau khi có khóa**: rebalance commit trong lúc chờ khóa không làm entity cũ, nên không có 409 oan. Hai lệnh move vào cùng một cột giờ xếp hàng; lệnh vào các cột khác nhau không ảnh hưởng nhau.
- Rank tính ra > 64 ⇒ `TaskRankRebalancer` chạy trong cùng transaction:
  - Pha 1: đổi rank cả cột sang khóa tạm `~<id>` bằng một câu UPDATE. Unique `tasks_rank_live_key` được kiểm theo từng dòng nên không ghi thẳng rank mới được.
  - Pha 2: `generateNKeysBetween(null, null, n)` theo thứ tự cũ, chèn task đang move vào đúng chỗ.
  - Mỗi task đổi rank: `version + 1`, audit `MOVED` (actor = người move, có `requestId`), realtime `task:moved` sau commit. FE áp dụng theo version như một move thường.
  - Task nhận lại đúng rank cũ thì chỉ khôi phục từ khóa tạm, không có version/audit/event. **Lỗi này do test tìm ra:** bản đầu bỏ sót bước khôi phục, nên task bị kẹt ở khóa tạm `~<id>`.
  - Task trong cột bị sửa song song trong khe "đọc cột → khóa dòng" ⇒ thử lại cả transaction (cơ chế retry sẵn có, tối đa 3 lần). Sau pha 1, các dòng đã bị khóa nên lệnh sửa song song chỉ chờ rồi nhận 409.
- Log `task.rank_rebalanced { projectId, status, tasks, triggerRankLength, durationMs }`.
- Phát hiện kỹ thuật: `pg_advisory_xact_lock` trả kiểu `void`, Prisma `$queryRaw` không deserialize được cột này ⇒ phải dùng `$executeRaw`.

## 4. Test
- Unit (`composition/maintenance-jobs.test.ts`, fake timer):
  - hẹn đúng interval + jitter, không chồng lượt khi job dài hơn chu kỳ;
  - lỗi được log không kèm message, lượt sau vẫn chạy;
  - `stop` không mở lượt mới và tôn trọng timeout;
  - instance khác giữ khóa ⇒ bỏ lượt, không coi là lỗi;
  - mặc định bật/tắt theo `APP_ENV`.
- Env (`config/env.test.ts`): giá trị mặc định, chu kỳ < 1 phút bị từ chối.
- Tầng I purge (`test/integration/maintenance/purge-job.int.ts`):
  - **2 instance cùng chạy** ⇒ `maxActive = 1`: không bao giờ 2 lô song song; instance thua dừng lượt; lượt sau dọn nốt; mỗi ws bị xóa đúng 1 lần, kèm task + audit. Nếu bỏ `ExclusivePurgeRun` thì test này đỏ, vì 2 instance purge 2 ws khác nhau cùng lúc.
  - **restore ‖ purge**: ws được khôi phục đúng khe giữa `listPurgeable` và `purge` ⇒ không bị xóa (`skipped: 1`).
  - ws còn ân hạn hoặc chưa xóa ⇒ không bị đụng.
- Rebalance (`modules/task/application/use-cases/rank-rebalance.test.ts`, chạy trên InMemory **và** Postgres qua runner LSP `test/integration/lsp/task.rank-rebalance.lsp.int.ts`):
  - giữ đúng thứ tự, mọi rank ≤ 3 ký tự, không còn khóa tạm;
  - version/audit/realtime đúng với từng task;
  - rank bình thường thì không rebalance;
  - ghi chen trong khe ⇒ retry thành công.
- Tầng C (`task-concurrency.int.ts`) **CC-RB01**: move kích hoạt rebalance ‖ 6 move khác vào cùng cột ⇒ không mất task, rank duy nhất, không còn `~`, giữ A < B < X < C. Lặp 5 lượt cả bộ: 55/55 xanh.
- Test khởi động (T-023) chạy `main.ts` ở `APP_ENV=staging` (scheduler bật mặc định) vẫn xanh.

## 5. Definition of Done
```
$ pnpm typecheck && pnpm lint && pnpm test --maxWorkers=2          # exit 0
apps/api lint:deps: ✔ no dependency violations found (297 modules, 1137 dependencies cruised)
apps/web lint:deps: ✔ no dependency violations found (292 modules, 840 dependencies cruised)
 Test Files  135 passed (135)
      Tests  1377 passed (1377)

$ CHECKPOINT_DISABLE=1 DATABASE_URL_TEST=postgresql://taskflow_migrator:***@127.0.0.1:5434/taskflow_t023 \
  VALKEY_URL_TEST=redis://127.0.0.1:6380/3 pnpm --filter @taskflow/api test:integration --maxWorkers=2   # exit 0
No difference detected.
 Test Files  35 passed (35)
      Tests  339 passed (339)
```
Mọi commit đều qua hook lefthook (gitleaks, prettier, eslint), không dùng `--no-verify`. Không có migration, không chạy `migrate reset`.

## 6. Quyết định tự đưa ra
1. Rebalance là thao tác theo cột trong move, không phải job nền (lý do ở mục 3). Ticket cho phép "job hoặc thao tác theo cột".
2. Khóa cột làm các move vào cùng một cột xếp hàng (trước đây chỉ va nhau ở unique index). Đổi lại, không còn trường hợp tính rank theo dữ liệu cũ trong lúc rebalance.
3. Audit `MOVED` của các task bị rebalance mang actor là người kích hoạt. Một lần rebalance có thể sinh ~n dòng audit cho một cột n task. Việc này hiếm (≥ 300 lần kéo vào cùng một khe).
4. Ngân sách dừng job khi shutdown là ½ `SHUTDOWN_TIMEOUT_MS`, phần còn lại để đóng Prisma/pool/Valkey.
5. Test integration của purge đặt ở `test/integration/maintenance/` (thư mục mới). Ticket không liệt kê `test/` trong phạm vi sở hữu, nhưng test tầng I là bắt buộc.

### Quyết định của Tech Lead về mục 6
- (1) Rebalance trong move thay vì job: **DUYỆT**.
- (2) Khóa advisory theo `(project, status)`: **DUYỆT CÓ ĐIỀU KIỆN**. D đo trong T-027 hai kịch bản: "cột nóng" (nhiều user move vào cùng một cột) và "move kích hoạt rebalance cột 500 task". Nếu **P95 ghi > 300 ms** (ADR-030) thì xem lại. Phương án dự phòng: chỉ lấy khóa cột khi cần rebalance; các move còn lại dựa vào unique rank + retry như trước T-033. Lúc đó create/move thường phải bỏ qua cột đang ở pha khóa tạm `~<id>`, nghĩa là phải đọc hàng xóm dưới khóa chia sẻ hoặc retry khi gặp khóa tạm.

## 7. Phối hợp / việc mở
- B: đã đồng ý thiết kế. T-032 (ADR-110, cột `version` cho workspaces/projects) không xung đột: purge xóa cứng, restore vẫn giữ điều kiện cũ.
- A: tên file, thứ tự shutdown và vị trí biến env đã thống nhất. Sau khi T-031 merge, `maintenanceEnabled` có thể dùng `isDeployed`.
- Chưa có: metrics dạng counter/Prometheus, hiện mới có log có cấu trúc (dự án chưa có hạ tầng metrics); và job quét định kỳ các cột có rank dài mà không có ai move vào (không cần, vì rank chỉ dài ra qua move).
