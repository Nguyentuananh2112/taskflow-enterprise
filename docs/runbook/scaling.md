# Runbook — Khi nào và cách scale (API / Postgres / Valkey)

**Chủ tài liệu:** Engineer D (DevOps) · **Căn cứ:** số đo T-027 / T-027b / T-027c (`docs/reviews/T-027-report.md`, `T-027c-report.md`), A3-report §6 (điều kiện N > 1), devops.md §4.5 (pool), §6.5 (cảnh báo), §7 (scale ngang), ADR-074 / ADR-105 / ADR-115.
**Liên quan:** `docs/runbook/deploy.md` (thao tác hạ tầng), `docs/runbook/security-go-live.md` §4.4–4.5 (B — điều kiện bảo mật khi > 1 instance).

## 0. Số đo làm nền (máy dev — chỉ để so tương đối)
| Cấu hình | Kết quả | Nguồn |
|---|---|---|
| 1 tiến trình Node, k6 gọi thẳng | đạt NFR tới 100 RPS (API CPU TB **71 %**); 150 RPS: trước A3 gãy (API **103 %** = 1 lõi), sau A3 đạt sát ngưỡng (API TB 92 %) | T-027b §8.2, T-027c (a) |
| 1 bản sau LB | gãy NFR ở 150 RPS, trần ~188 req/s | T-027c (c) |
| 2 bản sau LB | gãy ở 300 RPS, trần ~265 req/s (**×1,4**); **Postgres đỉnh 113 %** | T-027c (c) |
| Bên trong 1 bản API | Prisma client ≈ 1/3 thời gian CPU bận; code app ≈ 6 % | T-027c cpu-prof |

Hệ quả: **API (một tiến trình Node, một lõi) bão hòa trước**; khi đã có 2 bản thì **Postgres là nút cổ chai kế tiếp**. Từ ~70 % CPU API tới lúc gãy NFR chỉ còn khoảng ×1,5 tải ⇒ 70 % là ngưỡng **lập kế hoạch**, 80 % (cảnh báo hiện có) là ngưỡng **hành động ngay**.

## 1. Tín hiệu → hành động
"Liên tục" = trung bình ≥ 30 phút trong giờ cao điểm, lặp lại ≥ 2 ngày trong tuần (một lần tăng vọt do deploy/import KHÔNG tính).

| Tín hiệu (nguồn) | Ngưỡng | Hành động | KHÔNG làm |
|---|---|---|---|
| CPU API (nền tảng; `process_cpu_seconds_total`) | > **70 %** liên tục | Thêm 1 instance API (§3) sau khi đủ điều kiện §2. Cảnh báo 80 %/10 phút (`.do/app.yaml`) đã bắn ⇒ làm ngay trong ngày | Tăng `UV_THREADPOOL_SIZE`/RAM để "chữa" CPU (security.md: RAM argon2) |
| Độ trễ event loop (`nodejs_eventloop_lag_p99_seconds`, metric mặc định prom-client) | > 0,1 s liên tục | Như dòng trên — dấu hiệu sớm hơn %CPU của cùng nút cổ chai | |
| P95 theo route (`http_request_duration_seconds`) vượt NFR (đọc 150 / ghi 300 ms) | 15 phút | **CPU API cao** ⇒ thêm instance. **CPU API thấp** ⇒ KHÔNG scale API: xem Postgres (dòng dưới), khóa cột T-033 (`pg_advisory_xact_lock` chờ lâu), truy vấn chậm | Thêm instance khi API không bận (chỉ thêm kết nối DB) |
| CPU Postgres (nền tảng / `docker stats`) | > **70 %** liên tục | 1) Top truy vấn: `load/sql/analyze.sql` (pg_stat_statements) — có truy vấn mới chậm/thiếu index ⇒ sửa trước; 2) không có ⇒ **nâng gói PG** (vertical). Trên VPS: Postgres chung máy với API ⇒ nâng cấp VPS hoặc tách DB | Bật PgBouncer để "giảm CPU" (pooler giảm **số kết nối**, không giảm truy vấn) |
| Kết nối Postgres | > **80 %** giới hạn, hoặc ngân sách §4 không đủ cho N mới | PgBouncer chế độ **transaction** cho API (§4.2) hoặc giảm `DATABASE_POOL_MAX` | Tăng `max_connections` trên gói nhỏ (mỗi kết nối tốn RAM) |
| RAM API | > 85 % 10 phút (cảnh báo có sẵn) | Tăng cỡ instance (argon2id ~46 MiB/lần băm × 4 luồng libuv) | |
| Valkey memory | > 80 % | Tăng gói/`maxmemory`; tìm khóa tăng bất thường | Đổi `maxmemory-policy` khỏi `noeviction` (deploy.md §A.1, §C) |

Trước khi thêm phần cứng, có một lựa chọn rẻ hơn đang chờ Tech Lead quyết: Prisma client chiếm ~1/3 CPU của API (T-027c) — tối ưu truy vấn nóng `GET tasks` có thể lùi thời điểm phải scale.

