# T-027 — Báo cáo: kiểm thử tải k6 (P95 theo NFR + realtime)

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/T-027` · **Ngày đo:** 2026-10-16 00:34–01:10 (giờ VN)
**Căn cứ:** Blueprint §1.1 NFR, ADR-030 (đọc P95 < 150 ms, ghi P95 < 300 ms, WebSocket < 100 ms; login/register **không** đo — argon2id, ADR-065), devops.md §8, T-033 (khóa cột + rebalance).

> **Số đo trên máy dev, chỉ để so sánh tương đối** — không phải năng lực production. Một tiến trình API, Postgres/Valkey trong Docker Desktop cùng máy với k6.

## Môi trường

| Mục | Giá trị |
|---|---|
| Code đo | `main` 3b5e9e0 + `feat/T-027` (image `taskflow-api:load` build 00:34–00:50 từ commit này) |
| Máy | Windows 11, 12 luồng; Docker 29.8.2, VM 10 CPU / 19,5 GiB |
| Tải nền lúc đo | Tech Lead báo "máy rảnh" 00:35 (không E2E/integration nào); 3 container khác đang chạy |
| Hạ tầng | compose project `taskflow-load` riêng (`load/compose.load.yml`): Postgres 18.6 + `pg_stat_statements` (tmpfs, `max_connections=200`), Valkey 9.1.2 (tmpfs), API image production `NODE_ENV=test`, `DATABASE_POOL_MAX=20`, `TRUST_PROXY_HOPS=1`. Không map cổng ra host; dọn bằng `down` thường ⇒ sau mỗi lượt `docker volume ls --filter label=com.docker.compose.project=taskflow-load` **rỗng** (đã kiểm 2 lần) |
| Dữ liệu | seed giả `load/seed/seed.sql`: 5 workspace × 3 project × 500 task, 20 user/workspace (+ 2 project/ws cột rank dài cho rebalance) |
| k6 | `grafana/k6:2.3.0` (image ghim digest), `X-Forwarded-For` riêng từng user (rate limit theo IP là đúng thiết kế — không để k6 chỉ đo limiter) |

## 1. Board — tìm điểm gãy (`ramping-arrival-rate`, bậc 60 s)

Trộn: đọc cột 60 % · move 20 % · sửa 10 % · tạo 10 %.

**Điểm gãy: 150 RPS** — bậc đầu tiên P95 vượt NFR. Không có lỗi HTTP ở bất kỳ bậc nào (độ trễ tăng, không đổ vỡ).

| RPS mục tiêu | Request | Đọc P95 | Đọc P99 | Ghi P95 | Ghi P99 | Lỗi | Đạt NFR |
|---|---|---|---|---|---|---|---|
| 10 | 774 | 17,6 | 26,0 | 13,8 | 19,9 | 0 % | ✅ |
| 25 | 1823 | 13,6 | 17,4 | 12,9 | 17,0 | 0 % | ✅ |
| 50 | 3779 | 9,5 | 11,7 | 11,4 | 14,0 | 0 % | ✅ |
| 75 | 5691 | 11,8 | 18,6 | 18,5 | 33,0 | 0 % | ✅ |
| **100** | 7613 | **14,1** | 29,0 | **22,5** | 42,4 | 0 % | ✅ |
| 150 | 11240 | 824,3 | 934,3 | 776,3 | 912,9 | 0 % | ❌ |
| 200 | 12091 | 2332,8 | 2949,2 | 2018,1 | 2568,8 | 0 % | ❌ |
| 300 | 13811 | 2200,1 | 2519,3 | 1893,0 | 2216,3 | 0 % | ❌ |

P95/P99 theo endpoint (toàn bộ lượt — gồm cả các bậc đã gãy, nên chỉ để xếp hạng):

| Endpoint | P50 | P95 | P99 | Max (ms) |
|---|---|---|---|---|
| GET tasks (đọc cột) | 448,1 | 2210,1 | 2368,3 | 3298,2 |
| PATCH move | 520,2 | 1935,6 | 2101,5 | 3033,9 |
| PATCH task | 413,9 | 1861,1 | 2043,2 | 2852,0 |
| POST tasks | 422,5 | 1487,4 | 1653,8 | 2530,2 |

409 VERSION_CONFLICT (tranh chấp, không tính lỗi): 77 · 429: 0.

Đọc số: tới 100 RPS mọi P95 dưới 25 ms (dư ~6–10 lần so với NFR); sang 150 RPS nhảy bậc lên ~800 ms mà không có lỗi ⇒ **hàng đợi**, không phải truy vấn chậm dần. Ở 200/300 RPS số request gần như không tăng (12–14 nghìn/bậc) ⇒ thông lượng trần của cấu hình này khoảng **~200 RPS**.

## 2. Realtime — move qua HTTP → client khác nhận `task:moved`

20 socket (Socket.IO websocket-only), mỗi socket move 1 lần/giây, 120 s.

| Đo | Mẫu | P50 | P95 | P99 | Max (ms) | NFR |
|---|---|---|---|---|---|---|
| `realtime_push_ms` (occurredAt của event → client nhận) | 14796 | 0,0 | **9,0** | 23,0 | 129,0 | < 100 ✅ |
| `realtime_e2e_ms` (bắt đầu PATCH → client nhận) | 2005 | 13,0 | **31,0** | 150,6 | 61073 * | < 400 ✅ |
| PATCH move (trong kịch bản này) | — | 12,5 | 29,4 | 51,1 | 200,8 | < 300 ✅ |

Event mất: 0 · lỗi kết nối: 0 · 429: 0.
\* Max 61 s là một mẫu đơn lẻ: k6 ghép event với lần PATCH theo `task.id`; task bị move lại trước khi event cũ tới ⇒ mẫu bị ghép nhầm. P99 150 ms cho thấy không phải hiện tượng chung — sửa cách ghép (theo `version`) ở lượt sau.

**Lượt đầu realtime hỏng (đã sửa):** cả 20 socket bị từ chối `ORIGIN_NOT_ALLOWED` — gateway (SEC-56, chống CSWSH) chỉ nhận handshake có `Origin` trong `CORS_ORIGINS`, kịch bản k6 không gửi `Origin`. Sửa `load/scenarios/realtime.js` (gửi `Origin`, mặc định `http://localhost:3001` = `CORS_ORIGINS` của compose load) rồi chạy lại **riêng** realtime (`SCENARIOS=realtime`, cùng image). Đây là lỗi của kịch bản đo, không phải của app — app từ chối đúng như thiết kế.

