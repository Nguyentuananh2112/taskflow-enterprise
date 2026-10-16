# chore/ci-parity — Báo cáo: `ci.yml` đối chiếu các cổng thêm đêm 2026-10-15/16

**Người làm:** Engineer D (`taskflow-enterprise-6a`) · **Branch:** `chore/ci-parity` (từ `main` d647383) · **Ngày:** 2026-10-16
**Giao bởi:** Tech Lead (`taskflow-enterprise-ed`) — 6 điểm. **Phạm vi:** `.github/workflows/ci.yml` + báo cáo này.

## Kết quả từng điểm
| # | Cổng | Trạng thái trước | Xử lý |
|---|---|---|---|
| 1 | Integration với harness mới (Valkey db riêng, đủ biến) | **Đạt.** `VALKEY_URL_TEST=…/1` (harness đòi db 1–15, FLUSHDB db đó), `DATABASE_URL_TEST` → DB riêng `taskflow_it`, `REQUIRE_INTEGRATION=1` toàn cục. `VITEST_MAX_WORKERS=2` toàn cục **không** lọt vào integration: `vitest.integration.config.ts` xóa biến trước khi Vitest đọc + `serial.int.ts` khẳng định chạy tuần tự. Khóa lượt chạy lấy trên DB `postgres` (PUBLIC có CONNECT). Không còn biến nào harness đọc mà CI thiếu (`INTEGRATION_LOCK_WAIT_MS`, `TASK_CC_REPEAT` có mặc định) | không đổi |
| 2 | Coverage contracts + api | **Đạt.** Job `unit`: `@taskflow/api test:coverage` (ngưỡng ở `apps/api/vitest.config.ts`: core 90/85, domain 90/85, application 80/75) và `@taskflow/contracts test:coverage` (80 lines/statements) — ngưỡng hụt ⇒ exit ≠ 0 | không đổi |
| 3 | E2E: rank-tilde mặc định + `noCspViolations` | **THIẾU — CI không có job E2E nào**, dù devops.md §5.1/§8.5 bắt buộc `e2e` trên PR từ Phase 4. Trong code thì đạt: `rank-tilde.e2e.ts` không có skip; `noCspViolations` là fixture `auto: true` và **mọi** spec lấy `test` từ `support/fixtures` (5 spec import `@playwright/test` đều là `import type`) | **thêm job `e2e`** (xem dưới) |
| 4 | Security suite maxWorkers 1 | **Đạt.** `test/security/vitest.config.ts`: xóa `VITEST_MAX_WORKERS`, `fileParallelism: false`, `maxWorkers: 1`. **Lỗ phụ tìm thấy:** `valkey-outage.sec.ts` tự `docker run` Valkey theo `SEC_VALKEY_IMAGE`, mặc định là **tag** `valkey/valkey:9.1.2` (comment ghi "đã pin digest, không kéo mạng"). Trên runner, service Valkey được kéo theo **digest** nên tag đó không tồn tại ⇒ `docker run` kéo mạng theo tag không ghim | thêm `env.VALKEY_IMAGE` (tag + digest, cùng ảnh service) và `SEC_VALKEY_IMAGE: ${{ env.VALKEY_IMAGE }}` cho job `security` |
| 5 | `integration-isolation-gate.mjs` hằng tuần? | Xem **Đề xuất** | không đổi (script thuộc F) |
| 6 | `backup-drill.yml` dùng đúng compose project/tmpfs của B2 | **Đạt.** `drill.compose.yml` có `name: taskflow-backup-drill` (workflow không cần `-p`), mọi dữ liệu trên tmpfs (gồm `/var/lib/postgresql` — VOLUME của image PG18), không mở cổng host, image ghim digest; log drill trước tear down. `down -v` chỉ chạy trên runner tạm (luật "không xóa dữ liệu" là cho máy dev) | không đổi |

