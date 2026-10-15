# Kiểm thử tải k6 (T-027)

Đo P95/P99 theo NFR (đọc < 150 ms, ghi < 300 ms, WebSocket < 100 ms — ADR-030; login/register không đo), tìm **điểm gãy** RPS, độ trễ realtime, và phân tích truy vấn.

> **Chỉ chạy khi Tech Lead báo "máy rảnh".** Số đo trên máy dev chỉ để so sánh tương đối; `environment.md` của mỗi lần chạy ghi cấu hình + tải nền.

```bash
bash load/run.sh                          # Git Bash; dựng hạ tầng TẠM riêng → seed → board → realtime → phân tích → dọn
STAGES=10,25,50 STAGE_SECONDS=30 bash load/run.sh   # chạy thử nhanh
KEEP=1 bash load/run.sh ; bash load/run.sh down     # giữ container để soi, rồi tự dọn
```

Kết quả: `load/results/<thời điểm>/` (gitignore): `board-summary.{md,json}`, `realtime-summary.{md,json}`, `analyze.txt` (pg_stat_statements + EXPLAIN ANALYZE), `stats-after-board.txt`, `environment.md`, `seed.txt`.

| File                    | Vai trò                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `seed/seed.sql`         | 5 workspace × 3 project × 500 task, 20 user/workspace — ghi thẳng SQL (từ chối chạy ngoài DB `taskflow_t027*`/`taskflow_load*`, ADR-106) |
| `scenarios/board.js`    | `ramping-arrival-rate` theo bậc `STAGES`: đọc cột 60% · move 20% · sửa 10% · tạo 10%; tag `kind`/`name`/`stage`                          |
| `scenarios/realtime.js` | Socket.IO (Engine.IO v4 tự cài trên `k6/websockets`, websocket-only): move qua HTTP ⇒ đo tới khi client khác nhận `task:moved`           |
| `lib/common.js`         | login toàn bộ user trong `setup()`, `X-Forwarded-For` riêng mỗi user (API chạy `TRUST_PROXY_HOPS=1` như sau LB)                          |
| `lib/summary.js`        | điểm gãy + bảng P50/P95/P99 theo endpoint → stdout/JSON/Markdown                                                                         |
| `sql/analyze.sql`       | top truy vấn (pg_stat_statements), EXPLAIN ANALYZE truy vấn board, kích thước bảng                                                       |

Vì sao `X-Forwarded-For` riêng mỗi user: rate limit theo IP (1000 req/phút cho request có token, 20 handshake socket/phút) là đúng thiết kế; một máy k6 đóng vai hàng trăm người dùng thì phải mô phỏng IP của họ, nếu không ta chỉ đo được rate limiter. Giới hạn **theo user** (300/phút) vẫn áp dụng — 429 được đếm riêng (`rate_limited`).
