# T-004 — Báo cáo: Thiết kế vận hành production & CI/CD

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Ngày:** 2026-10-15

## Đã làm
- Viết `docs/design/devops.md`, đủ 9 mục của ticket, cộng câu hỏi mở và danh sách nguồn.
- Không viết code/config thật, không commit, không sửa file ngoài phạm vi.
- `docs/research/stack-versions.md` (T-001) chưa có → không ghi số phiên bản nào; mọi điểm phụ thuộc phiên bản đánh dấu `<ver: T-001>` hoặc ⚠.

## File
- `docs/design/devops.md` (mới)
- `docs/reviews/T-004-report.md` (file này)

## Đề xuất chính (cần người dùng chốt vì tốn tiền)
**Hosting: Phương án C — DigitalOcean App Platform + Managed PostgreSQL + Managed Valkey, region Singapore; staging là 1 droplet chạy docker compose.** Ước tính ≈ $55–70/tháng cho prod + ~$12 cho staging. Lý do chính: PITR 7 ngày có sẵn (dữ liệu thật, không có DBA); không phải vá OS; scale ngang chỉ cần kéo số instance. Dự phòng giá rẻ: Phương án A (1 VPS + Compose + Caddy, ≈ $36), nhưng bắt buộc tự làm WAL-G/pgBackRest và diễn tập restore.

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. `/readyz` **không** đỏ khi Redis lỗi (chỉ báo `degraded` + cảnh báo). Nếu đỏ, LB sẽ rút mọi instance cùng lúc, trong khi T-002 đã có fallback sang DB.
2. Socket.io client chỉ dùng `transports: ['websocket']` → không cần sticky session ở mọi nền tảng. Cần Engineer E và B đồng ý.
3. Web nhận `API_URL` lúc chạy thay vì `NEXT_PUBLIC_*` lúc build, để build 1 lần rồi promote cùng image. Chi tiết do Engineer E quyết.
4. Tách 2 user DB: `taskflow_app` (chỉ DML) và `taskflow_migrator` (DDL); thêm `DIRECT_DATABASE_URL`.
5. Thêm env mới: `APP_ENV`, `JWT_ACCESS_KID` (+ `_PREVIOUS`), `DATABASE_POOL_MAX`, `SOCKET_REDIS_ADAPTER`, `SHUTDOWN_TIMEOUT_MS`, `METRICS_TOKEN`, `GIT_SHA`, `BCRYPT_COST`.
6. Ngưỡng coverage: domain ≥ 90%, application ≥ 80% (ticket yêu cầu ≥ 80% cho cả hai).
7. Integration test: mỗi worker Vitest một DB clone từ template, TRUNCATE giữa các file. **Không** rollback transaction sau mỗi test, vì phải commit thật mới kiểm được ADR-012.
8. Job định kỳ chạy trong api, dùng `pg_try_advisory_lock`. Backup logical chạy ngoài api.
9. Redis để `noeviction` + cảnh báo memory: nếu Redis tự lặng lẽ xóa bộ đếm rate-limit thì thành lỗ hổng bảo mật.
10. Thêm backup logical hằng ngày ra storage **ngoài** nhà cung cấp hosting, dù đã có PITR (phòng mất hoặc bị chiếm tài khoản).

## Rủi ro
- **GitHub:** với repo private trên gói Free/Pro/Team, Environment không có required reviewers/wait timer (đã kiểm tài liệu GitHub). Branch protection trên repo private cũng cần gói trả phí. Khi đó "duyệt tay production" chỉ là `workflow_dispatch` (biện pháp mềm).
- **Hetzner:** trang Cloud ngày 2026-10-15 ghi dòng CX "Currently not available", và giá đã tăng 2 lần trong 2026 → không chọn làm phương án chính.
- **Giá Render** chỉ lấy được từ nguồn thứ cấp, các nguồn mâu thuẫn nhau (đã đánh dấu ⚠).
- **Chưa kiểm chứng trên DigitalOcean App Platform:** WebSocket qua ingress, job PRE_DEPLOY, thời gian chờ trước SIGKILL, giới hạn connection của gói PG 1 GiB. → Cần PoC ở Phase 1 trước khi trả tiền dài hạn.
- **Phụ thuộc T-001:** Prisma 7 (prisma.config, driver adapter, migration có bọc transaction không, binary engine), `pnpm deploy`, Next 16 standalone, Valkey với `@socket.io/redis-adapter`.
- **k6 không nói giao thức Socket.io gốc** → kịch bản đo fan-out realtime cần client riêng (quyết ở Phase 5).

## Câu hỏi mở
Q1 hosting/region/ngân sách · Q2 domain · Q3 GitHub public/private + gói · Q4 dịch vụ log/metrics/uptime + kênh cảnh báo · Q5 runtime config web (E) · Q6 websocket-only (E+B) · Q7 readyz/Redis + tách user DB (B) · Q8 các điểm phụ thuộc T-001. Chi tiết ở §10 của `devops.md`.

## Đề xuất ngoài phạm vi
- Phase 1: thêm các env ở mục 5 vào `.env.example`; tạo `docs/runbooks/` và `docs/ops/` (restore-drills, go-live).
- DECISIONS: nếu duyệt, nên ghi thành ADR các mục: hosting (Q1), websocket-only, migrate là job riêng trước rollout, chính sách backup/RPO/RTO.