## 3. Cột nóng — mọi user cùng move trong một cột (khóa cột T-033)

| RPS mục tiêu | Request | Ghi P95 | Ghi P99 | Lỗi | Đạt |
|---|---|---|---|---|---|
| 5 | 600 | 14,0 | 17,9 | 0 % | ✅ |
| 10 | 1150 | 12,3 | 14,8 | 0 % | ✅ |
| 20 | 2300 | 12,8 | 15,6 | 0 % | ✅ |
| 40 | 4598 | 11,6 | 14,2 | 0 % | ✅ |

PATCH move (hot): P50 8,3 · P95 12,4 · P99 15,1 · max 23,5 ms; 0 xung đột 409. **Không gãy tới 40 move/s trên một cột** — khóa cột xếp hàng ngắn (~1 ms/lệnh, xem §5).

## 4. Move kích hoạt rebalance (T-033)

40 cột × 500 task rank 64 ký tự liền kề; mỗi VU chen 1 task vào giữa ⇒ rank 65 > ngưỡng ⇒ rebalance cả cột trong cùng transaction, rồi 1 move thường trong cùng cột. **40 VU chạy đồng thời** (`per-vu-iterations`) ⇒ đây là kịch bản **xấu nhất** (40 rebalance cùng lúc), không phải độ trễ của một rebalance đơn lẻ.

| Move | Mẫu | P50 | P95 | P99 | Max (ms) |
|---|---|---|---|---|---|
| kích hoạt rebalance (cột 500 task) | 40 | 5636 | 7906 | 8045 | 8087 |
| move thường ngay sau rebalance | 29 | 5863 | 6792 | 6822 | 6827 |

- Rebalance **có chạy**: rank dài nhất sau move = 3 ký tự (trước: 64).
- Move thường sau rebalance **vượt NFR 300 ms** (threshold đỏ) — nhưng số này đo trong lúc 39 rebalance khác còn chiếm CPU/DB; không tách được phần "chờ" và phần "làm".
- Chỉ 29/40 mẫu move thường: 11 VU không ghi được mẫu (có thể do `maxDuration` hoặc move lỗi trong lúc tranh chấp) — **chưa xác minh**, cần chạy lại với log từng VU.

## 5. Truy vấn (pg_stat_statements, sau lượt board → rebalance)

Top theo tổng thời gian:

| Truy vấn | Lượt | TB (ms) | Tổng (ms) |
|---|---|---|---|
| SELECT tasks (đọc cột board) | 43745 | 0,43 | 18893 |
| `pg_advisory_xact_lock(hashtextextended(…))` — khóa cột T-033 | 17481 | 1,08 | 18815 |
| UPDATE projects `next_task_number` (cấp số task khi tạo) | 4329 | **1,83** | 7933 |
| UPDATE tasks | 37318 | 0,08 | 3074 |
| INSERT task_audit_logs | 41645 | 0,07 | 3061 |