## 2. Điều kiện bắt buộc TRƯỚC khi chạy > 1 instance API
| # | Điều kiện | Kiểm |
|---|---|---|
| 1 | `SOCKET_REDIS_ADAPTER=true` cho **mọi** instance API — bật cả adapter Socket.IO qua Valkey (ADR-027/074) lẫn bộ đếm hạn mức realtime dùng chung `SharedRealtimeQuota` (ADR-115). Thiếu ⇒ logout-all/xóa thành viên không ngắt socket ở instance khác, trần realtime nhân N | env của service; log khởi động không có cảnh báo adapter |
| 2 | Checklist bảo mật `security-go-live.md` §4.4 + §4.5 (B) xanh trên staging 2 instance | output theo runbook B |
| 3 | `TRUST_PROXY_HOPS` **đo lại** sau LB (devops.md §9 mục 4) — sai thì rate limit theo IP dồn về IP của LB (T-027c: k6 phải giữ XFF qua Caddy mới đo đúng) | `req.ip` khớp IP thật; XFF giả không đổi được `req.ip` |
| 4 | Ngân sách kết nối §4 đủ cho N mới | công thức §4.1 |
| 5 | Readiness + graceful shutdown đúng (devops.md §6.2, §7.3) ⇒ rolling deploy không rớt request | smoke deploy staging |
| 6 | Job định kỳ dùng advisory lock (devops.md §7.4) — đã có; khóa cột rebalance nằm ở DB ⇒ đúng nhiều instance (A3 §6) | — |

## 3. Cách thêm instance
### 3.1 App Platform
`deploy.yml` chỉ thay digest/`GIT_SHA` trên spec đang chạy ⇒ đổi số instance bằng tay, một lần:
```bash
doctl apps spec get "$APP_ID" --format yaml > spec.yaml
# services[name=api]: instance_count: 2 ; envs: SOCKET_REDIS_ADAPTER=true (giữ nguyên mọi secret EV[…])
doctl apps update "$APP_ID" --spec spec.yaml --wait
```
Làm trên **staging trước** (điều kiện §2), rồi production. Cập nhật `.do/app.yaml` (mẫu) cho khớp.

### 3.2 VPS
Postgres + Valkey + API chung một máy (T-027c: 2 bản API đẩy Postgres lên 113 %) ⇒ **ưu tiên nâng cấp VPS (vertical)**. Chỉ chạy 2 bản API khi VPS có ≥ 4 vCPU:
- `compose.prod.yml`: service `api` không có `container_name`/cổng host ⇒ `docker compose -f compose.prod.yml up -d --scale api=2 --no-deps api` được; đặt `SOCKET_REDIS_ADAPTER=true` trong `.env.api`.
- `Caddyfile`: `reverse_proxy api:4000` là **một** upstream tĩnh — DNS Docker trả nhiều IP nhưng mỗi lần dial thường lấy IP đầu ⇒ không có cân bằng tải thật ⇒ đổi sang upstream động: `reverse_proxy { dynamic a api 4000 { refresh 5s } }` (cú pháp theo docs Caddy `reverse_proxy` — ⚠ KIỂM CHỨNG trên staging; đây là đổi cấu hình ⇒ admin cài lại theo commit, ci-entry kiểm sha256 — deploy.md §B.1).
- `deploy.sh` rollout theo service ⇒ kiểm `docker compose ps api` đủ 2 bản sau mỗi deploy.

### 3.3 Giảm instance
Tải < 40 % CPU tổng các bản trong 1 tuần ⇒ giảm từng bản một. Về 1 instance vẫn để `SOCKET_REDIS_ADAPTER=true` được (đúng, chỉ tốn 2 kết nối Valkey).

## 4. Ngân sách kết nối Postgres
### 4.1 Công thức (devops.md §4.5)
`N × DATABASE_POOL_MAX + 2 (migrate) + 3 (admin/backup) ≤ giới hạn dùng được của gói`
- `DATABASE_POOL_MAX` mặc định **10** (env.ts, tối đa 50). Ví dụ N = 2 ⇒ 25 kết nối.
- Giới hạn dùng được — hỏi chính cụm, không đoán theo tên gói:
  ```sql
  SELECT current_setting('max_connections')::int - current_setting('superuser_reserved_connections')::int AS dung_duoc,
         (SELECT count(*) FROM pg_stat_activity) AS dang_dung;
  ```
- VPS: Postgres image mặc định `max_connections = 100` ⇒ dư cho N ≤ 4 với pool 10.

### 4.2 Khi không đủ: PgBouncer chế độ transaction
- Chỉ cho kết nối của **API**; job migrate (và backup) **vẫn kết nối thẳng** (DDL, khóa phiên).
- Tương thích theo A3 §6 mục 4: code chỉ dùng khóa advisory **xact** và `set_config(…, true)` (cục bộ transaction). ⚠ Theo devops.md §4.5: trước khi bật trên production phải chạy trên staging bộ integration + security qua pooler (interactive transaction, UoW `AsyncLocalStorage` — ADR-012).
- App Platform: dùng tính năng connection pool của Managed PG (transaction mode) và chuỗi kết nối của pool cho `DATABASE_URL` của `api`. VPS: thêm container PgBouncer — việc riêng, chưa có trong `compose.prod.yml`.

## 5. Sau mỗi lần scale
1. So P95 theo route + CPU từng instance trước/sau 24 h; ghi vào `docs/ops/` (ngày, N, gói, số đo).
2. CPU các instance lệch nhau > 20 điểm ⇒ LB không chia đều (VPS: kiểm upstream động).
3. Postgres CPU/kết nối sau khi tăng N — nút cổ chai kế tiếp theo T-027c.