Thêm: bước "Image migrate — quyền DB sau deploy" trong job `build` có lệnh `docker run` bị dồn thành một dòng (mất `\` nối dòng, còn chuỗi khoảng trắng) — vẫn chạy được nhưng khó đọc/khó review ⇒ tách lại nhiều dòng, nội dung không đổi.

## Job `e2e` mới
**Vòng 2 (Tech Lead quyết 2026-10-16):** (a) chấp nhận harness thật; devops.md §5.1 + §8.5 sửa cho khớp thực tế (prodlike là mục tiêu sau khi chốt hosting). (b) job tách thành workflow tái sử dụng `.github/workflows/e2e.yml` (`workflow_call` input `full` + `schedule` 19:00 UTC hằng đêm + `workflow_dispatch`); `ci.yml` gọi với `full = event != pull_request` ⇒ **PR chỉ Chromium; push main / nightly / chạy tay: Chromium + Firefox + mobile**. Project chỉ định tường minh (`--project=…`, `E2E_FIREFOX`/`E2E_MOBILE`), không dựa vào `CI=true`; chỉ cài trình duyệt cần cho lượt đó.

- Service Postgres 18.6 + Valkey 9.1.2 (cùng digest các job khác) → `01-roles.sh` (migrator có CREATEDB) → `pnpm --filter "@taskflow/web..." build` (globalSetup đòi `.next/standalone`) → `playwright install --with-deps chromium firefox` → `pnpm --filter @taskflow/e2e test`.
- Biến: `SEC_PG_*` (harness E2E dùng lại `loadHarnessConfig` của suite bảo mật) với mật khẩu `*_ci_only`, `E2E_PG_DB=taskflow_e2e`, `E2E_REDIS_URL=redis://127.0.0.1:6379/14`. `CI=true` ⇒ config tự bật Chromium + Firefox + mobile (@main), `forbidOnly`, reporter html.
- Lỗi ⇒ upload `playwright-report` + `test-results` (trace/video chỉ giữ khi fail), 7 ngày.
- **Lệch thiết kế — ĐÃ QUYẾT (chấp nhận, doc đã sửa):** devops.md §8.5 muốn E2E trên `docker-compose.prodlike.yml` (image đã build + Caddy TLS cho cookie `__Host-`). Harness T-026 hiện chạy `src/main.ts` + web standalone — job này theo harness có thật, không theo tài liệu. Đổi sang prodlike là việc riêng (cần file prodlike + CA tự ký trong Playwright — §8.5 ⚠).
- Config Playwright không có WebKit (§8.5 cũ nêu WebKit) — doc đã ghi theo thực tế; thêm WebKit là việc của F nếu cần.

## Đề xuất cho điểm 5 (`integration-isolation-gate.mjs`)
**Không cần job hằng tuần riêng** (Tech Lead đồng ý; ý `F2_GATE_PG` chuyển cho F sau khi F xong mutation). Lý do:
1. Chế độ (a) — `VITEST_MAX_WORKERS=2`, một lượt phải xanh — **đã chạy trên mọi PR**: CI đặt `VITEST_MAX_WORKERS: '2'` toàn cục và job `integration` chạy `test:integration` với biến đó; `serial.int.ts` làm đỏ nếu 2 file chạy song song.
2. Chế độ (b) — 2 lượt song song cùng DB ⇒ lượt sau chờ/từ chối — kiểm khóa advisory của harness; hồi quy chỉ xảy ra khi có người sửa `global-setup.ts`. Hợp lý hơn: chạy (b) trên **PR đụng `apps/api/test/integration/**`** (paths filter), không phải theo lịch.
3. Script hiện **chưa chạy được trên CI**: chuỗi kết nối Postgres là hằng số local (`127.0.0.1:5434`, `migrator_local_only`) — chỉ DB và Valkey đổi được bằng env. Muốn đưa vào CI cần thêm biến kiểu `F2_GATE_PG` — script thuộc thư mục của F ⇒ F sửa nếu Tech Lead đồng ý mục 2.

## Kiểm chứng
| Kiểm | Kết quả |
|---|---|
| `actionlint` 1.7.12 (image `rhysd/actionlint`, mọi workflow) | exit 0 |
| hook pre-commit (prettier + gitleaks) | xem commit |
| Chạy thật job `e2e` | **CHƯA CHẠY TRÊN CI** — Tech Lead quyết không chạy thử cục bộ (các bước có tương đương local, F đã chạy bộ E2E nhiều lần). Lần chạy thật đầu tiên là khi người dùng push |

## Rủi ro / câu hỏi mở
- Thời gian job `e2e` chưa đo (3 project, build web nguội). `timeout-minutes: 30` là ước lượng.
- E2E-16 (cùng image, API_URL khác — "thuộc CI" theo T-026) vẫn `fixme`: cần job dựa trên image (`build`), không làm ở đây.
