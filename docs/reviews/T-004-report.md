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

---

# T-004b — Đồng bộ devops.md theo ADR-060 → ADR-074

**Ngày:** 2026-10-15 · **File sửa:** `docs/design/devops.md` (viết lại toàn bộ, giữ nguyên cấu trúc 10 mục), `docs/reviews/T-004-report.md` (nối mục này).

## Đã làm
- **Phiên bản:** thêm bảng "Phiên bản đã chốt" ở đầu tài liệu, lấy từ ADR-060 và stack-versions.md. Gồm: Node 24.22.0 bookworm-slim, pnpm 11.28.2, Prisma 7.10.0, Postgres 18.6, Valkey 9.1.2, node-redis 6.3.0, argon2, Vitest 5.0.4, Playwright 1.64.1, k6 2.3.0, tsdown, gitleaks v8.30.1. Đã thay mọi chỗ `<ver: T-001>`.
- **Mục 0 mới "Hiện trạng":**
  - ADR-070: làm local trước. Staging, deploy và go-live dời sang Phase 5.
  - ADR-071: chưa có domain.
  - Nói rõ thế nào là "không gắn chặt nhà cung cấp": chỉ workflow deploy ở Phase 5 được dùng thứ riêng của nền tảng.
- **ADR-061:**
  - Mọi lệnh Prisma đổi sang `pnpm exec prisma`. CI thêm bước grep cấm `npx prisma`.
  - Bỏ `DIRECT_DATABASE_URL`: `prisma.config.ts` chỉ đọc `DATABASE_URL`, nên job migrate dùng cùng tên biến, trỏ tới user `taskflow_migrator`.
- **ADR-063 (Valkey):** compose, CI services, metric (`valkey_fallback_active`), readyz đều đổi sang Valkey. Giữ tên biến `REDIS_URL` vì đó là giao thức RESP.
- **ADR-065 (argon2id):**
  - Bỏ `BCRYPT_COST`; tham số argon2 là hằng số trong code.
  - RAM api ≥ 1 GiB (~46 MiB mỗi lần băm × 4 luồng).
  - Thêm bước CI smoke argon2 trong image runtime.
  - Thêm metric `password_hash_duration_seconds`.
- **Postgres 18:** volume mount `/var/lib/postgresql`. Dùng image Debian `18.6-bookworm` (không phải alpine) để collation glibc giống bản managed.
- **ADR-072 (repo public):**
  - Chặn rò secret 3 lớp: pre-commit, CI, GitHub push protection.
  - CI an toàn với PR từ fork: không dùng `pull_request_target`, workflow PR không có secret, phải duyệt contributor lần đầu.
  - Bật required reviewers cho environment `production` và branch protection.
  - `.gitignore` chặn file dump/backup. Image GHCR để public nên không được chứa secret.
- **ADR-073:** Sentry free + uptime monitor free; mọi cảnh báo gửi qua email. Ghi rủi ro chấp nhận: không có cam kết phản hồi ngoài giờ.
- **ADR-074:** 8 quyết định đã ghi thành quy định trong các mục tương ứng.
- **ADR-047/050:** thêm job purge workspace (advisory lock, test không purge nhầm), thêm runbook khôi phục workspace bị purge nhầm bằng PITR.
- **ADR-090:** chiến lược test trỏ tới 2 file test-spec. Bộ SEC mở rộng tới SEC-55.
- **ADR-084 / frontend.md §3.6:** `API_URL` gồm cả `/api/v1`; `WS_URL` là origin.
- **Q1–Q8:** đã đóng trong §10 kèm căn cứ ADR. Các điểm còn mở được giao cho ticket cụ thể, chủ yếu T-011 và Phase 5.

## Mâu thuẫn phát hiện ngoài phạm vi (Tech Lead xử lý)
- `docs/design/frontend.md:431` vẫn ghi `io(env.NEXT_PUBLIC_WS_URL, …)`. Dòng này trái với §3.6 của chính file đó và ADR-074; nên đổi thành `getRuntimeConfig().wsUrl` (thuộc Engineer E).
- `DECISIONS.md` ADR-030 vẫn ghi "(bcrypt cost 12)". Sau ADR-065 nên sửa thành argon2id.
- `stack-versions.md` §10 (khung monorepo) vẫn ghi `redis:8.10.2` trong compose. ADR-063 đã chọn Valkey; T-011 sẽ làm theo ADR.

## Còn mở (giao cho ticket, không cần người dùng quyết)
| Điểm | Phụ trách |
|---|---|
| `pnpm fetch`/`deploy` ở pnpm 11 | T-011 |
| Trình quản lý git hook + cách cài gitleaks trên Windows | T-011 |
| Cú pháp `migrate diff` 7.10 | T-011 |
| Prisma có bọc migration trong transaction không | T-011 / Phase 2 |
| Cấu trúc standalone Next 16.4 | T-011 |
| Tag pin của mailpit và Trivy | T-011 |
| Option `max` của PrismaPg | T-008 / T-011 |
| `io.local.disconnectSockets` | Phase 3 |
| Thư viện scheduler | Phase 2 |
| CA tự ký cho Playwright | Phase 4 |
| PoC hosting, client đo fan-out realtime | Phase 5 |
