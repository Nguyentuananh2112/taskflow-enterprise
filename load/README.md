# Kiểm thử tải k6 (T-027)

Đo P95/P99 theo NFR (đọc < 150 ms, ghi < 300 ms, WebSocket < 100 ms — ADR-030; login/register không đo), tìm **điểm gãy** RPS, độ trễ realtime, và phân tích truy vấn.

> **Chỉ chạy khi Tech Lead báo "máy rảnh".** Số đo trên máy dev chỉ để so sánh tương đối; `environment.md` của mỗi lần chạy ghi cấu hình + tải nền.

```bash
bash load/run.sh                          # Git Bash; dựng hạ tầng TẠM riêng → seed → board → realtime → phân tích → dọn
STAGES=10,25,50 STAGE_SECONDS=30 bash load/run.sh   # chạy thử nhanh
KEEP=1 bash load/run.sh ; bash load/run.sh down     # giữ container để soi, rồi tự dọn
INSTANCES=2 bash load/run.sh                        # T-027c: k6 → LB Caddy → 2 bản API (SOCKET_REDIS_ADAPTER=true)
bash load/two-instance.sh                          # T-027c: board 8 bậc, 1 vs 2 bản + docker stats → compare.md
CPU_PROF=1 INSTANCES=1 SCENARIOS=board bash load/run.sh   # node --cpu-prof → <kết quả>/prof/<service>/*.cpuprofile
```

Hạ tầng là compose project riêng **`taskflow-load`** (`load/compose.load.yml`: network khai trong file, không map cổng ra host, không đụng compose `taskflow` dùng chung). Đặt `API_IMAGE` + `MIGRATE_IMAGE` để dùng image có sẵn thay vì build.

Kết quả: `load/results/<thời điểm>/` (gitignore): `board-summary.{md,json}`, `realtime-summary.{md,json}`, `analyze.txt` (pg_stat_statements + EXPLAIN ANALYZE), `stats-after-board.txt`, `environment.md`, `seed.txt`.

| File                      | Vai trò                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed/seed.sql`           | 5 workspace × 3 project × 500 task, 20 user/workspace — ghi thẳng SQL (từ chối chạy ngoài DB `taskflow_t027*`/`taskflow_load*`, ADR-106)                                                                                |
| `scenarios/board.js`      | `ramping-arrival-rate` theo bậc `STAGES`: đọc cột 60% · move 20% · sửa 10% · tạo 10%; tag `kind`/`name`/`stage`                                                                                                         |
| `scenarios/hot-column.js` | cột nóng: mọi user workspace 1 cùng move trong 1 cột của 1 project (khóa cột T-033 ⇒ xếp hàng), bậc `HOT_STAGES` move/s; P95/P99 + tỉ lệ 409                                                                            |
| `scenarios/rebalance.js`  | move chen giữa 2 task rank 64 ký tự liền kề ⇒ rank 65 > ngưỡng ⇒ rebalance cả cột 500 task (T-033); mỗi cột 1 mẫu, số mẫu = WS × RPROJ × 4; so với move thường ngay sau                                                 |
| `scenarios/realtime.js`   | Socket.IO (Engine.IO v4 tự cài trên `k6/websockets`, websocket-only): move qua HTTP ⇒ đo tới khi client khác nhận `task:moved`                                                                                          |
| `lib/common.js`           | login toàn bộ user trong `setup()`, `X-Forwarded-For` riêng mỗi user (API chạy `TRUST_PROXY_HOPS=1` như sau LB)                                                                                                         |
| `lib/summary.js`          | điểm gãy + bảng P50/P95/P99 theo endpoint → stdout/JSON/Markdown                                                                                                                                                        |
| `compose.lb.yml`          | T-027c, lớp phủ khi đặt `INSTANCES`: `api2` (extends `api`), LB `lb` (Caddy 2.11.7, `lb/Caddyfile`, round robin, không cổng host), cả hai bản `SOCKET_REDIS_ADAPTER=true` + `TRUST_PROXY_HOPS=2`; k6 → `http://lb:4000` |
| `two-instance.sh`         | T-027c: mỗi lượt dựng + seed lại, board 8 bậc với 1 rồi 2 bản (`ORDER="2 1"` để đảo), `docker stats` ~2 s, bảng `compare.md`                                                                                            |
| `sql/analyze.sql`         | top truy vấn (pg_stat_statements), EXPLAIN ANALYZE truy vấn board, kích thước bảng                                                                                                                                      |

Sau LB (T-027c): Caddy chỉ giữ XFF từ proxy tin cậy (`trusted_proxies private_ranges`) rồi nối IP k6 ⇒ API phải tin 2 hop. Thiếu một trong hai, mọi user dồn về 1 IP và lượt đo chỉ đo rate limiter.

Vì sao `X-Forwarded-For` riêng mỗi user: rate limit theo IP (1000 req/phút cho request có token, 20 handshake socket/phút) là đúng thiết kế; một máy k6 đóng vai hàng trăm người dùng thì phải mô phỏng IP của họ, nếu không ta chỉ đo được rate limiter. Giới hạn **theo user** (300/phút) vẫn áp dụng — 429 được đếm riêng (`rate_limited`).
