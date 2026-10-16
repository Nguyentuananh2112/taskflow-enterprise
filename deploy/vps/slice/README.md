# Lát cắt VPS trên máy dev (D3)

Chạy **đúng** `deploy/vps/compose.prod.yml` + `Caddyfile` + `bootstrap.sh` + job migrate của repo bằng image build tại chỗ, rồi smoke **qua Caddy + TLS** như người dùng từ Internet. Dùng để kiểm thay đổi ở `deploy/vps/` hoặc image trước khi có VPS thật (D3, ADR-070). Kết quả lần chạy gần nhất: `docs/reviews/D3-report.md` §"Lát cắt VPS — chạy lại".

**Chỉ chạy khi Tech Lead báo "máy rảnh"** (5 container ~1 GB + build image). Chỉ đụng compose project `taskflow-d3-slice`; không đụng compose `taskflow` dùng chung.

## Quy tắc

- `SLICE_DIR` (`.env`, `.env.api`, cert Valkey — **secret** do `bootstrap.sh` sinh) phải nằm **ngoài repo** — script từ chối nếu nằm trong repo (repo public, ADR-072). Giữ nguyên thư mục này giữa các lần chạy: volume `taskflow-d3-slice_pgdata` được khởi tạo bằng mật khẩu trong `.env` của nó.
- Mỗi lần chạy, script chép cấu hình từ repo (`deploy/vps/*`, `docker/postgres/init/01-roles.sh`) vào `SLICE_DIR` ⇒ kiểm đúng bản trên branch hiện tại.
- **Cổng RAM**: trước mỗi bước, RAM trống < `MIN_FREE_GB` (mặc định 3) ⇒ tự `down` và dừng (exit 3).
- Dọn bằng `down` thường (cuối mỗi lượt và khi thoát). **Không bao giờ `down -v`** — xóa volume là việc của người dùng (lệnh ở D3-report).

## Chạy

```bash
# Build image (từ commit cần kiểm; nặng — chờ máy rảnh)
docker build -f apps/api/Dockerfile --target runtime --build-arg GIT_SHA=<sha> -t taskflow-api:slice .
docker build -f apps/api/Dockerfile --target migrate -t taskflow-api-migrate:slice .
docker build -f apps/web/Dockerfile --build-arg GIT_SHA=<sha> -t taskflow-web:slice .

export SLICE_DIR=~/taskflow-d3-slice            # NGOÀI repo
bash deploy/vps/slice/run-slice.sh init         # 1 lần: bootstrap.sh (APP_ENV=production, *.localhost)
SLICE_API_IMAGE=taskflow-api:slice SLICE_WEB_IMAGE=taskflow-web:slice SLICE_MIGRATE_IMAGE=taskflow-api-migrate:slice \
  bash deploy/vps/slice/run-slice.sh            # ENVS="production staging" mặc định
```

Mỗi lượt `APP_ENV`: postgres + valkey (TLS) → job migrate (migrate deploy + grant) → api + web + caddy (chờ healthy) → in `appEnv` trong log api và `NODE_ENV`/`APP_ENV` thật trong container → `smoke.mjs` → `down`. Exit 0 khi mọi lượt đạt.

## `smoke.mjs` kiểm gì

Chạy bằng Node trong image API, trên network của project, `api.localhost`/`app.localhost` → IP Caddy, tin CA nội bộ của Caddy (`NODE_EXTRA_CA_CERTS`):

| Nhóm                 | Kiểm                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sức khỏe             | `/healthz`, `/readyz` (db + valkey), web `/api/healthz`, HTTP → HTTPS (301/308)                                                                                                                                                                |
| Header               | HSTS (api + web), `nosniff`, không `X-Powered-By`, `no-store` trên `/auth`, CSP web có nonce và không `unsafe-inline` cho script, chống frame                                                                                                  |
| Phiên                | đăng ký 201, đăng nhập 200, cookie `__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/`, không `Domain`; `refresh` 200 với Origin hợp lệ, 403 với Origin lạ (POST gửi `Content-Type: application/json` + `{}` như web thật — thiếu ⇒ 415) |
| Nghiệp vụ + realtime | tạo project + 2 task, move qua HTTP ⇒ nhận đúng 1 event `task:moved` qua `wss://` (Socket.IO websocket-only)                                                                                                                                   |

Script không in token/cookie (giá trị cookie được che).