`EXPLAIN ANALYZE`: đọc 1 cột (200/500 task) **1,4 ms** — Bitmap Index Scan trên `tasks_rank_live_key` (project_id, status), sort top-N theo `rank COLLATE "C"`, cache hit 100 %; đọc cả board (2000 task) **1,5 ms** qua `tasks_project_id_number_key`. Index hiện có đủ — **không** đề xuất index mới.

## 6. 3 điểm chậm nhất & đề xuất (chỉ đề xuất, không sửa code module của người khác)

1. **Thông lượng trần ~150–200 RPS là ở tầng API, không phải DB.** Truy vấn TB < 2 ms, cache hit 100 %, nhưng P95 nhảy từ 14 ms lên 800 ms giữa 100 và 150 RPS mà không có lỗi ⇒ hàng đợi ở event loop Node / pool 20 kết nối. *Lưu ý:* `docker stats` của lượt này chụp **sau** khi board xong (API 0,65 % CPU) nên không chứng minh được CPU bão hòa — lượt sau cần chụp CPU/event-loop lag **trong** bậc 150. Đề xuất (A/Tech Lead quyết): (a) đo lại với `DATABASE_POOL_MAX` 10/20/40 để tách pool khỏi CPU; (b) production chạy ≥ 2 instance sau LB (App Platform tự scale ngang) — với ~150 RPS/instance trên máy dev, NFR của v1 dư nhiều; (c) theo dõi `http_request_duration_seconds` P95 theo route (devops.md §7) để cảnh báo sớm.
2. **Move kích hoạt rebalance cột 500 task: 5,6–8 s khi 40 cột rebalance cùng lúc.** Cần đo một rebalance đơn lẻ (`REBAL_COLUMNS=1`) trước khi kết luận; nếu một rebalance đơn lẻ cũng > 300 ms thì đề xuất cho chủ T-033: rebalance theo lô `UPDATE … FROM (VALUES …)` thay vì từng dòng, hoặc dời sang job nền sau commit (move vẫn thành công với rank 65 ký tự).
3. **Cấp số task (`UPDATE projects next_task_number`) 1,83 ms TB — chậm nhất theo trung bình**, vì mọi lệnh tạo task trong một project tuần tự hóa trên một dòng. Ổn với tải đo; chỉ đáng xử lý nếu tạo task hàng loạt (import) — khi đó cấp một khoảng số trong 1 lệnh.

`pg_advisory_xact_lock` tổng thời gian cao (18,8 s / 17481 lượt, TB 1,08 ms) là chi phí chờ khóa cột khi move cùng cột — đúng thiết kế T-033, P95 move vẫn 12 ms ở cột nóng.

## 7. Thay đổi trong `load/` khi chạy lượt này

| File | Nội dung |
|---|---|
| `load/compose.load.yml` (mới) | compose project `taskflow-load`, network trong file, Postgres/Valkey trên **tmpfs** (phủ cả `VOLUME` của image PG 18) ⇒ `down` thường dọn sạch, không cần `down --volumes` (bị cấm) |
| `load/run.sh` | chỉ dùng `docker compose -p taskflow-load …`; `API_IMAGE`/`MIGRATE_IMAGE` để bỏ build; `SCENARIOS` để chạy riêng kịch bản |
| `load/scenarios/realtime.js` | gửi `Origin` (SEC-56) |

Lệnh đã chạy:
```bash
bash load/run.sh                                                    # 00:34–01:06, gồm build 16'
SCENARIOS=realtime API_IMAGE=taskflow-api:load \
  MIGRATE_IMAGE=taskflow-api-migrate:load bash load/run.sh         # 01:07–01:10
docker volume ls --filter label=com.docker.compose.project=taskflow-load -q   # rỗng sau mỗi lượt
```

## Việc mở

- Chụp CPU/event-loop lag **trong** bậc gãy; đo lại với pool 10/20/40.
- Rebalance đơn lẻ (`REBAL_COLUMNS=1`); log 11 VU thiếu mẫu.
- Ghép event realtime theo `version` thay vì `task.id` (loại mẫu 61 s).
- `environment.md` của lượt này ghi dòng `git:` rỗng (chưa rõ nguyên nhân) — commit đo ghi tay ở trên; sửa `run.sh` lượt sau.
- Đo trên staging thật (devops.md §8 mục 28) khi đã chọn hosting.
