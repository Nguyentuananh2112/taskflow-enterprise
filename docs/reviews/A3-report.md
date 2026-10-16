# A3 — Báo cáo: rebalance rank theo lô + hướng mở rộng CPU

**Người làm:** Engineer A · **Branch:** `feat/A3-batch-rebalance` (từ main `d647383`) · **Ngày:** 2026-10-16
**Căn cứ:** `docs/reviews/T-027-report.md` §4, §6, §8 (D); đề xuất được Tech Lead duyệt 2026-10-16 (Q1–Q5).

## 1. Chẩn đoán

`TaskRankRebalancer` cũ ghi **từng task**: `save` (UPDATE có điều kiện) + `append` audit + `findRefs`
(dựng DTO) + 2 hook `afterCommit` mỗi task. Cột 500 task ≈ 1500 lượt đi về DB trong transaction và ~1000
hook — mà hook được `await` **trước** khi trả response (`PrismaUnitOfWork.run`). ≈ 1,6 ms/task ⇒ khớp
~0,8 s/rebalance của T-027b §8.1. Chi phí là số lượt đi về DB + CPU Prisma theo task, không phải SQL chậm.

## 2. Đã làm

Rebalance vẫn **đồng bộ trong transaction của lệnh move** (giữ khóa cột + pha stash `~<id>` của T-033).
Pha 2 đổi sang ghi theo lô:

| Bước | Trước | Sau |
|---|---|---|
| Ghi rank | N × `save` | 1 × `saveRanks`: `UPDATE tasks … FROM unnest(7 mảng)` |
| Audit | N × `append` (`create`) | 1 × `appendMany`: `INSERT … SELECT unnest(10 mảng)` |
| Dựng DTO | N × `findRefs` | 1 × `findRefs` (hợp id assignee/creator) |
| Phát sau commit | 2N hook | 2 hook: phát tuần tự N `task:moved` (lỗi từng task log `task.realtime_failed`), 1 `events.publish(mảng)` (bus đã cô lập lỗi theo handler) |

**Bất biến & điều kiện của Tech Lead:**
- Câu UPDATE lô giữ điều kiện **từng dòng** như `save`: tenant (`id`+`workspace_id`+`project_id`),
  `version = expected_version` (ADR-010/110), `deleted_at IS NULL`, project chưa archive + ws chưa xóa.
- **Mọi dòng đã stash nằm trong lô** (F1 T-033), kiểm bằng `số dòng ghi == số dòng gửi`; thiếu ⇒ đọc
  lại project: mất ⇒ 404, archive ⇒ 422 `PROJECT_ARCHIVED`, còn lại ⇒ `RankConflictError` ⇒
  `inTransactionWithRankRetry` chạy lại (tối đa 3 lần ⇒ 409).
- Dòng không bump version **chỉ khi** `Task.moveTo` trả `false`, tức khóa mới **trùng đúng** rank cũ
  (và cùng cột) ⇒ không client nào thấy rank đổi mà version không đổi. Có test khẳng định.
- Contract realtime giữ nguyên: 1 audit `MOVED` + 1 `task:moved` cho mỗi task đổi rank (Q2).
- `RANK_REBALANCE_MAX_TASKS` giữ 500 — chỉ nâng sau khi đo lại.

### Hành vi mới (cố ý, Tech Lead đã duyệt): task bị xóa song song ⇒ thử lại thay vì 404

Task KHÁC trong cột bị **xóa mềm** (commit) giữa lúc rebalance đọc cột và lúc ghi lô:

- **Trước A3:** `save` của task đó trả `false` ⇒ `conflictFromStore` không tìm thấy task ⇒ ném
  `ResourceNotFoundError('task')` ⇒ **404 cho người đang move một task khác** — sai đối tượng (task của họ
  vẫn còn), client hiểu nhầm là thẻ mình kéo đã mất.
- **Sau A3:** câu UPDATE lô có `deleted_at IS NULL` ⇒ thiếu một dòng ⇒ project vẫn sống, chưa archive ⇒
  `RankConflictError` ⇒ `inTransactionWithRankRetry` chạy lại; lượt sau `listColumn` không còn task đã
  xóa ⇒ move **thành công**. Hết 3 lượt (xóa liên tục) ⇒ 409 `RANK_COLLISION` như mọi xung đột rank.
- **Test:** `rank-rebalance.test.ts` — "A3: task trong cột bị xóa song song giữa lúc rebalance ⇒ thử lại cả
  transaction (không 404 cho người move)", chạy cả InMemory và Postgres (runner LSP).
