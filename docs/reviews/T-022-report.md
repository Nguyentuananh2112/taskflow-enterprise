# T-022 — Báo cáo: CI bổ sung + tối ưu build/image

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/T-022` (rebase lên main `aa15b1f`) · **Ngày:** 2026-10-15
**Căn cứ:** ticket T-022 + 5 mục bổ sung của Tech Lead (prepare trong worktree; tốc độ cài Windows; Vitest xanh giả; Prisma checkpoint; tên biến Valkey test).

## Kết quả theo mục
| # | Việc | Trạng thái |
|---|---|---|
| 1 | `apps/api` `build` = `prisma generate --no-hints && tsdown`; bỏ bước generate trùng trong Dockerfile | ✅ Composite CI vẫn generate sau install vì `pnpm test`/coverage/`test:security` cần client mà không chạy `build` |
| 2 | CI: job `security` mọi PR; job `integration`; workflow mutation hằng tuần | ✅ |
| 3 | Xóa `minimumReleaseAgeExclude` sau 17:50Z | ⏳ **Chưa tới giờ** — Tech Lead tự làm như đã nói |
| 4 | Image migrate < 500 MB; giảm thời gian `pnpm deploy` | ⚠️ **2 262 MB → 606 MB** (−73%), chưa < 500 MB — lý do + phương án ở dưới. `deploy` hết tải lại từ registry (`downloaded 0`) |
| 5 | Bỏ ignore GHSA-vfj7-8cjw-p6xm | ⏳ A đã chuyển plugin ESLint sang `devDependencies` (`0abe144`, nhánh `feat/T-024`). **Giữ ignore trên nhánh này** để thứ tự merge nào cũng xanh; xóa mục `auditConfig` ngay khi T-024 vào main và `pnpm audit --prod --audit-level high` trên main sạch (hạn rà 2026-11-15) |
| B1 | `prepare` không làm `pnpm install` fail trong worktree / ngoài git | ✅ |
| B2 | Cài chậm trên Windows: đo + đề xuất | ✅ số đo + runbook §2.1 — **không** đổi config máy |
| B3 | Vitest xanh giả khi máy quá tải | ✅ `maxWorkers` 4 + đã chứng minh exit code |
| B4 | `CHECKPOINT_DISABLE` / `PRISMA_HIDE_UPDATE_MESSAGE` mọi nơi chạy Prisma CLI | ✅ Dockerfile (base + migrate), env cấp workflow CI + mutation, runbook §5, devops.md |
| B5 | Thống nhất `VALKEY_URL_TEST`, `REQUIRE_INTEGRATION=1` trong CI | ✅ |

## File
| File | Thay đổi |
|---|---|
| `apps/api/package.json` (scripts) | `build`: `prisma generate --no-hints && tsdown` · `test:coverage`: `--maxWorkers=4` |
| `apps/api/Dockerfile` | Stage `base`→`deps`→`install`→ (`migrate-files` ∥ `build`) → `migrate` / `runtime`. `deploy --prefer-offline`. Image migrate: node slim + `/migrate` (Prisma CLI gom theo lockfile), `CMD node node_modules/prisma/build/index.js migrate deploy`. `CHECKPOINT_DISABLE=1`, `PRISMA_HIDE_UPDATE_MESSAGE=1` |
| `docker/migrate/collect-prisma.mjs` (mới) | Gom Prisma CLI + phụ thuộc từ `node_modules/.pnpm` (đúng lockfile): theo `dependencies` + `optionalDependencies` + peer **bắt buộc**; bỏ peer optional và `@electric-sql/pglite` (`COLLECT_PRISMA_EXCLUDE` ghi đè được) |
| `.dockerignore` | cho phép `docker/migrate/collect-prisma.mjs` vào context |
| `docker/postgres/init/01-roles.sh` | tách `setup_db`; tạo thêm DB theo `TASKFLOW_EXTRA_DBS` (owner migrator, grant DML cho app) |
| `docker-compose.yml` | postgres-test: `TASKFLOW_EXTRA_DBS: taskflow_it` |
| `.github/workflows/ci.yml` | env cấp workflow: `CHECKPOINT_DISABLE`, `PRISMA_HIDE_UPDATE_MESSAGE`, `VITEST_MAX_WORKERS=2`, `REQUIRE_INTEGRATION=1`. `unit` có service Valkey + `VALKEY_URL_TEST`. `integration` dùng DB **`taskflow_it`** + `VALKEY_URL_TEST`. Job mới **`security`** (services + migrate template + `test:security`, biến `SEC_*`, `SEC_API_READY_TIMEOUT_MS=180000`) |
| `.github/workflows/mutation.yml` (mới) | thứ Hai 02:00 UTC + chạy tay; ma trận tự lấy từ script `mutation:*` của apps/api (6 nhóm); upload JSON/HTML 30 ngày; không chặn PR |
| `package.json` (gốc, scripts) | `prepare`: chỉ `lefthook install` ở repo chính (`git-dir == git-common-dir`); worktree/không có git/lỗi ⇒ in 1 dòng, exit 0 |
| `vitest.config.ts` (gốc) | `maxWorkers` mặc định 4, ghi đè `VITEST_MAX_WORKERS` (số hoặc `%`) — **Tech Lead yêu cầu, ngoài phạm vi gốc** |
| `apps/api/test/support/env.ts`, `index.ts`, `support.test.ts` | `testValkeyUrl()` (`VALKEY_URL_TEST` → `TEST_VALKEY_URL` deprecated + cảnh báo → mặc định 6380), `integrationRequired()` + test — **Tech Lead yêu cầu** |
| `apps/api/src/core/http/rate-limit/valkey.integration.test.ts`, `apps/api/src/core/realtime/redis-adapter.integration.test.ts` | dùng 2 helper trên (chỉ đổi cách đọc biến) — **Tech Lead yêu cầu** |
| `docs/runbook/local-dev.md` | §2 prepare/worktree; §2.1 số đo cài chậm + đề xuất; §5 Prisma env, 2 DB test, `VALKEY_URL_TEST`, security, mutation; §7 chỉ tin exit code |
| `docs/design/devops.md` | §3.1 Prisma env; §3.2 sơ đồ stage mới; §5.1 job security + mutation; §8.2b Vitest an toàn; §8.3 tách DB test |

## Số đo
**Image migrate** (`docker image inspect … .Size`):
| Bản | Nội dung | Kích thước |
|---|---|---|
| T-011 | kế thừa stage build (toàn workspace + devDeps) | **2 262 MB** |
| T-022 lần 1 | Prisma CLI + toàn bộ closure kể cả peer optional (143 gói) | ~705 MB (Docker Desktop hiển thị) — `migrate deploy` ✅ |
| T-022 thử | bỏ thêm `@prisma/studio-core`, `@prisma/dev` (42 gói) | ~483 MB — ❌ CLI chết ngay: `Cannot find module '@prisma/studio-core/data/bff'` (cli.js `require` ở top-level) |
| **T-022 chốt** | bỏ peer optional + pglite (134 gói), `/app` = 235 MB | **606 MB** — `migrate deploy` ✅ (DB trống: 1 migration, `tasks.rank` collation `C`, user `node`, 6 s) |

Vì sao chưa < 500 MB: phần còn lại của `/app` là thứ CLI **nạp khi khởi động**: `@prisma/studio-core` 43 MB, `prisma` 41, `effect` 34, `@prisma/engines` 28, `@prisma/dev` 19… Base `node:24.22.0-bookworm-slim` chiếm phần lớn còn lại. Phương án tiếp (Phase 5, cần quyết): base alpine/distroless cho riêng image migrate (cần kiểm schema-engine musl), hoặc chạy migrate bằng `prisma migrate diff --script` + `psql` (không cần CLI trong image).

**Build:** `--target migrate` không còn chờ build/deploy (stage `migrate-files` tách khỏi `build`): **88–176 s** (deps đã cache) so với trước phải qua cả `deploy`. `pnpm deploy`: T-011 tải lại từ registry (648 s); T-022 `--prefer-offline` ⇒ `downloaded 0`. Thời gian ghi file còn phụ thuộc I/O máy: lần đo lúc máy quá tải (nhiều phiên cài + Docker build) `deploy` vẫn mất 1 810 s — trên runner CI không có tải chung này. `--offline` hẳn **không dùng được**: `ERR_PNPM_NO_OFFLINE_META` (`pnpm fetch` không lưu metadata `deploy` cần).

**Cài trên Windows** (máy dev, 12 luồng / 32 GB, nhiều phiên song song):
| Lần cài (~800 gói) | Store | Nhập file | Thời gian |
|---|---|---|---|
| Bản sao repo trên C:, `--offline --ignore-scripts` | `D:\.pnpm-store` (khác ổ) | copy | 37 phút 46 giây |
| Worktree T-022 trên D: | `D:\.pnpm-store` (cùng ổ) | **hardlink** (`fsutil hardlink list` xác nhận) | ~41 phút |
pnpm 11 **đã tự dùng** `D:\.pnpm-store` cho worktree trên D: ⇒ đổi `store-dir` một mình không giải quyết. Nút thắt: Defender quét file mới, RAM/commit cạn (`vmmemWSL` ~8,4 GB; Git Bash chết với `Win32 error 1455` khi commit trống ~3 GB), nhiều phiên cài cùng lúc. Lần đo B (store C: ⇄ repo C:) **bị hủy** do chính lỗi hết bộ nhớ đó — không bịa số.

**Vitest (máy dev đang quá tải):** mặc định 50% (6 worker) ⇒ `pnpm test` **EXIT=1**, in `Test Files 79 passed (79)` + `Errors 16 errors` — 16 file web "Failed to start forks worker" **không được đếm**. 4 worker ⇒ **EXIT=0**, 95 file / 1 012 test, 100 s (so với 191 s). Probe (đã gỡ): lỗi ngoài test (uncaught + unhandled rejection) ⇒ EXIT=1; worker bị `SIGKILL` ⇒ EXIT=1 dù in "1 passed". Không nơi nào bật `dangerouslyIgnoreUnhandledErrors`; CI không có `| tee` / `|| true` / `continue-on-error`.

## Definition of Done (máy dev, sau rebase `aa15b1f`)
```
pnpm install --frozen-lockfile --prefer-offline      → EXIT 0 (prepare: "git worktree: bỏ qua lefthook install")
pnpm typecheck                                        → EXIT 0
pnpm lint                                             → EXIT 0
REQUIRE_INTEGRATION=1 pnpm test (Valkey compose 6380) → EXIT 0 · Test Files 106 passed · Tests 1096 passed
pnpm audit --prod --audit-level high                  → EXIT 0 (1 high đã ignore — mục 5)
node .github/scripts/check-env-example.mjs            → khớp env.ts (18 biến)
actionlint (ci.yml, mutation.yml)                     → sạch
init script (container tạm, TASKFLOW_EXTRA_DBS=taskflow_it) → 2 DB owner migrator; taskflow_app connect OK
image migrate (DB trống trên mạng compose)            → EXIT 0 · 1 migration · collation C
```
Chạy như CI (Postgres tạm 5446 dựng bằng init script, biến `SEC_*` y hệt ci.yml):
```
test:integration (DATABASE_URL_TEST=…/taskflow_it, VALKEY_URL_TEST, REQUIRE_INTEGRATION=1) → EXIT 0 · 14 passed
test:security (DB taskflow_sec, Valkey compose 6380/15)   → EXIT 1 · 3 passed file / 38 test đạt, 3 đỏ ở rate-limit.sec.ts
test:security rate-limit.sec.ts (Valkey RIÊNG 6446/15)   → EXIT 0 · 4 passed, 3 todo
```
3 đỏ chỉ xảy ra khi dùng chung Valkey 6380 db 15 với các phiên khác (harness xóa bộ đếm db 15 ⇒ hai lần chạy song song giẫm nhau); CI dùng service Valkey riêng nên không gặp.

## Ghi chú căn chỉnh sau rebase
- Harness bảo mật trên main (T-017b, ADR-106) đã **tự tạo + migrate DB `taskflow_sec`** và đọc `SEC_API_READY_TIMEOUT_MS` ⇒ job `security` dùng `SEC_PG_DB`, `SEC_PG_MIGRATOR_USER/PASSWORD`, `SEC_PG_APP_*` (bỏ `SEC_PG_ADMIN_URL`/`SEC_PG_TEMPLATE_DB` mà bản harness cũ dùng).

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **Không dùng cache mount BuildKit** cho store pnpm dù ticket gợi ý: cache `type=gha` của CI chỉ giữ layer, không giữ cache mount ⇒ store trong layer `deps` mới tái dùng được trên CI. Thay vào đó: `--prefer-offline` cho `deploy` + tách stage.
2. **Image migrate gọi thẳng `node node_modules/prisma/build/index.js`** (không có pnpm trong image) — CLI đã ghim theo lockfile, cùng tinh thần ADR-061.
3. **Integration (CI + mặc định local) chạy trên DB `taskflow_it`** do init script tạo sẵn (`TASKFLOW_EXTRA_DBS`) — đúng ADR-106 (DB riêng, không đụng `taskflow_template`). Engineer chạy song song vẫn tự tạo `taskflow_<ticket>`.
4. **`maxWorkers` mặc định 4** (không 50%) — số đo ở trên; CI đặt 2.
5. **`unit` job có service Valkey**: `pnpm test` chứa `*.integration.test.ts` tầng I; với `REQUIRE_INTEGRATION=1` mà thiếu Valkey sẽ (đúng ý) FAIL.
6. Mutation: ma trận **tự lấy** từ script `mutation:*` — F thêm nhóm không cần sửa workflow.

## Rủi ro / việc mở
- **Suite bảo mật chạy local trên Valkey dùng chung (6380 db 15) có thể đỏ oan** khi phiên khác chạy cùng lúc (xem kết quả trên). Đề xuất F: thêm khóa/tiền tố riêng cho Valkey như khóa advisory đã có cho Postgres, hoặc mỗi người một DB index (`SEC_REDIS_URL`). Runbook §5 đã ghi.
- **Compose đang chạy trên máy chưa có DB `taskflow_it`** (init script chỉ chạy lúc tạo). Không cần recreate: `taskflow_migrator` có CREATEDB ⇒ `CREATE DATABASE taskflow_it` (runbook §5). Tôi **không** recreate postgres-test vì các engineer khác đang dùng.
- Biến test (`DATABASE_URL_TEST`, `VALKEY_URL_TEST`, `REQUIRE_INTEGRATION`, `SEC_*`) **không** đưa vào `apps/api/.env.example` vì file đó phải khớp 1-1 `env.ts` (CI kiểm) — đã ghi ở runbook §5. Tên cũ `TEST_VALKEY_URL` gỡ ở Phase 4.
- Nhánh của B (prisma-test-kit) đọc `VALKEY_URL_TEST` — đã đúng tên chuẩn.
- Image migrate có cảnh báo `Prisma failed to detect the libssl/openssl version` (slim không có lệnh `openssl`) nhưng `migrate deploy` chạy đúng; theo dõi khi nâng Prisma.
- Image migrate 606 MB > mục tiêu 500 MB — xem phương án ở "Số đo".