- Không đổi: project/ws mất ⇒ 404 `project`; project archive ⇒ 422 (test "A3: project bị archive song
  song…"); task của chính người move bị xóa ⇒ use case đọc lại sau khóa cột ⇒ 404 như cũ.

## 3. File

| File | Thay đổi |
|---|---|
| `apps/api/src/modules/task/application/ports/task-repository.port.ts` | `saveRanks(writes)`, kiểu `RankWrite` |
| `apps/api/src/modules/task/application/ports/audit-log.port.ts` | `appendMany(entries)` |
| `apps/api/src/modules/task/application/task-rank-rebalancer.ts` | pha 2 theo lô, `writeConflict`, `recordMoves` |
| `apps/api/src/modules/task/infrastructure/persistence/prisma/prisma-task.repository.ts` | `saveRanks` (unnest) |
| `apps/api/src/modules/task/infrastructure/persistence/prisma/prisma-task-audit-log.repository.ts` | `appendMany` (unnest) |
| `apps/api/src/modules/task/infrastructure/persistence/in-memory/*` | bản InMemory cùng ngữ nghĩa (LSP) |
| `apps/api/src/modules/task/application/use-cases/rank-rebalance.test.ts` | +3 test (chạy cả InMemory và Postgres qua runner LSP); F2 seed theo lô |
| `apps/api/src/modules/task/testing/task-backend.ts`, `task-harness.ts`, `apps/api/test/integration/task/prisma-task-backend.ts` | `insertTasks` / `seedTasks`: seed nhiều task bằng một lệnh (`createMany`) |

**F2 (T-033) chập chờn — đã sửa (Tech Lead duyệt):** F2 seed 497 task bằng `seedTask` tuần tự (~1500 lượt
đi về DB) ⇒ trên Postgres 1,7 s lúc máy nhẹ, 4–35 s lúc máy bận ⇒ vượt timeout 30 s. Cùng điều kiện máy:
main 7,7 s / A3 4,1 s ⇒ không do A3. Nay seed bằng `seedTasks` (1 đọc project + 1 `createMany` + 1 patch)
⇒ **F2 305 ms** trên Postgres; không nâng timeout.

Test mới: (1) một `saveRanks` chứa đúng mọi dòng đã stash (kể cả dòng khóa trùng — version giữ nguyên,
các dòng khác `version = expected + 1`), một `appendMany` chỉ cho task đổi rank; (2) archive song song
⇒ 422, không còn `~`, không phát realtime; (3) xóa song song ⇒ retry, không 404.

## 4. Kết quả lệnh (worktree `D:\TaskFlow_wt\T-024`, exit code)

Trên cây cuối cùng (base main `0339da1`, gồm sửa F2), sau `pnpm install --frozen-lockfile` (exit 0):

| Lệnh | Exit | Kết quả |
|---|---|---|
| `VITEST_MAX_WORKERS=2 VALKEY_URL_TEST=redis://127.0.0.1:6380/14 REQUIRE_INTEGRATION=1 pnpm verify` | **0** | lint 0 · typecheck 0 · test 0 (1711) · audit 0; migrate/drift bỏ qua (A3 không đổi schema) |
| `pnpm --filter @taskflow/api test:integration test/integration/lsp/task test/integration/task` (DB riêng `taskflow_a3` trên 5434, Valkey db 14, không `VITEST_MAX_WORKERS`) | **0** | 10 file / 129 test, gồm 11 test rebalance trên Postgres |

Lịch sử: trước khi sửa F2, integration 128/129 vì F2 vượt timeout 30 s do máy bận (xem mục 3).

## 5. Số đo sơ bộ (KHÔNG thay cho slot k6)

Bench tạm (đã xóa, không commit): cột 500 task rank 75 ký tự trên Postgres test (5434), đo `durationMs`
của log `task.rank_rebalanced` + thời gian từng port:

| Bản | durationMs (3 lượt) | Phần lớn nhất |
|---|---|---|
| Lô v1 (`VALUES` + Prisma `createMany`) | 289 / 361 / 807; 407 / 449 / 274 | `createMany` audit 145–279 ms |
| Lô v2 (`unnest` cả hai câu) | **138** / 334 / 2064 | lượt 2–3 chạy lúc máy 100% CPU (audit 1796 ms ở lượt 3) |

Trước A3 (T-027b, k6, máy rảnh): P50 812 ms. Số trên đo lúc máy bận, dao động lớn ⇒ **cần slot "máy
rảnh"** (Q3): `load/single-rebalance-and-cpu.sh` (1 rebalance) + kịch bản §4 (40 đồng thời), gộp
`node --cpu-prof` ở 150 RPS (mục f).

## 6. Hướng mở rộng CPU (thiết kế — không code trong A3)

Tech Lead duyệt (Q4): **N container × 1 tiến trình Node sau LB** (App Platform instance count / compose
replicas + Caddy), không `node:cluster`. Điều kiện trước khi N > 1:
1. `SOCKET_REDIS_ADAPTER=true` (đã có code); websocket-only ⇒ không cần sticky (ADR-074).
2. **ADR-115:** đếm hạn mức realtime dùng chung qua Valkey (socket/user, join/phút, renew) — ticket riêng,
   giao A sau A3. Bộ đếm socket phải chịu được instance chết (key theo instance có TTL + heartbeat).
3. **Limiter chỉ trong RAM ⇒ trần nhân N** — B cập nhật threat-model. `SlidingWindow`
   (`core/http/rate-limit/sliding-window.ts`) đang dùng ở: `/readyz` (`core/http/health.ts:60`), renew/join
   theo user ở gateway (`core/realtime/gateway.ts:67-68` — chính là phần ADR-115 cần đếm chung), renew
   theo socket (`socket-handlers.ts:75` — gắn kết nối, không nhân). Thêm tunnel `/monitoring`
   300/phút/**instance** (R15).
4. Ngân sách kết nối: `N × DATABASE_POOL_MAX + 5 ≤ giới hạn gói PG` (devops §4.5); gói nhỏ ⇒ PgBouncer
   transaction mode — tương thích vì code chỉ dùng khóa advisory **xact** và `set_config(…, true)`.
5. Job purge/bảo trì dùng `pg_try_advisory_xact_lock`; khóa cột rebalance ở DB ⇒ đúng nhiều instance.
6. Kiểm chứng: compose load 2 bản API + LB (việc mở của D) — kỳ vọng gần ×2 tới khi Postgres bão hòa.

## 7. Quyết định (đề xuất chép thành ADR-116)

> **ADR-116** ✅ (A3, theo T-027/T-027b) **Rebalance rank theo lô, đồng bộ trong transaction của move.**
> Pha 2 ghi mọi dòng đã stash trong MỘT câu `UPDATE … FROM unnest(...)` giữ điều kiện từng dòng của
> `save` (tenant, `version`, chưa xóa, project chưa archive — ADR-010/110); số dòng ghi phải bằng số dòng
> stash, thiếu ⇒ 404/422/thử lại. Audit một câu INSERT; contract realtime giữ N `task:moved`. Bác rebalance
> nền sau commit (không nâng trần CPU, cần hàng đợi bền — ADR-000, actor — ADR-014). Rebalance cục bộ một
> cửa sổ và event `column:rebalanced` để sau, chỉ khi số đo cần. `RANK_REBALANCE_MAX_TASKS` đổi theo số đo.
> **Mở rộng CPU:** N container × 1 tiến trình Node sau LB, không `node:cluster`; điều kiện: Valkey adapter,
> đếm hạn mức realtime dùng chung (ADR-115), ngân sách kết nối PG, rà limiter chỉ trong RAM.

## 8. Rủi ro / câu hỏi mở

- ~~Lỗi unique từ `$executeRaw` không được map~~ — **đã sửa (Tech Lead yêu cầu, trước review B).** Đo trên
  Postgres: câu SQL thô vi phạm `tasks_rank_live_key` ⇒ Prisma trả **`P2010`** (không phải `P2002`), `meta`
  vẫn có `driverAdapterError.cause.originalCode = "23505"` + `constraint.index`. Test mới "A3: `saveRanks`
  trùng rank … ⇒ RankConflictError" **đỏ trên Postgres trước khi sửa** (lỗi Prisma thô ⇒ sẽ thành 500),
  xanh sau khi `uniqueConstraintOf` (module task) nhận thêm `P2010` + `23505`. Về logic vẫn không xảy ra
  trong rebalance (mọi dòng đã ở `~<id>`); đây là lớp phòng thủ. Bản sao `uniqueConstraintOf` của
  auth/workspace (ADR-093) không đổi — hiện chúng chỉ map lỗi từ API model của Prisma (`P2002`); nếu sau
  này dùng SQL thô cho ghi có unique thì phải sửa tương tự.
- N `task:moved` vẫn phát tuần tự trong hook được `await` trước response ⇒ nằm trên đường request; nếu đo
  cho thấy chiếm phần lớn ⇒ cân nhắc `column:rebalanced` (đổi contract, cần E).
- DB test `taskflow_a3` trên postgres-test (5434) để lại cho lần chạy lại; xóa khi A3 merge.
