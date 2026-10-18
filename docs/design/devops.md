# Thiết kế vận hành production, CI/CD & chiến lược kiểm thử (T-004 / T-004b)

**Tác giả:** Engineer D (`taskflow-enterprise-a5`) · **Phase:** 0 · **Trạng thái:** ✅ Đã duyệt (ADR-074). Bản T-004b ngày 2026-10-15 đồng bộ theo ADR-060 → ADR-074.
**Căn cứ:** `DECISIONS.md` (ADR-000, 001, 003, 004, 012, 024–030, 047, 060–065, 070–074, 084, 090), `docs/design/security.md` (T-002), `docs/design/data-and-api.md` (T-003), `docs/research/stack-versions.md` (T-001).

> Quy ước:
>
> - "phải/không được" = bắt buộc khi làm Phase 1+.
> - Số phiên bản lấy từ `docs/research/stack-versions.md` và ADR-060. Đổi phiên bản thì sửa ở đó trước, rồi mới sửa ở đây.
> - `⚠ KIỂM CHỨNG <ticket/phase>` = điểm còn mở, ghi rõ ticket hoặc phase nào phải đóng nó.
> - Giá lấy ngày **2026-10-15**, chưa gồm VAT. Phải kiểm tra lại khi chọn hosting trước Phase 5 (ADR-070).

### Phiên bản đã chốt dùng trong tài liệu này

| Thành phần                       | Phiên bản                                                                 | Nguồn                                         |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| Node.js (image runtime)          | `node:24.22.0-bookworm-slim`                                              | ADR-060, stack-versions §6                    |
| pnpm                             | `11.28.2` qua `"packageManager"` + corepack                               | ADR-060                                       |
| Prisma CLI + client + adapter-pg | `7.10.0` exact, **chỉ gọi bằng `pnpm exec prisma`**                       | ADR-060, ADR-061                              |
| PostgreSQL                       | `postgres:18.6-bookworm` (volume `/var/lib/postgresql`)                   | ADR-060, stack-versions §6                    |
| Valkey                           | `valkey/valkey:9.1.2` (đã thấy tag trên Docker Hub 2026-10-15)            | ADR-063                                       |
| Client Valkey                    | `redis` (node-redis) `6.3.0`                                              | ADR-060, ADR-063                              |
| Socket.io / redis-adapter        | `4.8.4` / `@socket.io/redis-adapter 8.3.0`                                | stack-versions §2                             |
| Băm mật khẩu                     | `@node-rs/argon2 2.2.2`, argon2id m=47104 t=1 p=1                         | ADR-065                                       |
| Vitest / coverage-v8 / vite      | `5.0.4` / `5.0.4` / `8.3.4`                                               | stack-versions §4                             |
| Playwright                       | `@playwright/test 1.64.1`, image `mcr.microsoft.com/playwright:v1.64.1-*` | stack-versions §4                             |
| k6                               | `grafana/k6:2.3.0` (binary/Docker, không cài từ npm)                      | stack-versions §4                             |
| Build API                        | `tsdown 0.23.1` (bundle, inline `@taskflow/contracts`)                    | stack-versions §5                             |
| gitleaks                         | `v8.30.1` (release mới nhất trên GitHub ngày 2026-10-15)                  | https://github.com/gitleaks/gitleaks/releases |

---

## Mục lục

0. Hiện trạng theo quyết định của người dùng
1. Phương án hosting (so sánh + đề xuất)
2. Môi trường, biến môi trường, secret
3. Docker production & docker-compose local
4. Vận hành database (migrate, migration an toàn, backup/restore, pooling)
5. CI/CD (GitHub Actions)
6. Observability
7. Scale ngang, realtime, graceful shutdown, job định kỳ
8. Chiến lược kiểm thử tổng thể
9. Checklist go-live
10. Câu hỏi mở đã đóng · Nguồn

---

## 0. Hiện trạng theo quyết định của người dùng

| ADR     | Nội dung                                                                                                                                                              | Hệ quả cho tài liệu này                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ADR-070 | **Làm local trước** bằng Docker Compose. Chọn hosting trước Phase 5; ứng viên mặc định là DigitalOcean managed (Singapore). Code không được gắn chặt vào nhà cung cấp | Phase 1–4 chỉ cần §2 (phần local), §3, §5.1 (CI), §8. Staging/production, deploy (§5.2–5.3) và go-live (§9) làm ở Phase 5        |
| ADR-071 | Chưa có domain; chỉ cần trước khi deploy staging                                                                                                                      | Mọi chỗ ghi `<domain>` để trống tới Phase 5                                                                                      |
| ADR-072 | **Repo GitHub public**                                                                                                                                                | gitleaks bắt buộc trong CI **và** pre-commit; branch protection và required reviewers cho environment `production` dùng miễn phí |
| ADR-073 | Giám sát dùng gói miễn phí (Sentry free + uptime monitor free); cảnh báo qua **email**                                                                                | §6                                                                                                                               |
| ADR-074 | Duyệt 8 quyết định của T-004                                                                                                                                          | Đã ghi thành quy định trong các mục tương ứng                                                                                    |

**Không gắn chặt nhà cung cấp, cụ thể là:**

- App chỉ biết `DATABASE_URL`, `REDIS_URL` và các env ở §2, không dùng SDK của nhà cung cấp.
- Image Docker chuẩn OCI.
- Lệnh vận hành (migrate, seed, backup) là container hoặc script chạy được ở mọi nơi.
- Phần riêng của từng nền tảng (app spec, lệnh deploy) chỉ nằm trong workflow deploy ở Phase 5.

---

## 1. Phương án hosting

> Trạng thái: **chưa chọn** (ADR-070). Mục này giữ lại làm tài liệu so sánh cho quyết định trước Phase 5.

### 1.1 Cấu hình cần chạy (giai đoạn đầu)

| Thành phần                    | Production                            | Ghi chú                                                                                                                           |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `api` (Express 5 + Socket.io) | 1 instance, ≥ 1 vCPU, **≥ 1 GiB RAM** | argon2id m=47104 tốn ~46 MiB mỗi lần băm. 4 lần băm song song (threadpool libuv mặc định là 4) ≈ 184 MiB đỉnh (stack-versions §9) |
| `web` (Next.js standalone)    | 1 instance, 0.5–1 GiB RAM             | Render động phục vụ CSP nonce (ADR-084); tải nhẹ                                                                                  |
| PostgreSQL 18                 | 1 node, cần **PITR**                  | Dữ liệu thật — tài sản quan trọng nhất                                                                                            |
| Valkey                        | 1 node, không cần persistence         | Cache `tv`, `sid-revoked`, rate-limit, Socket.io adapter. Mất dữ liệu vẫn chạy đúng nhờ fallback DB (T-002 §2.4)                  |
| Staging                       | bản thu nhỏ của production            | Deploy thử, E2E, k6                                                                                                               |

**Region:** Singapore (ứng viên mặc định, ADR-070). Đặt ở EU sẽ cộng ~150–200ms RTT vào mỗi request.

### 1.2 So sánh 3 phương án

| Tiêu chí                          | **A. 1 VPS + Docker Compose + Caddy**                                                                                                                                      | **B. PaaS (Render)**                                                                                                                                             | **C. Cloud managed (DigitalOcean: App Platform + Managed PostgreSQL + Managed Valkey)** — ứng viên mặc định            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Thành phần                        | 1 máy chạy tất cả: Caddy, api, web, postgres, valkey                                                                                                                       | Web service ×2, Postgres, Key Value                                                                                                                              | 2 component App Platform, 1 cluster PG, 1 cluster Valkey                                                               |
| **Chi phí prod/tháng (ước tính)** | **≈ $36** (DO Droplet SGP 2 vCPU/4 GiB $24 + daily backup 30% = $7.2 + object storage cho backup ~$5 ⚠) · hoặc **≈ €10–15** ở Hetzner EU (CX33 €8.49 + backup + storage ⚠) | **≈ $60–90**: api Standard ~$25, web Starter ~$7, Postgres Basic-1gb ~$19 + ổ $0.30/GB, Key Value Starter ~$10, phí workspace $0–25 ⚠ (nguồn thứ cấp, mâu thuẫn) | **≈ $55–70**: api `apps-s-1vcpu-2gb` $25 (hoặc 1gb $12), web `apps-s-1vcpu-1gb` $12, PG 1 GiB $15.15, Valkey 1 GiB $15 |
| Chi phí staging                   | +$12 (droplet 2 GiB chạy compose)                                                                                                                                          | +$30–40                                                                                                                                                          | +$12 nếu staging là droplet compose (khuyến nghị), +$45 nếu clone đủ managed                                           |
| Độ khó vận hành                   | **Cao**: tự vá OS, firewall, SSH, tự làm PITR (WAL-G/pgBackRest), tự giám sát ổ đĩa, 1 máy = 1 điểm chết                                                                   | Thấp                                                                                                                                                             | Thấp–trung bình: không vá OS, không tự làm backup DB; vẫn tự lo CI/CD, giám sát app                                    |
| WebSocket                         | Có (Caddy proxy WS mặc định)                                                                                                                                               | Có                                                                                                                                                               | Có ⚠ KIỂM CHỨNG Phase 5 (tài liệu limits không nhắc tới)                                                               |
| Sticky session khi 2+ instance    | Không cần (websocket-only, ADR-074)                                                                                                                                        | Không cần                                                                                                                                                        | Không cần                                                                                                              |
| Backup DB                         | **Tự làm**. Snapshot máy (Hetzner/DO) **không phải** backup DB nhất quán, không có PITR                                                                                    | PITR ở gói trả phí ⚠                                                                                                                                             | **Daily full + WAL, PITR 7 ngày** (tài liệu DO)                                                                        |
| HTTPS                             | Caddy tự cấp Let's Encrypt                                                                                                                                                 | Tự động                                                                                                                                                          | Tự động                                                                                                                |
| Region Singapore                  | DO SGP1 có; Hetzner SIN1 chỉ dòng CPX, giá chưa rõ                                                                                                                         | Có ⚠                                                                                                                                                             | Có ⚠                                                                                                                   |
| Postgres 18 / Valkey              | Tự chọn image                                                                                                                                                              | ⚠                                                                                                                                                                | ⚠ KIỂM CHỨNG Phase 5: phiên bản PG/Valkey managed đang có                                                              |
| Scale ngang                       | Phải thêm máy + LB → viết lại hạ tầng                                                                                                                                      | Kéo số instance                                                                                                                                                  | Kéo số instance                                                                                                        |
| Khóa nhà cung cấp                 | Thấp nhất                                                                                                                                                                  | Trung bình                                                                                                                                                       | Trung bình (đều là Docker image + Postgres chuẩn → dễ chuyển)                                                          |

Lưu ý về Hetzner: ngày 2026-10-15, trang Cloud ghi dòng Cost-Optimized (CX) là "Currently not available", và nút tạo CPX ghi "currently unavailable". Giá CX33 €8.49 và CPX22 €19.49 là giá cho đơn hàng từ 15/06/2026.

### 1.3 Đề xuất (đã được chọn làm ứng viên mặc định)

> **Cập nhật Mốc 6 (T-074, `avatar-chat.md` ADR-141, B HIGH-1 — TL chốt 17/10):** ảnh đại diện + tệp trò chuyện lưu trên **ổ đĩa máy chủ** (người dùng không muốn dịch vụ lưu trữ cloud trả phí). App Platform (phương án C) **không có ổ lâu dài** cho container ⇒ **ứng viên mặc định đổi sang phương án A**: 1 VPS (hoặc **máy văn phòng** luôn bật) chạy Docker Compose + Caddy, kho tệp là volume Docker `filestore:/var/lib/taskflow/files` trên ổ cục bộ (§4.6). Phương án C chỉ dùng lại được khi kho tệp chuyển sang MinIO / S3 tự host (adapter `IFileStore` mới — không đổi use case).
> - Phương án A kéo theo mọi nghĩa vụ của cột A: **WAL-G hoặc pgBackRest** (PITR) sang storage của nhà cung cấp khác, backup tệp mã hóa (§4.3), diễn tập restore hằng tháng (§4.4), tự vá OS / firewall (§9).
> - **Người dùng chốt hosting (có ổ lâu dài) — bắt buộc TRƯỚC deploy** (`security-go-live.md`). Hai lựa chọn cần người dùng so: VPS (≈ $36/tháng, §1.2 cột A) hoặc máy văn phòng (không tốn thuê; rủi ro mất điện / mất mạng / hỏng ổ cao hơn ⇒ cần UPS + ổ RAID1 hoặc backup ngoài máy mỗi ngày là tối thiểu).
> - Lý do PaaS bên dưới (PITR có sẵn, không vá OS) vẫn đúng — đó là cái giá của việc tự lưu tệp; R47.

**(Trước Mốc 6) Phương án C, region Singapore; staging chạy trên 1 droplet compose.** Lý do:
1. Dữ liệu thật mà không có DBA → cần PITR 7 ngày có sẵn.
2. Không phải vá OS.
3. Scale ngang chỉ là kéo số instance.
4. Giá công bố trên tài liệu chính thức.
5. Image chuẩn → muốn chuyển nhà cung cấp thì không phải sửa code.

**Dự phòng nếu ngân sách < $40/tháng:** Phương án A, nhưng **bắt buộc** dùng WAL-G hoặc pgBackRest đẩy dữ liệu sang storage của nhà cung cấp khác, và diễn tập restore hằng tháng.

**PoC bắt buộc trước khi trả tiền dài hạn (đầu Phase 5):**

- WebSocket qua ingress của App Platform (timeout idle; ping 25s của Socket.io có giữ được kết nối không).
- Job PRE_DEPLOY chạy migrate.
- Thời gian ân hạn trước SIGKILL.
- Giới hạn connection của gói PG 1 GiB.
- Phiên bản PostgreSQL 18 và Valkey managed đang có.

---

## 2. Môi trường, biến môi trường, secret

### 2.1 Các môi trường

|            | local (Phase 1–4)                                                                   | test (CI)                                            | staging (Phase 5)                                              | production (Phase 5)                                                |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Hạ tầng    | `docker compose` (postgres, valkey, mailpit tùy chọn); app chạy `pnpm dev` trên máy | GitHub Actions `services` + compose prodlike cho E2E | 1 droplet: compose chạy **đúng image** sẽ lên prod + Caddy     | Theo hosting chọn ở Phase 5                                         |
| Domain     | `localhost:3001` / `localhost:4000` (ADR-097)                                       | `localhost`                                          | `staging.<domain>` / `api.staging.<domain>`                    | `app.<domain>` / `api.<domain>` (ADR-029). Domain chưa có (ADR-071) |
| `NODE_ENV` | `development`                                                                       | `test`                                               | `production`                                                   | `production`                                                        |
| `APP_ENV`  | `local`                                                                             | `test`                                               | `staging`                                                      | `production`                                                        |
| Dữ liệu    | seed giả                                                                            | factory                                              | seed giả cỡ lớn (cho k6) — **không bao giờ copy dữ liệu prod** | thật                                                                |
| Deploy     | —                                                                                   | —                                                    | tự động khi merge `main`                                       | thủ công, cùng image digest đã qua staging, có required reviewers   |

Staging đặt `NODE_ENV=production` là cố ý: staging phải chạy giống prod (cookie `__Host-tf_rt` — ADR-109, `COOKIE_SECURE=true`, log JSON).

### 2.2 Biến môi trường — `apps/api`

> **Nguồn sự thật là `apps/api/src/config/env.ts`** (T-009). `apps/api/.env.example` phải khớp 1-1 — CI kiểm bằng `.github/scripts/check-env-example.mjs`. Bảng dưới là giải thích.

| Biến                         | Secret? | Bắt buộc     | Validate (Zod)                                                                                                     | Ghi chú                                                                                                                                                                                                                                                          |
| ---------------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   |         | ✔            | enum `development\|test\|production`                                                                               |                                                                                                                                                                                                                                                                  |
| `APP_ENV`                    |         | ✔            | enum `local\|test\|staging\|production`                                                                            | dùng cho log, Sentry tag, chặn seed ở prod                                                                                                                                                                                                                       |
| `PORT`                       |         |              | int, mặc định 4000                                                                                                 |                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`               | **✔**   | ✔            | url `postgresql://`                                                                                                | Container app: user `taskflow_app`. **Job migrate dùng cùng tên biến** nhưng trỏ tới user `taskflow_migrator` và luôn kết nối thẳng. Vì `prisma.config.ts` chỉ đọc `process.env.DATABASE_URL ?? ""` (ADR-061), nên **không** có biến `DIRECT_DATABASE_URL` riêng |
| `DATABASE_POOL_MAX`          |         |              | int 1–50, mặc định 10                                                                                              | §4.5                                                                                                                                                                                                                                                             |
| `VALKEY_SOCKET_TIMEOUT_MS`   |         |              | int 500–30000, mặc định 3000                                                                                       | Socket Valkey im lặng quá ngưỡng ⇒ hủy ⇒ login/register/refresh 503 (fail-closed, ADR-108). Chỉ nâng khi Valkey ở xa / mạng trễ (F5)                                                                                                                             |
| `REDIS_URL`                  | **✔**   | ✔            | url `redis://` hoặc `rediss://`; prod bắt buộc `rediss://`                                                         | Trỏ tới **Valkey** (ADR-063). Giữ tên `REDIS_URL` vì đây là giao thức RESP và là tên quen thuộc của client node-redis                                                                                                                                            |
| `JWT_ACCESS_SECRET`          | **✔**   | ✔            | chuỗi **UTF-8 ≥ 32 byte** (không phải base64); production từ chối tiền tố `change-me`/`test-only`                  | T-002 §2.1, ADR-098. `kid` **suy ra từ secret** — không có biến `JWT_ACCESS_KID`                                                                                                                                                                                 |
| `JWT_ACCESS_SECRET_PREVIOUS` | **✔**   |              | như trên, phải khác secret hiện tại                                                                                | chỉ có trong cửa sổ xoay khóa                                                                                                                                                                                                                                    |
| `CORS_ORIGINS`               |         | ✔            | danh sách origin (không path), phân cách dấu phẩy; mặc định `http://localhost:3001` (ADR-097); prod chỉ `https://` | T-002 §6.3                                                                                                                                                                                                                                                       |
| `COOKIE_SECURE`              |         | ✔            | boolean; **prod mà `false` → không khởi động**                                                                     | T-002 §2.3                                                                                                                                                                                                                                                       |
| `TRUST_PROXY_HOPS`           |         | ✔            | int ≥ 0; local = 0                                                                                                 | **phải đo thực tế** ở mỗi môi trường (§9)                                                                                                                                                                                                                        |
| `LOG_LEVEL`                  |         |              | enum pino, mặc định `info`                                                                                         |                                                                                                                                                                                                                                                                  |
| `SENTRY_DSN`                 | ✔ (nhẹ) | staging/prod | url                                                                                                                | DSN lộ chỉ cho phép gửi event, nhưng repo public → không commit                                                                                                                                                                                                  |
| `GIT_SHA`                    |         | ✔            | string                                                                                                             | nhúng lúc build image (build-arg). Local đặt `dev`                                                                                                                                                                                                               |
| `SOCKET_REDIS_ADAPTER`       |         |              | boolean, mặc định `false`                                                                                          | bật khi ≥ 2 instance (§7)                                                                                                                                                                                                                                        |
| `SHUTDOWN_TIMEOUT_MS`        |         |              | int, mặc định 20000                                                                                                | §7.3                                                                                                                                                                                                                                                             |
| `READINESS_DRAIN_MS`         |         |              | int, mặc định 5000                                                                                                 | §7.3 bước 2                                                                                                                                                                                                                                                      |
| `METRICS_TOKEN`              | **✔**   | prod         | ≥ 32 ký tự                                                                                                         | bảo vệ `/metrics` nếu không tách được cổng nội bộ (§6.4)                                                                                                                                                                                                         |

Thay đổi so với T-004:

- **Bỏ `BCRYPT_COST`**: ADR-065 chuyển sang argon2id. Tham số argon2 là hằng số trong code (OWASP m=47104 t=1 p=1), không đưa ra env. Lý do: cấu hình sai ở prod là lỗ hổng không ai nhìn thấy, và mỗi lần băm chỉ ~27ms nên test không cần hạ tham số.
- **Bỏ `DIRECT_DATABASE_URL`** (xem dòng `DATABASE_URL`).
- `JWT_REFRESH_SECRET` của v1.0 vẫn bỏ (T-002).

### 2.3 Biến môi trường — `apps/web` (ADR-074, ADR-084)

| Biến                 | Secret? | Lúc nào             | Ghi chú                                                                                                               |
| -------------------- | ------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `API_URL`            |         | **runtime**         | gồm cả tiền tố `/api/v1`: `https://api.<domain>/api/v1`; local `http://localhost:4000/api/v1` (khớp frontend.md §3.6) |
| `WS_URL`             |         | runtime             | origin của API, không có path: `https://api.<domain>`; local `http://localhost:4000`                                  |
| `SENTRY_DSN`         | nhẹ     | runtime             |                                                                                                                       |
| `GIT_SHA`, `APP_ENV` |         | build-arg / runtime |                                                                                                                       |

- **Cấm `NEXT_PUBLIC_*` cho URL/cấu hình môi trường.** Lý do: Next nhúng cứng các biến này lúc build, nên mỗi môi trường sẽ phải build image riêng, phá nguyên tắc 1 image cho mọi môi trường (ADR-074).
- Root layout (server component, render động — ADR-084) đọc env lúc chạy, parse bằng Zod trong `server-env.ts`, rồi truyền xuống client qua `RuntimeConfigBoot`. Chi tiết ở `docs/design/frontend.md` §3.6.
- Web **không giữ secret nào**.

### 2.4 Validate env lúc khởi động

- `apps/api/src/config/env.ts` có một Zod 4 schema, chạy `safeParse(process.env)` **trước khi** mở bất kỳ kết nối nào. Lỗi thì in danh sách **tên biến** sai (dùng `z.flattenError`, không in giá trị) rồi `process.exit(1)`.
- Ràng buộc chéo bằng `superRefine`, áp dụng khi `NODE_ENV=production`:
  - `COOKIE_SECURE=true`
  - `REDIS_URL` dạng `rediss://`
  - `CORS_ORIGINS` toàn `https://`
  - `JWT_ACCESS_SECRET` khác giá trị mẫu trong `.env.example`
  - `APP_ENV` ∈ `staging|production`
- Kết quả là object `Env` có kiểu, truyền vào composition root (ADR-016). **Code nghiệp vụ không đọc `process.env`**: ESLint `no-restricted-properties` chặn mọi chỗ ngoài `src/config/` (ADR-004). `prisma.config.ts` là ngoại lệ có chủ đích (ADR-061).
- Script seed dùng lại phần con của cùng schema.

### 2.5 Quản lý secret (repo public — ADR-072)

- `.gitignore` chặn `.env`, `.env.*` (trừ `!.env.example`), `*.pem`, `*.key`, `*.dump`, `*.sql.gz`, `backups/`. `.env.example` chỉ có tên biến và giá trị giả rõ ràng, dạng `change-me-…`.
- **3 lớp chặn rò secret:**
  1. **pre-commit:** chạy `gitleaks git --pre-commit --staged` (gitleaks v8.30.1) qua **lefthook 2.2.2** (`lefthook.yml`, cài bằng script `prepare` — T-011). Chọn lefthook thay husky + lint-staged: 1 file cấu hình, tự lọc file staged và `git add` lại file đã format. Dev cài gitleaks bằng `winget install Gitleaks.Gitleaks` (runbook `docs/runbook/local-dev.md`); thiếu binary ⇒ hook chặn commit.
  2. **CI:** job `static` chạy gitleaks trên toàn bộ commit của PR. Job **`gitleaks` riêng** tải binary chính thức v8.30.1 + **kiểm SHA256** thay `gitleaks-action` (action cần license với tài khoản tổ chức — README gitleaks). PR quét `base..head`, push `main` quét toàn bộ lịch sử. File `.gitleaks.toml` chỉ allowlist đúng các giá trị giả trong `.env.example` và fixture test.
  3. **GitHub Secret scanning + Push protection:** bật trong Settings (miễn phí cho repo public).
- Lộ secret lên repo public = coi như **đã bị lộ**: xoay ngay; xóa khỏi lịch sử chỉ là bước phụ.
- Local: mỗi dev tự copy `.env.example` → `.env`. Secret local khác hoàn toàn staging/prod.
- Staging/prod (Phase 5): lưu trong env vars dạng encrypted của nền tảng, hoặc file `.env` quyền `600` trên droplet staging. Workflow deploy ghi chúng từ **GitHub Environment secrets** (`staging`, `production`). Environment secrets không lộ cho workflow chạy từ fork PR.
- Sinh secret: `openssl rand -base64 48`. Mỗi môi trường một bộ, không dùng lại.
- **Xoay vòng:**
  - `JWT_ACCESS_SECRET`: đặt khóa mới làm hiện tại, chuyển khóa cũ sang `JWT_ACCESS_SECRET_PREVIOUS` (`kid` tự suy ra từ mỗi secret — ADR-098) → deploy → sau ≥ 15 phút (TTL access token) bỏ `_PREVIOUS`. Không rớt phiên. Làm 6 tháng một lần, hoặc ngay khi nghi lộ.
  - Mật khẩu DB/Valkey: tạo credential mới → cập nhật env → deploy → xóa credential cũ.
  - Nghi lộ phiên hàng loạt: tăng `token_version` của mọi user và thu hồi mọi refresh token (runbook, cần lệnh admin — Phase 2).
- Chỉ người dùng (chủ dự án) và Tech Lead có quyền đọc secret prod. Agent không bao giờ nhận secret prod trong prompt.

---

## 3. Docker production & docker-compose local

### 3.1 Nguyên tắc chung

- Base image `node:24.22.0-bookworm-slim`, **ghim thêm digest** (`@sha256:…`); Renovate/Dependabot cập nhật digest. Chọn slim (glibc) cho ổn định với Prisma, Playwright và module prebuilt (stack-versions §6).
- pnpm: `corepack enable` (Node 24 vẫn có corepack) + `"packageManager": "pnpm@11.28.2"`. Lưu ý pnpm 11 **chặn install script mặc định** → `allowBuilds` trong `pnpm-workspace.yaml` (T-001 §10). `@node-rs/argon2` là prebuilt nên không cần mục này.
- Gọi Prisma **chỉ** bằng `pnpm exec prisma …` trong mọi Dockerfile, script và CI (ADR-061). CI có bước grep chặn chuỗi `npx prisma` (§5.1). Image migrate gọi thẳng file CLI đã ghim (`node node_modules/prisma/build/index.js`) — cùng tinh thần.
- **`CHECKPOINT_DISABLE=1` + `PRISMA_HIDE_UPDATE_MESSAGE=1` ở mọi nơi chạy Prisma CLI** (Dockerfile stage base + migrate, env cấp workflow CI/mutation, runbook §5) — T-022. Lý do: CLI gọi mạng kiểm tra phiên bản/telemetry, có thể treo 120 s+ trên mạng chậm (QA F đo được) và production không được gửi dữ liệu ra ngoài.
- Build cache: `pnpm fetch` theo `pnpm-lock.yaml`. Đã kiểm ở T-011 (pnpm 11.28.2): `pnpm fetch` → `pnpm install --offline --frozen-lockfile` chạy được; `pnpm deploy --prod` **không cần** `--legacy`. Không dùng cache mount BuildKit: cache `type=gha` của CI chỉ giữ **layer**, không giữ cache mount ⇒ store đặt trong layer `deps` (chỉ đổi khi lockfile đổi) thì CI tái dùng được. T-022: `pnpm deploy` thêm `--offline` (trước đó tự tải lại từ registry, ~11 phút trên máy dev).
- Runtime chạy bằng user `node` (uid 1000). Không có compiler, pnpm, source TS — và **không có trình quản lý gói** đi kèm image node (npm, npx, corepack, yarn 1 bị gỡ ở stage runtime; CMD + healthcheck chỉ gọi `node`). Smoke api/web kiểm việc này. Lý do: bớt bề mặt tấn công; Trivy từng báo HIGH ở gói con của npm (brace-expansion, undici — CI main a9a1516).
- **Ngoại lệ tái lập có chủ đích — `perl-base`** (CI main a9a1516): digest node mới nhất (2026-10-14) mang `perl-base 5.36.0-7+deb12u3` có CVE CRITICAL/HIGH đã vá ở `deb12u4`; `perl-base` là gói Essential của Debian nên không gỡ được. Stage runtime api/web chạy `apt-get install --only-upgrade perl-base` từ kho security, **không ghim phiên bản** (Debian chỉ giữ bản vá mới nhất). Phạm vi: đúng một gói. **Điều kiện gỡ**: Dependabot bump digest node mang `perl-base ≥ 5.36.0-7+deb12u4` ⇒ xóa lớp này (comment `TẠM` trong cả hai Dockerfile). Không áp dụng `apt-get upgrade` toàn bộ.
- `CMD ["node", "dist/main.js"]` dạng exec; **không** `pnpm start`. Compose đặt `init: true` để reap tiến trình con và chuyển tín hiệu.
- `ENV NODE_ENV=production`; `ARG GIT_SHA` → `ENV GIT_SHA`; thêm label OCI `revision` và `source`.
- `.dockerignore`: `node_modules`, `.next`, `dist`, `.env*`, `.git`, `coverage`, `playwright-report`, `src/generated`.
- `HEALTHCHECK` dùng `node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"` (slim không có curl). Nền tảng managed dùng health check riêng → cấu hình cả hai.
- Image được Trivy quét trong CI (§5.1).

### 3.2 `apps/api/Dockerfile`

```
stage base          : node:24.22.0-bookworm-slim@digest · corepack pnpm 11.28.2 · CHECKPOINT_DISABLE=1 · PRISMA_HIDE_UPDATE_MESSAGE=1
stage deps          : FROM base → copy lockfile + pnpm-workspace.yaml → pnpm fetch (store nằm trong layer, đổi khi lockfile đổi)
stage install       : FROM deps → copy source → pnpm install --offline --frozen-lockfile
stage migrate-files : FROM install → node docker/migrate/collect-prisma.mjs apps/api /migrate
                        (Prisma CLI + phụ thuộc theo lockfile, bỏ studio/dev/pglite + peer optional; prisma/ + prisma.config.ts)
stage build         : FROM install → pnpm --filter @taskflow/api build   (= prisma generate --no-hints && tsdown)
                        → pnpm deploy --filter @taskflow/api --prod --prefer-offline /out
stage migrate       : FROM node slim → COPY --from=migrate-files /migrate · USER node
                        → CMD ["node","node_modules/prisma/build/index.js","migrate","deploy"]   (CLI 7.10.0 ghim; KHÔNG npx — ADR-061)
stage runtime       : FROM node slim → COPY --from=build /out (node_modules prod) + dist · USER node · HEALTHCHECK · CMD ["node","dist/main.js"]
```

- Hai target build từ cùng commit trong `apps/api/Dockerfile`: `runtime` (image `taskflow-api`) và `migrate` (image `taskflow-api-migrate`). Cả hai cùng tag `sha-<GIT_SHA>` (G2 O3: tên target thật là `runtime`/`migrate`, không phải `api`/`api-migrate`).
- Image runtime **không chứa** prisma CLI, devDependencies, test, `.env`.
- Image migrate **chỉ chứa** Prisma CLI + migrations (không pnpm, không source app) — số đo trước/sau ở `docs/reviews/T-022-report.md`.
- **Kiểm chứng argon2 trong container (ADR-065, bắt buộc ở T-011):** CI chạy trên image runtime vừa build:
  ```
  docker run --rm taskflow-api:<sha> node -e "import('@node-rs/argon2').then(async a=>{const h=await a.hash('x'.repeat(20),{algorithm:2,memoryCost:47104,timeCost:1,parallelism:1});if(!h.startsWith('\$argon2id\$')||!(await a.verify(h,'x'.repeat(20))))process.exit(1)})"
  ```
  Kiểm cả hai kiến trúc nếu build multi-arch (amd64 bắt buộc; arm64 khi dev dùng Apple Silicon). Lệnh này cũng chứng minh `pnpm deploy` đã kéo đúng gói `@node-rs/argon2-linux-x64-gnu`. Bản hiện thực: script `docker/verify-argon2.mjs` (dùng enum `Algorithm.Argon2id`) chạy qua stdin trong image — CI job `build` và `pnpm docker:verify-argon2`.

### 3.3 `apps/web/Dockerfile`

- `next.config.ts`: `output: 'standalone'` + `outputFileTracingRoot` trỏ về gốc monorepo. Không cần `transpilePackages`, vì Turbopack tự transpile workspace package (stack-versions §3).
- Stage build: `pnpm --filter @taskflow/web build`. **Không** truyền URL qua build-arg (§2.3).
- Stage runtime:
  - copy `apps/web/.next/standalone/` → `/app`
  - **copy thêm** `apps/web/.next/static` → `/app/apps/web/.next/static`, và `apps/web/public` → `/app/apps/web/public`
  - `ENV HOSTNAME=0.0.0.0 PORT=3000`, `USER node`, `CMD ["node","apps/web/server.js"]`
- Healthcheck: Route Handler `/api/healthz` trả 200, không gọi API.
- Đã kiểm (Next 16.4.1, T-011): `server.js` nằm ở `.next/standalone/apps/web/server.js`; image chạy `node apps/web/server.js`.

### 3.4 `docker-compose.yml` cho local dev

| Service         | Image                                | Ghi chú                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres`      | `postgres:18.6-bookworm`             | cổng host 5435 (ADR-097); volume `pgdata:/var/lib/postgresql` (**PG18 đổi đường dẫn**; mount `/var/lib/postgresql/data` kiểu ≤17 sẽ mất dữ liệu khi tạo lại container); healthcheck `pg_isready`; `POSTGRES_DB=taskflow`; init script tạo role `taskflow_app` + `taskflow_migrator` (§4.1) |
| `postgres-test` | cùng image                           | cổng host 5434; `tmpfs: /var/lib/postgresql`; `-c fsync=off -c synchronous_commit=off -c full_page_writes=off` (chỉ dùng cho test)                                                                                                                                                         |
| `valkey`        | `valkey/valkey:9.1.2`                | cổng host 6380; không persistence (`--save "" --appendonly no`); `--maxmemory-policy noeviction` (§7.1)                                                                                                                                                                                    |
| `mailpit`       | `axllent/mailpit:v1.31.5` (+ digest) | **profile `mail`**, tắt mặc định. Xác minh email nằm sau v1 (ADR-049)                                                                                                                                                                                                                      |

- Dùng image Debian thay alpine cho Postgres để collation theo glibc giống bản managed. Điều này ảnh hưởng `ORDER BY` trên các cột text không phải `rank`.
- App (api/web) chạy trên máy bằng `pnpm dev` để hot reload; compose chỉ lo hạ tầng.
- `docker-compose.prodlike.yml`: chạy **image đã build** của api, web, migrate và Caddy. Dùng cho E2E trong CI, và sẽ là file deploy staging ở Phase 5.
- Lệnh chuẩn: `pnpm infra:up` / `pnpm infra:down` ở `package.json` gốc; migrate/seed nằm ở package api: `pnpm --filter @taskflow/api db:deploy`, `pnpm --filter @taskflow/api db:seed` (G2 O1: gốc **không** có `db:deploy`).

---

## 4. Vận hành database

### 4.1 Khi nào chạy `prisma migrate deploy` (ADR-074)

- **Không bao giờ chạy trong app start.** Lý do: nhiều instance sẽ tranh lock; migrate lỗi làm app crash-loop; và app sẽ có quyền DDL thừa.
- Chạy như **job riêng trước rollout**, dùng image `taskflow-api-migrate` (target `migrate`) cùng `GIT_SHA`, lệnh mặc định của image `node migrate.mjs` = `prisma migrate deploy` **+** `docker/migrate/grant-app.sql` (G2 O2: không gọi `prisma migrate deploy` trần — thiếu grant cho `taskflow_app`):
  - Local: `pnpm --filter @taskflow/api db:deploy` (= migrate deploy + grant-app.sql; hoặc `pnpm --filter @taskflow/api exec prisma migrate dev` khi phát triển schema).
  - CI: chạy vào DB template trước test integration (§8.3).
  - Staging: `docker compose run --rm migrate` trước `docker compose up -d api web`.
  - Prod: PRE_DEPLOY job của nền tảng nếu có (⚠ KIỂM CHỨNG Phase 5); nếu không thì workflow chạy container migrate **trước** bước cập nhật app.
- **Tách 2 user DB (ADR-074):**
  - `taskflow_migrator`: owner của schema, có DDL. Chỉ job migrate dùng, qua `DATABASE_URL` riêng của job, luôn kết nối thẳng (không qua pooler).
  - `taskflow_app`: chỉ `SELECT/INSERT/UPDATE/DELETE` trên bảng và `USAGE` trên sequence. Cấp bằng `ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public GRANT …` để bảng mới tự có quyền. Bước này nằm trong migration đầu tiên hoặc script init role.
  - Local compose cũng tách đúng như vậy, để lỗi thiếu quyền lộ ra ngay ở máy dev.
- **Grant sau mỗi lần migrate (T-027 bổ sung):** `ALTER DEFAULT PRIVILEGES … IN SCHEMA public` lưu theo từng database và gắn với schema ⇒ DB tạo sau init, DB managed ở production, schema bị dựng lại đều thiếu quyền cho app. Vì vậy job migrate (image `migrate`: `docker/migrate/migrate.mjs`) và `pnpm --filter @taskflow/api db:deploy` luôn chạy `prisma migrate deploy` **rồi** `prisma db execute --file docker/migrate/grant-app.sql` (idempotent: GRANT DML trên mọi bảng/sequence + default privileges + REVOKE CREATE; lỗi rõ ràng nếu role `taskflow_app` chưa tồn tại). CI kiểm trên DB mới tinh (`docker/migrate/verify-grants.sh`): app đọc/ghi được, CREATE/DROP/ALTER/TRUNCATE bị từ chối — cả qua `db:deploy` lẫn image migrate. **Cấm chạy app bằng migrator.** Harness bảo mật (F) tự grant cùng nội dung — đề xuất gọi chung file này.
- Migration đã apply **không được sửa**. Muốn sửa thì viết migration mới.

### 4.2 Quy tắc migration an toàn (expand/contract)

Nguyên tắc: **code phiên bản N và N+1 phải cùng chạy được trên schema sau migration.** Nhờ vậy rolling deploy chạy được, và rollback app không cần rollback DB.

| Thay đổi                   | Cách làm đúng                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thêm cột                   | Nullable, hoặc có `DEFAULT` hằng (PG 11+ không rewrite bảng). Nếu cần NOT NULL không default: thêm nullable → backfill theo lô → ở release sau thêm `CHECK … NOT VALID`, `VALIDATE`, rồi `SET NOT NULL`                |
| Đổi tên cột/bảng           | **Cấm đổi tên trực tiếp.** Thêm cột mới, ghi cả hai → backfill → chuyển sang đọc cột mới → bỏ cột cũ ở release sau nữa                                                                                                 |
| Xóa cột                    | Release 1: code ngừng dùng (bỏ field khỏi Prisma schema). Release 2: migration `DROP COLUMN`                                                                                                                           |
| Tạo index trên bảng lớn    | `CREATE INDEX CONCURRENTLY` trong migration **riêng**, chỉ chứa đúng lệnh đó. ⚠ KIỂM CHỨNG Phase 2 (T-010): Prisma 7.10 có bọc file migration trong transaction không. Nếu có thì phải chạy ngoài Prisma               |
| Thêm FK                    | `ADD CONSTRAINT … NOT VALID` rồi `VALIDATE CONSTRAINT` ở migration sau                                                                                                                                                 |
| Đổi kiểu cột               | Làm như đổi tên (cột mới + backfill)                                                                                                                                                                                   |
| Enum Postgres              | Thêm giá trị: an toàn. Bỏ giá trị: expand/contract                                                                                                                                                                     |
| Partial unique index       | Khai báo native bằng `@@unique(..., where: raw(...))` (preview `partialIndexes`, ADR-062)                                                                                                                              |
| Collation `"C"` của `rank` | SQL tay trong migration (`migrate dev --create-only`), có comment lý do. Prisma không theo dõi collation → **integration test bắt buộc** khẳng định cột `rank` có collation `"C"` và `ORDER BY rank` khớp so sánh byte |

- Đầu mỗi file migration viết tay: `SET lock_timeout = '5s'; SET statement_timeout = '15min';`. Mục đích: không xếp hàng chờ lock làm treo cả app; lỗi thì chạy lại sau.
- Backfill dữ liệu lớn **không** nằm trong migration. Viết script riêng, chạy theo lô 1–5k dòng.
- PR có migration gắn label `db-migration`, cần thêm approve của D. Checklist review:
  - Migration khóa bảng nào?
  - Với 1 triệu dòng thì chạy bao lâu?
  - Code cũ có chạy được trên schema mới không?
  - Rollback app có chạy được không?
- CI kiểm tra (ADR-062): `pnpm exec prisma migrate diff --from-migrations … --to-schema … --exit-code` phải rỗng (quên tạo migration thì đỏ), và migrate từ DB rỗng lên head phải thành công. Prisma 7 đã **bỏ** `--shadow-database-url`; CI (T-011) chạy `migrate deploy` rồi `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (DB sau migrate phải khớp schema).

### 4.3 Backup (áp dụng khi lên staging/prod — Phase 5)
| Lớp | Phương án C (ứng viên) | Phương án A (dự phòng) |
|---|---|---|
| PITR | Có sẵn: daily full + WAL, khôi phục mọi thời điểm trong **7 ngày** | WAL-G/pgBackRest đẩy WAL liên tục + base backup hằng ngày sang object storage **khác nhà cung cấp** |
| Logical backup độc lập (ADR-074) | Job hằng ngày chạy `pg_dump -Fc` (client **18.x** khớp server) → object storage **ngoài nhà cung cấp hosting**, mã hóa phía client (age/gpg), bucket bật versioning/object lock | như cột trái |
| Thời gian giữ | PITR 7 ngày; logical: 14 bản hằng ngày + 8 bản hằng tuần + 12 bản hằng tháng | như vậy |
| Valkey | Không backup (dữ liệu dựng lại được) | như vậy |
| **Kho tệp (Mốc 6, ADR-141)** | — (C không có ổ lâu dài, xem §1.3) | **Hằng ngày, MÃ HÓA phía máy chủ trước khi rời máy**: `restic` (repo mã hóa sẵn) hoặc `tar \| age` theo runbook `backup-restore.md`. **Khóa giải mã KHÔNG nằm trên máy chủ** (két mật khẩu của Admin + bản giấy). Đích tách khỏi máy chủ: ổ / máy khác hoặc cùng kho backup ngoài nhà cung cấp của DB. Giữ theo cùng tầng với logical backup DB (14 / 8 / 12) — R48: dữ liệu đã xóa còn trong backup tới hết tầng giữ |

**Mục tiêu:** RPO ≤ 5 phút (PITR), ≤ 24h nếu mất cả tài khoản hosting; RTO ≤ 2 giờ. **Kho tệp:** RPO ≤ 24h (backup hằng ngày — hỏng ổ ⇒ mất tệp từ lần backup cuối, R47).

Repo public → file backup, dump và dữ liệu thật **không bao giờ** nằm trong repo hay artifact CI (ADR-072). Đã chặn trong `.gitignore` và gitleaks.

### 4.4 Diễn tập restore (backup chưa từng restore thì coi như chưa có backup)

- Làm **hằng tháng**, và bắt buộc trước go-live, theo runbook `docs/runbooks/restore.md` (Phase 5):
  1. PITR: tạo cluster mới từ thời điểm T−1h. Đo thời gian.
  2. Logical: tải bản dump mới nhất, giải mã, `pg_restore` vào Postgres 18 tạm.
  3. Kiểm tra:
     - `pnpm exec prisma migrate status` báo up to date
     - số dòng các bảng chính khớp
     - smoke query (đăng nhập user canary, đọc board)
     - collation `"C"` và partial unique index còn nguyên
     - role `taskflow_app`/`taskflow_migrator` và quyền còn đúng
  4. Ghi kết quả vào `docs/ops/restore-drills.md`, rồi xóa cluster tạm.
- **Kho tệp (Mốc 6):** cùng buổi diễn tập, khôi phục **DB trước, tệp sau** vào thư mục tạm; kiểm (a) mẫu ngẫu nhiên ≥ 20 khóa trong DB mở được qua `/media` (thiếu tệp ⇒ 404 + log `media.blob_missing`, F-09 — không 500); (b) tệp thừa không có dòng DB bị `files-sweep` dọn; (c) giải mã bằng khóa lấy từ két (chứng minh khóa không chỉ nằm trên máy chủ). Ghi vào `docs/ops/restore-drills.md`.
- Sau mỗi lần dump, job tự chạy `pg_restore --list` để chắc file không hỏng. Job lỗi, hoặc không chạy quá 26h → gửi email cảnh báo (§6.5).
- Trước Phase 5 vẫn diễn tập được ở local: dump từ compose → restore vào `postgres-test`. Nên làm 1 lần ở Phase 3, khi đã có schema thật.

### 4.5 Connection pooling

- Prisma 7 dùng driver adapter `@prisma/adapter-pg` (bên dưới là `pg.Pool`), tạo ở composition root (stack-versions §8.1).
- `pg` **không có connection timeout mặc định** → bắt buộc đặt `connectionTimeoutMillis: 5000`, kèm `max: DATABASE_POOL_MAX` và `idleTimeoutMillis`. ⚠ KIỂM CHỨNG T-008/T-011: tên option `max` truyền qua `PrismaPg` (theo kiểu `PoolConfig` của `pg`).
- Ngân sách kết nối: `số instance × DATABASE_POOL_MAX + 2 (migrate) + 3 (admin/backup) ≤ giới hạn kết nối của gói PG`.
- Giai đoạn 1–2 instance: **kết nối thẳng**, không dùng pooler.
- Khi vượt ngân sách: bật PgBouncer ở chế độ transaction cho container app; job migrate vẫn kết nối thẳng. ⚠ Trước khi bật phải kiểm interactive transaction và UoW dùng `AsyncLocalStorage` (ADR-012) chạy đúng qua pooler.
- `ALTER ROLE taskflow_app SET statement_timeout = '10s'` để chặn query chạy quá lâu giữ connection.
- **Export dài (ADR-130, T-055y `IReadSnapshot`):** mỗi export .xlsx giữ **2 kết nối** trong lúc xuất — một cho transaction
  REPEATABLE READ READ ONLY (≤ 120 s, đọc theo lô; mỗi câu vẫn chịu `statement_timeout` 10 s) và một, ngắn, cho audit
  EXPORT (`snapshot.outside`). Tối đa 2 export đồng thời/công ty (`ExportSlots`, SEC-HR-54) ⇒ **≤ 4 kết nối**, còn
  ≥ 6 / 10 (`DATABASE_POOL_MAX` mặc định) cho request thường. Tăng số export đồng thời thì phải tăng `DATABASE_POOL_MAX`
  tương ứng (và ngân sách ở dòng trên).
- Khi nào tăng N / bật PgBouncer / nâng gói, cách đo giới hạn kết nối thật của cụm: `docs/runbook/scaling.md` §1, §4.

### 4.6 Kho tệp trên ổ cục bộ (Mốc 6 — ADR-141, T-067; B review T-074)
- **Volume:** `filestore:/var/lib/taskflow/files`, chủ `node`, **ngoài** thư mục app / web root (`FILE_STORE_DIR` tuyệt đối — sai ⇒ API từ chối khởi động). Hệ thống tệp phải hỗ trợ **hard link** (ext4 / xfs trên Linux, NTFS trên Windows): commit tệp là `link(tmp, đích)` + `unlink(tmp)` để KHÔNG BAO GIỜ ghi đè (G, B M-a); API thử `link` lúc khởi động, không được ⇒ từ chối khởi động. **Không** dùng FAT / exFAT, ổ mạng SMB/NFS, hay bind mount của Docker Desktop cho kho production.
- **Độ bền khi mất điện:** tệp được `fsync` trước khi đặt vào chỗ, nhưng **thư mục chưa `fsync`** sau link/unlink ⇒ mất điện đúng lúc đó có thể mất tệp vừa tải lên dù DB đã ghi (mở ra ⇒ 404 + log, không 500). Chấp nhận ở v1 (một máy, upload nhỏ); máy văn phòng ⇒ **UPS**. Nâng sau: `fsync` thư mục cha sau mỗi commit.
- **Dung lượng:** trần `FILE_STORE_MAX_BYTES` (mặc định 50 GiB, người dùng) ⇒ 507 `STORAGE_FULL`; ổ phải còn ≥ trần + 20 % + chỗ cho Postgres / log / image. Mỗi upload kiểm ổ trống ≥ kích thước + 10 % trước khi ghi. Cảnh báo email khi ổ còn < 15 % (§6.5). Quota có thể vượt tối đa ≈ số upload đồng thời (12) × 20 MB vì kiểm trước khi cộng — chấp nhận.
- **Bộ nhớ của worker ảnh (sharp / libvips):** `resourceLimits` của worker chỉ giới hạn heap **V8**; bộ nhớ giải mã của libvips là **native**, không bị chặn. Trường hợp xấu: 2 worker × trần 40 MP × 4 byte ≈ **320 MB native** + bộ đệm resize, cộng heap Node của API. ⇒ container `api` đặt `mem_limit` ≥ **1,5 GiB** (đo lại bằng ảnh 40 MP trước go-live) và để `restart: unless-stopped`; VPS 4 GiB (§1.2 cột A) đủ cho api + web + Postgres + Valkey. Hạ trần pixel theo mục đích (avatar thấp hơn chat — T-068) nếu máy nhỏ hơn.
- **Một instance** (R47): đếm upload đồng thời / export đồng thời trong bộ nhớ tiến trình; lên ≥ 2 instance ⇒ volume chung hoặc MinIO tự host + chuyển các bộ đếm sang Valkey cùng lúc.
- **Secret:** `FILE_URL_SECRET` (≥ 32 byte, KHÁC JWT) ký URL `/media`; xoay bằng `FILE_URL_SECRET_PREVIOUS` (chỉ để kiểm) giữ tối thiểu bằng khung dài nhất của URL (avatar 24 giờ) rồi bỏ. Staging/production bắt buộc; `MEDIA_BASE_URL` https; `MEDIA_CORP` = `same-site` khi web + API chung eTLD+1, không thì `cross-origin` có chủ ý (smoke sau deploy kiểm ảnh hiện được từ origin web thật).
- **Log của reverse proxy:** URL `/media` mang `sig` (bearer — R43) ⇒ Caddy KHÔNG ghi query của đường `/api/v1/media/*` (format log bỏ `uri` query hoặc filter riêng); API đã chỉ ghi path.

---

## 5. CI/CD (GitHub Actions)

### 5.1 Workflow `ci.yml` — mọi PR và push `main` (T-011, bổ sung T-022)

```
gitleaks · actionlint
static ──── build       (pnpm build; docker build runtime/migrate/web không push; argon2 + smoke api/web; trivy)
              └── e2e   (từ Phase 4: compose prodlike + Playwright)
unit        (pnpm test + coverage api có ngưỡng)
integration (postgres:18.6 + valkey:9.1.2 services; migrate template + drift; test:integration trên DB taskflow_it)
security    (cùng services; migrate template; test:security — suite đen SEC-xx của F, chặn merge)
```

Workflow riêng `mutation.yml` (T-022): Stryker **hằng tuần** (thứ Hai 02:00 UTC) + chạy tay, ma trận theo các script `mutation:<nhóm>` của apps/api, upload báo cáo JSON/HTML, **không chặn PR**.

- **Chung:**
  - Các bước: `actions/checkout` → `pnpm/action-setup` (đọc `packageManager` → pnpm 11.28.2) → `actions/setup-node` với `node-version-file: .nvmrc` (24.22.0) và `cache: 'pnpm'` → `pnpm install --frozen-lockfile`.
  - Mọi action **ghim theo commit SHA**.
  - `permissions: contents: read` mặc định.
  - `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true` cho PR.
- **Repo public — an toàn với PR từ fork (ADR-072):**
  - CI chạy bằng `pull_request` (không bao giờ `pull_request_target` khi có checkout code PR).
  - Workflow PR không có secret.
  - Bật "Require approval for first-time contributors" ở Settings → Actions.
- **static:**
  - `pnpm typecheck`
  - `pnpm lint` (ESLint 10 + dependency-cruiser — ADR-004, ADR-064, ADR-093)
  - `prettier --check`
  - **gitleaks** quét các commit của PR (`fetch-depth: 0`); push `main` quét toàn bộ lịch sử
  - `pnpm --filter @taskflow/api exec prisma validate` + `migrate diff` rỗng (ADR-062)
  - **grep cấm `npx prisma`** trong toàn repo (ADR-061)
  - test parity contracts ↔ domain chạy ở job unit (ADR-043, ADR-080)
- **unit:** `vitest run --project unit --coverage`. Dưới ngưỡng ở §8.2 → đỏ. Upload báo cáo coverage làm artifact.
- **integration:**
  - `services`: postgres `18.6-bookworm` (healthcheck `pg_isready`) + valkey `9.1.2`. Lưu ý: `services` không truyền được `command`, nên khi cần tham số Valkey thì khởi động bằng `docker run` trong step.
  - Script init role (tạo thêm DB `taskflow_it`) → migrate `taskflow_template` + drift → `test:integration` với `DATABASE_URL_TEST` trỏ **`taskflow_it`** (harness xóa + dựng lại schema public; không được đụng template).
  - Timeout job 20 phút.
- **security (T-022):** cùng services; `pnpm --filter @taskflow/api test:security` với biến `SEC_*` (migrator, app = `taskflow_app`, DB `taskflow_sec` do harness tự tạo + migrate — ADR-106, Valkey db 15, `SEC_API_READY_TIMEOUT_MS=180000`). Mỗi file test spawn `src/main.ts` thật.
- **build:**
  - `pnpm build`
  - `docker buildx build` cả 3 target, cache `type=gha`, **không push** trên PR
  - **smoke argon2 trong image** (§3.2)
  - `trivy image --severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed` (T-011 ghim `aquasec/trivy:0.75.0` + digest — bỏ qua 0.76.0 vì mới phát hành < 24h; quét cả `vuln,secret`)
- **e2e** (`.github/workflows/e2e.yml`, gọi từ `ci.yml` + lịch hằng đêm 19:00 UTC): **hiện dùng harness T-026** — API `src/main.ts` + web build production (standalone) trên service Postgres/Valkey, DB `taskflow_e2e`, Valkey db 14. **PR: chỉ Chromium; push `main` + nightly: Chromium + Firefox + mobile** (Pixel 7, luồng `@main`) — project chỉ định tường minh, không dựa vào `CI=true`. Upload report/trace/video khi lỗi. **Mục tiêu sau khi chốt hosting (ADR-070):** chạy trên `docker-compose.prodlike.yml` từ image vừa build (Caddy TLS nội bộ — cookie `__Host-`), Playwright trong image `mcr.microsoft.com/playwright:v1.64.1-*`; WebKit chưa có trong config.
- **`pnpm audit --prod --audit-level high` chạy trong job `static` và chặn merge** (Tech Lead, bổ sung T-011). Ngoại lệ chỉ qua `auditConfig.ignoreGhsas` trong `pnpm-workspace.yaml`, mỗi mục ghi lý do + ngày xét lại.
- **Nightly:** E2E 3 trình duyệt, test 2 instance (§7.2).
- **Dependabot:** cho npm, Docker digest, GitHub Actions. Lưu ý `minimumReleaseAge: 1440` của pnpm 11 (T-001) làm bản vừa publish chưa cài được ngay — đây là cố ý, để chống tấn công supply-chain.

**Điều kiện chặn merge** (branch protection/ruleset trên `main`, miễn phí với repo public — ADR-072):

- `static`, `unit`, `integration`, `build` xanh (thêm `e2e` từ Phase 4).
- ≥ 1 approve của Tech Lead.
- Branch cập nhật với `main`.
- Không push thẳng `main`, không force-push, không xóa nhánh.
- PR có label `db-migration` cần thêm approve của D.

### 5.2 Workflow `release.yml` — sau CI xanh trên `main` (D3, đã viết, TẮT mặc định)

- Trigger `workflow_run` của CI (conclusion = success, branch main) + chạy tay. **Chỉ chạy khi biến repo `ENABLE_RELEASE=true`** — chưa chọn hosting thì không đẩy gì lên registry (ADR-070).
- Build + push `ghcr.io/<owner>/taskflow-{api,api-migrate,web}:sha-<git_sha>` (GITHUB_TOKEN, `packages: write` chỉ ở job này), provenance + SBOM, cache `type=gha`. Digest ghi vào job summary + artifact `release-<sha>` (90 ngày).
- Image GHCR của repo public mặc định public — image không chứa secret (§3.1).

### 5.3 Workflow `deploy.yml` — thủ công, 2 phương án hosting (D3)

- `workflow_dispatch`: `environment` (staging | production), `target` (do-app-platform | vps), `git_sha` (40 ký tự). Environment protection: production = required reviewers (người dùng + Tech Lead) + chỉ branch `main` (miễn phí với repo public — ADR-072). `concurrency: deploy-<env>`, không hủy giữa chừng.
- Bước 1: kiểm đầu vào + biến/secret của environment — thiếu ⇒ dừng với danh sách cần cấu hình. Bước 2: lấy **digest** của tag `sha-<git_sha>` (không build lại).
- **App Platform** (`.do/app.yaml`): lấy spec đang chạy (secret đã mã hóa `EV[…]`) → yq thay digest + `GIT_SHA` → `doctl apps update --wait`; job `migrate` kind **PRE_DEPLOY** chạy trước rollout. Smoke lỗi ⇒ áp lại spec trước.
- **VPS** (`deploy/vps/`): khóa CI bị ép forced command `ci-entry.sh` (chỉ `deploy`/`rollback`, không ghi file; cấu hình do admin cài tay, CI gửi sha256 `compose.prod.yml` + `Caddyfile` — lệch ⇒ từ chối) → `deploy.sh` (ghi digest → pull → migrate job → rollout api/web → `/readyz` → smoke qua Caddy → tự rollback). Smoke từ Internet lỗi ⇒ `deploy.sh --rollback`. SSH ghim host key (`VPS_KNOWN_HOSTS`), không `StrictHostKeyChecking=no`.
- Smoke chung từ Internet: `/healthz` đúng `gitSha`, `/readyz` `"db":"ok"`, trang web, `/api/healthz`, header HSTS.
- Rollback: chạy lại workflow với `git_sha` cũ (expand/contract ⇒ không rollback DB). Hỏng dữ liệu ⇒ PITR / restore (§4.4, runbook backup-restore).
- Cách vận hành chi tiết, bootstrap từng phương án, sự cố: `docs/runbook/deploy.md`.

## 6. Observability (ADR-073: gói miễn phí, cảnh báo qua email)

### 6.1 Log

- pino 10.4.0 + pino-http 11.0.0 ghi JSON ra stdout. Trường chuẩn: `time, level, msg, requestId, userId?, workspaceId?, route, method, statusCode, durationMs, gitSha, appEnv`.
- `requestId`:
  - pino-http lấy từ `X-Request-Id` nếu là uuid hợp lệ, không thì sinh mới; trả lại trong header response.
  - Lan truyền qua `AsyncLocalStorage`.
  - Với Socket.io: mỗi log có thêm `socketId` + `userId`.
- `redact` theo đúng T-002 §6.7 (SEC-33 kiểm tra). Không dùng `pino-pretty` ở staging/prod.
- **Nơi gom log:**
  - Phase 1–4: stdout / `docker compose logs`.
  - Phase 5: log của nền tảng + một dịch vụ log có **gói miễn phí** (vd Better Stack hoặc Grafana Cloud) — chọn cùng lúc chọn hosting.
  - Mục tiêu giữ log ≥ 30 ngày, log sự kiện bảo mật ≥ 90 ngày. Nếu gói miễn phí giữ ngắn hơn → ghi nhận là rủi ro chấp nhận, kèm phương án xuất log bảo mật ra object storage.

### 6.2 Health endpoints (api) — ADR-074

| Endpoint       | Kiểm tra                                                                    | Dùng cho                                           | Trả về                                                                            |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /healthz` | Chỉ kiểm tiến trình còn sống — **không** chạm DB/Valkey                     | liveness, Docker HEALTHCHECK, uptime monitor ngoài | `200 {status:"ok"}` (không lộ gitSha — gitSha nằm trong mọi dòng log, T-031)      |
| `GET /readyz`  | `SELECT 1` (timeout 1s) + Valkey `PING` (timeout 500ms) + cờ `shuttingDown` | readiness của LB, bước chờ khi deploy              | `200 {db:"ok", valkey:"ok"\|"degraded"}`; `503` khi DB lỗi **hoặc** đang shutdown |

- **Valkey lỗi không làm `/readyz` đỏ** (ADR-074). Trong lúc đó, login/register vẫn **fail-closed** theo T-002 §6.4; các API khác dùng fallback DB.
- Hai endpoint này không qua rate limit dùng Valkey, không log ở mức info, không lộ chi tiết lỗi.
- **`/readyz` chống bị dùng để dội tải DB/Valkey** (M2 của T-028, T-031):
  - kết quả probe được **dùng chung trong 1 giây** — mọi request trong cửa sổ (kể cả đang chờ) chung một lần `SELECT 1` + `PING`; cờ `shuttingDown` luôn đọc mới;
  - hạn mức riêng **60 request/phút/IP**, đếm trong bộ nhớ của instance (readiness không phụ thuộc Valkey) ⇒ quá ngưỡng `429 {status:"rate_limited"}` + `Retry-After: 60`;
  - **khuyến nghị (D, khi chọn hosting)**: chỉ cho LB / mạng nội bộ của nền tảng gọi `/readyz` — chặn ở edge / reverse proxy với Internet công khai. `/healthz` có thể để công khai cho uptime monitor.

### 6.3 Error tracking — Sentry gói miễn phí (ADR-073)

- Dùng cho cả api và web, với `release = GIT_SHA`, `environment = APP_ENV`.
- Source map upload lúc build trong CI, cần token **chỉ có ở environment staging/production** → PR từ fork không upload. Web **không** phục vụ source map công khai.
- **Hiện thực (T-035):** `beforeSend` theo **danh sách cho phép** — dựng event mới chỉ từ trường an toàn; phần lỗi dùng chung serializer allow-list của log (T-031 mục 0): không email / hash / token / cookie / body / query; bỏ `request`, `user`, breadcrumbs, biến cục bộ, dòng mã nguồn. Sentry 11 thay `sendDefaultPii` bằng `dataCollection` (mặc định THU cookie, header, body, query) ⇒ tắt hết tại nguồn. Tag `reqId` để nối với log.
- Chỉ gửi lỗi 5xx và exception không bắt được (graceful shutdown báo qua `onFatal`; integration OnUncaught/OnUnhandled của Sentry bị tắt). `SENTRY_TRACES_SAMPLE_RATE` (API, mặc định 0.05); web không trace. ⚠ Kiểm quota khi chọn hosting.
- **Thiếu `SENTRY_DSN` ở staging/production ⇒ cảnh báo `observability.sentry_disabled_missing_dsn`, KHÔNG chặn khởi động** (giám sát không được làm sập app).
- API: `main.ts` khởi tạo Sentry rồi mới dynamic import phần còn lại (`start-server.ts`) để instrumentation ESM móc được http/express/pg — không đổi lệnh chạy hay Dockerfile.
- Web: event trình duyệt đi qua **tunnel cùng origin `/monitoring`** ⇒ CSP không đổi (`connect-src 'self'` đủ). Route chỉ chuyển tiếp envelope có DSN trùng DSN cấu hình (khác ⇒ 403, không DSN ⇒ 404), đọc body **dạng luồng có trần 200 kB** (chunked không Content-Length cũng bị cắt ⇒ 413), **30 request/phút/IP + 300/phút/instance** ⇒ 429, và chỉ chuyển tiếp item `event` (session/replay/attachment bị bỏ). `SENTRY_DSN` phải `https://` ở staging/production (API từ chối khởi động; web tắt Sentry + cảnh báo). DSN/environment/release đưa xuống trình duyệt qua `<meta>` của root layout.
- Cấu hình dashboard (cảnh báo email, scrubber phía Sentry, uptime): `docs/runbook/alerts.md`.

### 6.4 Metrics tối thiểu

`prom-client` expose `/metrics` trên **cổng nội bộ riêng** (`METRICS_PORT`, mặc định 9464; server HTTP riêng, không qua app Express công khai — T-035), nghe `METRICS_HOST` **mặc định `127.0.0.1`** (mở `0.0.0.0` phải đặt tường minh khi nền tảng scrape qua mạng nội bộ). `METRICS_TOKEN` (bắt buộc ở staging + production) ⇒ thêm `Authorization: Bearer` làm lớp thứ hai. Nhãn `route` là **mẫu** (`/api/v1/workspaces/:wsId/members`), route không khớp ⇒ `unmatched` — không bao giờ có id/query.

**Đã hiện thực (T-035):** `http_request_duration_seconds{route,method,status}`, `http_errors_total{code}`, `db_pool_{total,idle,waiting}`, `socketio_connected_clients`, `scheduled_job_runs_total{job,result}` + `scheduled_job_last_success_timestamp{job}` (API `metrics.recordJobRun` cho scheduler T-033), metric mặc định của process. Các dòng còn lại của bảng dưới: bổ sung khi module tương ứng cần.

| Metric                                                                    | Loại      | Mục đích                                                       |
| ------------------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `http_request_duration_seconds{route,method,status}`                      | histogram | P95 theo route (ADR-030), tỉ lệ 5xx                            |
| `socketio_connected_clients`                                              | gauge     | tải realtime                                                   |
| `socketio_events_emitted_total{type}` / `realtime_broadcast_errors_total` | counter   | ADR-012: broadcast fire-and-forget phải nhìn thấy được khi lỗi |
| `db_pool_{total,idle,waiting}`                                            | gauge     | cạn pool                                                       |
| `valkey_fallback_active`                                                  | gauge 0/1 | đang chạy chế độ fallback DB (T-002 §2.4)                      |
| `rate_limit_blocked_total{rule}`                                          | counter   | phát hiện brute force                                          |
| `auth_refresh_reuse_detected_total`                                       | counter   | sự kiện bảo mật nghiêm trọng                                   |
| `password_hash_duration_seconds`                                          | histogram | theo dõi chi phí argon2 trên CPU thật                          |
| `task_rank_retry_total` / `version_conflict_total`                        | counter   | sức khỏe kéo thả (T-003)                                       |
| `scheduled_job_last_success_timestamp{job}`                               | gauge     | job định kỳ còn chạy không (§7.4)                              |
| mặc định của process (event loop lag, heap, GC)                           |           |                                                                |

Phase 1–4 chỉ cần expose endpoint. Việc scrape (vd Grafana Cloud gói miễn phí) quyết định ở Phase 5. Nếu không có chỗ scrape miễn phí phù hợp: ghi metric quan trọng thành log có cấu trúc, rồi cảnh báo từ log.

### 6.5 Cảnh báo (kênh: **email** — ADR-073)

| Cảnh báo      | Điều kiện                                                                                                                       | Mức                            | Nguồn                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Uptime        | `/healthz` prod nhìn từ ngoài lỗi 2 lần liên tiếp (check 1–5 phút tùy gói free)                                                 | Gấp                            | uptime monitor free, độc lập với hosting                                              |
| Tỉ lệ 5xx     | > 2% trong 5 phút                                                                                                               | Gấp                            | metrics/log                                                                           |
| P95           | đọc > 300ms hoặc ghi > 600ms trong 15 phút (gấp đôi mục tiêu ADR-030)                                                           | Cảnh báo                       | metrics                                                                               |
| Backup        | job backup logical lỗi, hoặc không chạy > 26h                                                                                   | Gấp                            | job tự gửi khi lỗi + heartbeat (uptime monitor kiểu "cron/heartbeat" nếu gói free có) |
| DB            | CPU > 80% 15 phút · ổ > 80% · connection > 80% giới hạn                                                                         | Cảnh báo                       | cảnh báo của nền tảng                                                                 |
| Valkey        | `valkey_fallback_active=1` > 1 phút · memory > 80%                                                                              | Cảnh báo                       | metrics + nền tảng                                                                    |
| Bảo mật       | `auth_refresh_reuse_detected_total` tăng · `rate_limit_blocked_total{rule="login"}` > 50/5 phút                                 | Cảnh báo                       | metrics/log                                                                           |
| Chứng chỉ TLS | hết hạn < 14 ngày                                                                                                               | Cảnh báo                       | uptime monitor                                                                        |
| Crash loop    | instance restart > 3 lần/10 phút                                                                                                | Gấp                            | nền tảng                                                                              |
| Sức chứa      | CPU API > 70 % hoặc `nodejs_eventloop_lag_p99_seconds` > 0,1 s liên tục (≥ 30 phút giờ cao điểm) · CPU Postgres > 70 % liên tục | Thông báo (lập kế hoạch scale) | nền tảng + metrics — `docs/runbook/scaling.md`                                        |
| Sentry        | issue mới ở prod                                                                                                                | Thông báo                      | Sentry email                                                                          |

Email gửi tới hộp thư của người dùng + Tech Lead. Mỗi cảnh báo "Gấp" phải trỏ tới 1 runbook. Rủi ro đã chấp nhận: email không đánh thức ai lúc nửa đêm, nên không có cam kết phản hồi ngoài giờ ở v1.

---

## 7. Scale ngang, realtime, graceful shutdown

### 7.1 Ngay từ 1 instance phải tuân thủ (ADR-000)

- Không giữ state quan trọng trong RAM:
  - rate limit ở Valkey (`rate-limit-redis` 6.0.1 + node-redis)
  - `tv`/`sid` ở Valkey + DB
  - phiên ở DB
- Thu hồi socket chỉ dùng API cấp server (`io.in(room).socketsLeave/disconnectSockets`) — T-002 §5.4.
- Job định kỳ không được chạy trùng khi có nhiều instance (§7.4).
- **Client Socket.io chỉ dùng `transports: ['websocket']`** (ADR-074) → không cần sticky session ở mọi phương án hosting. Mạng chặn WebSocket thì vẫn dùng app qua REST, chỉ mất cập nhật realtime.
- Valkey đặt `maxmemory-policy noeviction` + cảnh báo memory. Lý do: nếu Valkey tự xóa bộ đếm rate-limit thì thành lỗ hổng bảo mật mà không ai thấy. Mọi key đều có TTL nên bộ nhớ có giới hạn.

### 7.2 Khi lên ≥ 2 instance

**Khi nào** (ngưỡng theo số đo T-027/T-027c) và **cách làm** từng nền tảng: `docs/runbook/scaling.md`. Đo trên máy dev: 2 bản ≈ ×1,4 thông lượng, Postgres thành nút cổ chai kế tiếp.

| Việc                            | Chi tiết                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bật `SOCKET_REDIS_ADAPTER=true` | `@socket.io/redis-adapter` 8.3.0 với node-redis, **2 connection Valkey riêng** cho pub/sub. Adapter sharded cần lệnh `SSUBSCRIBE` (Redis ≥ 7) — Valkey 9 có; ⚠ KIỂM CHỨNG Phase 5 với bản managed |
| Sticky session                  | Không cần (websocket-only). **Không được** bật lại polling, vì nền tảng managed không có sticky                                                                                                   |
| Rate limit                      | Đã ở Valkey → đúng xuyên instance. Kiểm lại `TRUST_PROXY_HOPS` sau LB                                                                                                                             |
| Pool DB                         | Tính lại ngân sách (§4.5)                                                                                                                                                                         |
| Job định kỳ                     | Advisory lock (§7.4)                                                                                                                                                                              |
| Test                            | Nightly trong compose prodlike: 2 instance api dùng chung Valkey. Ghi ở A → client nối vào B nhận được event; logout ở A → socket ở B bị ngắt                                                     |
| Rolling deploy                  | Readiness (§6.2) + graceful shutdown (§7.3) đúng ⇒ không rớt request                                                                                                                              |

### 7.3 Graceful shutdown (SIGTERM / SIGINT)

Thứ tự trong `main.ts` (composition root):

1. Nhận SIGTERM → `shuttingDown = true` → `/readyz` trả 503. Log `shutdown.start`.
2. Đợi `READINESS_DRAIN_MS` (~5s) để LB ngừng gửi request mới.
3. `httpServer.close()`, sau đó `closeIdleConnections()`.
4. Socket.io: `io.local.disconnectSockets(true)` — chỉ ngắt socket của **instance này**, client tự reconnect sang instance khác. Sau đó `io.close()`. ⚠ KIỂM CHỨNG Phase 3: cờ `local` dùng cùng `disconnectSockets` trên socket.io 4.8.4.
5. Đợi request đang chạy xong (đếm in-flight) hoặc tới hạn chót.
6. Dừng scheduler → `prisma.$disconnect()` → `quit()` các client pub/sub của adapter → `quit()` client Valkey chính.
7. `process.exit(0)`.

- Hạn chót cứng `SHUTDOWN_TIMEOUT_MS` (20s): quá hạn thì log `shutdown.forced` và `exit(1)`. Hạn này phải **nhỏ hơn** thời gian nền tảng chờ trước khi SIGKILL: compose đặt `stop_grace_period: 30s`; nền tảng managed ⚠ KIỂM CHỨNG Phase 5.
- Gọi shutdown lần thứ hai là no-op.
- `unhandledRejection` / `uncaughtException`: log fatal → Sentry → shutdown với exit code 1.
- Broadcast realtime đang dở dang lúc shutdown: chấp nhận mất (ADR-012). Client reconnect sẽ join lại phòng và refetch board (T-003 §4.4 quy tắc 6).
- Test integration: gửi SIGTERM khi đang có request chậm → request vẫn 200, process thoát 0, Prisma/Valkey đã đóng.

### 7.4 Job định kỳ

| Job                                                                                                                               | Tần suất                | Nguồn                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------- |
| Dọn refresh token: phiên hết hạn tuyệt đối > 7 ngày (`purge-expired-refresh-tokens`, lượt đầu 90 s sau khởi động, jitter 30 phút) | hằng ngày               | security.md §2.2 (G2 S2)  |
| **Purge workspace** đã xóa mềm quá 30 ngày (`purge_at <= now()`)                                                                  | hằng giờ hoặc hằng ngày | ADR-047, ADR-050          |
| Backup logical                                                                                                                    | hằng ngày               | §4.3 — **chạy ngoài api** |
| (Không có) purge task xóa mềm                                                                                                     | —                       | ADR-042                   |

- Chạy trong process api bằng thư viện scheduler (⚠ KIỂM CHỨNG Phase 2: chọn `croner`/`node-cron` và tra registry — T-001 chưa chốt).
- Mỗi job dùng `pg_try_advisory_lock(<hằng số riêng cho job>)` (ADR-074) → chỉ instance lấy được lock mới chạy.
- Xóa theo lô (`… WHERE id IN (SELECT … LIMIT 1000)`) lặp đến hết. Riêng purge workspace thì mỗi workspace một transaction.
- Sau mỗi lần chạy: log + cập nhật metric `scheduled_job_last_success_timestamp`.
- Purge workspace là thao tác **không đảo ngược** được trừ khi dùng PITR → log ở mức `warn`, có `workspaceId`, và có test integration chứng minh không purge workspace còn trong hạn ân hạn (đã được khôi phục, hoặc `purge_at` chưa tới).

---

## 8. Chiến lược kiểm thử tổng thể

### 8.1 Kim tự tháp

| Tầng        | Công cụ (ADR-003)                                 | Phạm vi                                                                                                                                                                                                                                | Tỉ lệ ước lượng | Chạy khi                                                          |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| Unit        | Vitest 5.0.4 (`test.projects`)                    | domain (entity, value object, state machine, rank, policy), application (use case với fake repo/UoW/clock), contracts (Zod schema + test parity ADR-080), FE logic thuần                                                               | ~70%            | mọi PR, < 1 phút                                                  |
| Integration | Vitest + Postgres 18.6/Valkey 9.1.2 thật          | repository Prisma, UoW + audit trong transaction (ADR-012), route HTTP (supertest), middleware auth/RBAC/rate-limit, **bộ IDOR + SEC-01…55**, Socket.io gateway (client `socket.io-client` thật), collation/partial index, job định kỳ | ~25%            | mọi PR, < 5 phút                                                  |
| E2E         | Playwright 1.64.1                                 | 10–20 hành trình chính: đăng ký → tạo task → kéo thả → người thứ 2 thấy realtime; reload giữ phiên; logout-all ngắt tab khác; VIEWER không thấy nút xóa; khôi phục workspace                                                           | ~5%             | PR (Chromium) từ Phase 4; nightly 3 trình duyệt; smoke sau deploy |
| Tải         | k6 2.3.0                                          | §8.5                                                                                                                                                                                                                                   | —               | thủ công trước release lớn, Phase 5                               |
| Bảo mật     | integration (SEC) + ZAP baseline scan vào staging |                                                                                                                                                                                                                                        |                 | nightly / trước go-live                                           |

- **Đặc tả TDD cho Phase 2** là `docs/design/test-spec-auth-workspace.md` (156 case) và `docs/design/test-spec-task.md` (~190 case) — ADR-090. Mỗi case có ID trong tên test để truy vết được.
- Luật nghiệp vụ phải có test ở tầng thấp nhất kiểm được nó. Luật có hệ quả bảo mật (tenant, quyền) **phải có thêm** integration test đi qua HTTP thật.
- Mỗi bug fix kèm test tái hiện.

### 8.2 Ngưỡng coverage (ADR-074; Vitest `coverage.thresholds` theo glob)

| Vùng                             | Lines/Statements                              | Branches |
| -------------------------------- | --------------------------------------------- | -------- |
| `apps/api/src/**/domain/**`      | ≥ 90%                                         | ≥ 85%    |
| `apps/api/src/**/application/**` | ≥ 80%                                         | ≥ 75%    |
| `packages/contracts/**`          | ≥ 80%                                         | —        |
| Infra/adapter, routes            | không đặt ngưỡng % — đo bằng integration test |          |
| `apps/web`                       | theo `docs/design/frontend.md`                |          |

Coverage không thay được việc kiểm tra test có assert ý nghĩa; PR review phải xem.

### 8.2b Chạy Vitest an toàn (T-022)

- `maxWorkers` mặc định **4** (`vitest.config.ts` gốc; `test:coverage` của api truyền `--maxWorkers=4`), ghi đè bằng `VITEST_MAX_WORKERS`; CI đặt 2 (runner 4 vCPU, chừa CPU cho service). Đo trên máy dev bận: 6 worker ⇒ 16 file web không khởi động được worker; 4 worker ⇒ 95 file / 1012 test xanh, nhanh gấp đôi.
- **Chỉ tin EXIT CODE.** Đã thử (T-022, rồi gỡ probe): lỗi ngoài test (uncaught exception / unhandled rejection) và worker bị kill ⇒ Vitest **exit 1** dù vẫn in `Test Files … passed` — và file không khởi động được worker **không được đếm** trong dòng đó. Không nơi nào bật `dangerouslyIgnoreUnhandledErrors`. CI không có `| tee`, `|| true`, `continue-on-error` ở bước test.

### 8.3 DB test cô lập (ADR-074)

- Dùng Postgres test riêng: `postgres-test` khi chạy local, `services` khi chạy CI.
- Hiện trạng (T-010/T-017, chốt ở T-022): postgres-test có **2 DB, không trộn**:
  - `taskflow_sec` — **suite bảo mật** (ADR-106): harness tự tạo bằng migrator, xóa schema + migrate đầu mỗi file, API chạy bằng **`taskflow_app`** để lỗi thiếu quyền lộ ra. Valkey db 15 riêng. `taskflow_template` không còn dùng cho test (harness từ chối).
  - `taskflow_it` — **integration** (`DATABASE_URL_TEST`): harness xóa + dựng lại schema `public` rồi migrate. Nếu chạy vào template sẽ xóa luôn grant/default privileges của `taskflow_app` (gắn với schema) ⇒ suite bảo mật hỏng.
- Khi cần chạy integration song song theo worker: clone `taskflow_w<N>` từ template như suite bảo mật (đã có cơ chế).
- Giữa các test file: `TRUNCATE … RESTART IDENTITY CASCADE` toàn bộ bảng nghiệp vụ (lấy danh sách từ `pg_tables`, trừ `_prisma_migrations`). **Không** rollback transaction sau mỗi test, vì phải commit thật thì mới kiểm được ADR-012.
- Không mock Prisma trong integration. Thời gian dùng clock tiêm vào (ADR-016).
- Vitest 5 không tự tìm config ở thư mục cha → config project nằm ở root (`test.projects`) — T-001 §4.

### 8.4 Seed dữ liệu

- **Factory** ở `apps/api/test/factories/` (`aUser()`, `aWorkspace({ owner })`, `aTask({ project, status })`). Mỗi test tự tạo dữ liệu nó cần.
- **Fixture bảo mật cố định** theo T-002 §7: helper `seedSecurityFixture()`.
- **Mật khẩu trong factory/seed:** băm argon2id thật (~27ms mỗi lần, đủ nhanh). Factory cache sẵn 1 hash cho mật khẩu mặc định, để không băm lại ở mỗi test.
- `pnpm db:seed` (local/E2E): dữ liệu demo nhỏ, idempotent.
- `pnpm db:seed:load` (staging, k6): 50 workspace × 5 project × ~400 task (~100k task) + audit log tương ứng.
- Seed **không bao giờ** chạy được khi `APP_ENV=production` — kiểm tra cứng, và có test cho việc này.

### 8.5 Playwright & k6

**Playwright** chạy ở 3 nơi:

1. CI (`e2e.yml`): **hiện tại** harness T-026 (API `src/main.ts` + web standalone, không TLS) — PR chỉ Chromium, push `main` + nightly đủ Chromium + Firefox + mobile. **Mục tiêu sau khi chốt hosting:** stack `docker-compose.prodlike.yml` (đúng image prod, Caddy TLS nội bộ để test cookie `__Host-tf_rt` — ADR-109). ⚠ KIỂM CHỨNG khi chuyển: tin cậy CA tự ký trong container Playwright.
2. Staging sau mỗi deploy (`@smoke`).
3. Prod sau deploy: chỉ `@smoke-readonly` với tài khoản canary.

Mỗi test tự đăng ký user/workspace mới qua API, không dùng chung user.

**k6** (`grafana/k6:2.3.0`, kịch bản viết `.ts` chạy native). Chạy vào staging, không bao giờ chạy vào prod:

| Kịch bản                                                                | Tải                                      | Ngưỡng (ADR-030)                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read-board`: `GET tasks` (list + filter), `GET task`, `GET audit-logs` | ramp 0 → 50 VU trong 2 phút, giữ 10 phút | `http_req_duration{kind:read}` p(95) < 150ms, lỗi < 0.5%                                                                                               |
| `write-mix`: tạo task, PATCH (`expectedVersion`), move, assign          | 20 VU, 10 phút, cùng project             | `{kind:write}` p(95) < 300ms; 409 `VERSION_CONFLICT` đếm riêng                                                                                         |
| `hot-column`: nhiều VU thả vào cùng 1 khe                               | 30 VU, 3 phút                            | không có 500; 409 `RESOURCE_CONFLICT` < 1%                                                                                                             |
| `realtime-fanout`: 200 socket cùng project, 1 VU ghi                    | 10 phút                                  | độ trễ event p(95) < 500ms. ⚠ k6 chỉ nói giao thức WebSocket thô, không nói Socket.io → Phase 5 viết client Node riêng hoặc tự cài giao thức Engine.IO |
| `auth` (riêng, **không** tính vào ADR-030)                              | 5 VU login                               | theo dõi `password_hash_duration_seconds`, rate limit trả 429 đúng                                                                                     |

Điều kiện chạy k6:

- Staging cùng cỡ instance với prod, đã chạy `db:seed:load`.
- Tắt rate limit **chỉ** cho IP của runner k6, qua allowlist env của staging.

---

## 9. Checklist go-live (Phase 5)

> Checklist **chung** (mạng, dữ liệu, vận hành). Phần bảo mật đi sâu — cách kiểm từng mục và bằng chứng cần lưu — ở `docs/runbook/security-go-live.md` (Engineer B); khi hai tài liệu lệch nhau, runbook bảo mật và `security.md` đúng hơn.

Mỗi mục phải có người ký xác nhận và bằng chứng (link log/ảnh/run CI) trong `docs/ops/go-live.md`.

**Mạng & HTTPS**

1. ☐ Đã có domain (ADR-071). HTTPS cho `app.` và `api.`; HTTP → 301 HTTPS; HSTS bật (helmet 8 mặc định 365 ngày — đặt ngắn hơn lúc đầu, tăng dần; chưa `preload`).
2. ☐ TLS ≥ 1.2; chứng chỉ tự gia hạn; cảnh báo hết hạn hoạt động.
3. ☐ FE và API cùng registrable domain (ADR-029). `wss://` kết nối được qua ingress thật và giữ được > 10 phút.
4. ☐ `TRUST_PROXY_HOPS` đã **đo**: `req.ip` khớp IP thật; `X-Forwarded-For` giả không đổi được `req.ip`.

**Bảo mật ứng dụng** 5. ☐ Cookie refresh ở staging/prod (ADR-109, ghi đè ADR-024): `__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/`, **không** có `Domain` (SEC-34 trên staging). Dev giữ `tf_rt; Path=/api/v1/auth`. 6. ☐ `CORS_ORIGINS` chỉ chứa `https://app.<domain>` (SEC-30). 7. ☐ Rate limit bật, dùng Valkey store. Login theo ADR-108: chỉ đếm `401 INVALID_CREDENTIALS`, bucket (IP, emailHash) 10 lần/15 phút + theo email 100/giờ ⇒ vượt thì 429 + `Retry-After` (SEC-28). Tắt Valkey → login/register fail-closed. Cách kiểm chi tiết: `docs/runbook/security-go-live.md`. 8. ☐ helmet header có mặt; CSP của web dùng nonce, không có `unsafe-inline`. 9. ☐ Toàn bộ SEC-01…55, test IDOR và 2 test-spec (ADR-090) xanh trên commit sẽ deploy. 10. ☐ ZAP baseline scan staging: không có cảnh báo High. 11. ☐ Log staging sau E2E không chứa password/token/cookie (SEC-33). 12. ☐ argon2id chạy đúng trong image prod; `password_hash_duration_seconds` P95 hợp lý trên CPU thật.

**Secret & truy cập (repo public)** 13. ☐ Secret prod sinh mới, khác staging/local. **gitleaks quét toàn bộ lịch sử xanh**. Secret scanning + push protection của GitHub đang bật. 14. ☐ Đã diễn tập xoay `JWT_ACCESS_SECRET` trên staging, không rớt phiên. 15. ☐ DB/Valkey chỉ nhận kết nối từ app (trusted sources/VPC). Valkey dùng TLS (`rediss://`) + mật khẩu.
15a. ☐ Valkey `maxmemory-policy` = **`noeviction`** trên staging **và** prod — đã **kiểm** (App Platform: API `GET /v2/databases/{uuid}/eviction_policy`; VPS: `valkey-cli INFO memory`), lệnh ở `docs/runbook/deploy.md` §A.1 / §B.2. Khóa thu hồi phiên (`auth:sid-revoked:*`, `auth:tv:*`) và bộ đếm rate limit không được bị evict; cảnh báo bộ nhớ Valkey ≥ 80 % đã bật. 16. ☐ App kết nối DB bằng `taskflow_app`; migrate bằng `taskflow_migrator`. 17. ☐ Tài khoản hosting, GitHub, GHCR, Sentry, uptime monitor đều bật 2FA. Environment `production` có required reviewers; branch protection bật trên `main`. 18. ☐ Image public trên GHCR không chứa secret (`docker history` + Trivy secret scan).

**Dữ liệu** 19. ☐ PITR bật; backup logical hằng ngày sang storage ngoài nhà cung cấp đã chạy ≥ 3 ngày liên tiếp. 20. ☐ **Đã diễn tập restore thành công** cả PITR lẫn logical; RTO ≤ 2h; kết quả ghi ở `restore-drills.md`. 21. ☐ `pnpm exec prisma migrate status` báo up to date; collation `"C"` và partial unique index có mặt. 22. ☐ Seed bị chặn ở prod (đã thử).

**Vận hành** 23. ☐ `/healthz` và `/readyz` hoạt động; health check của nền tảng trỏ đúng. 24. ☐ Graceful shutdown: deploy lại trong lúc k6 chạy tải nhẹ → không có request 5xx. 25. ☐ Uptime monitor + mọi cảnh báo ở §6.5 đã cấu hình và **đã bắn thử email** tới đúng người. 26. ☐ Sentry nhận lỗi thử từ prod với đúng `release`, không có PII; quota gói free đủ dùng. 27. ☐ Tìm được log theo `requestId`. 28. ☐ k6 trên staging đạt ADR-030 với dữ liệu `seed:load`. 29. ☐ Đã diễn tập rollback: deploy SHA cũ trên staging trong < 10 phút. 30. ☐ Job dọn token và purge workspace chạy đúng 1 lần mỗi chu kỳ (log + advisory lock + metric). 31. ☐ Có runbook cho: restore DB, rollback, xoay secret, thu hồi mọi phiên, Valkey sập, sự cố bảo mật, khôi phục workspace bị purge nhầm (bằng PITR). 32. ☐ Ngưỡng scale (`docs/runbook/scaling.md` §1) đã có cảnh báo tương ứng; giới hạn kết nối thật của cụm PG đã đo (§4.1) và ghi cùng `DATABASE_POOL_MAX` đang dùng.

---

## 10. Câu hỏi mở của T-004 — đã đóng

| Q   | Câu hỏi                             | Kết luận                                                                                                                          | Căn cứ                               |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Q1  | Hosting, region, ngân sách          | Làm local trước. Chọn hosting trước Phase 5; ứng viên mặc định là DO managed Singapore (phương án C). Code không gắn nhà cung cấp | ADR-070                              |
| Q2  | Domain                              | Chưa có; chỉ cần trước staging                                                                                                    | ADR-071                              |
| Q3  | GitHub public/private, gói          | **Public** → branch protection + required reviewers miễn phí; bắt buộc gitleaks CI + pre-commit                                   | ADR-072                              |
| Q4  | Log/metrics/uptime/kênh cảnh báo    | Sentry free + uptime monitor free, cảnh báo qua email. Dịch vụ gom log/scrape metrics (gói free) chọn cùng hosting ở Phase 5      | ADR-073                              |
| Q5  | Web nhận `API_URL` lúc runtime      | Đồng ý; 1 image cho mọi môi trường; dashboard render động chấp nhận được                                                          | ADR-074, ADR-084                     |
| Q6  | Socket.io websocket-only            | Đồng ý                                                                                                                            | ADR-074                              |
| Q7  | readyz khi Valkey lỗi; tách user DB | Đồng ý cả hai; login/register vẫn fail-closed                                                                                     | ADR-074                              |
| Q8  | Các điểm phụ thuộc phiên bản        | Đã thay bằng số chốt (bảng đầu tài liệu). Phần còn lại là ⚠ KIỂM CHỨNG có ghi ticket/phase phụ trách (chủ yếu T-011 và Phase 5)   | ADR-060 → ADR-065, stack-versions.md |

**Điểm còn mở (giao cho ticket, không cần người dùng quyết):**

| Điểm                                            | Phụ trách       |
| ----------------------------------------------- | --------------- |
| Prisma có bọc migration trong transaction không | Phase 2 (T-010) |
| Option `max` của PrismaPg                       | T-010           |
| `io.local.disconnectSockets`                    | Phase 3         |
| Thư viện scheduler                              | Phase 2         |
| CA tự ký cho Playwright                         | Phase 4         |
| PoC nền tảng hosting                            | Phase 5         |
| Client đo fan-out realtime                      | Phase 5         |

## Nguồn (truy cập 2026-10-15)

- Phiên bản và hành vi thư viện: `docs/research/stack-versions.md` (T-001) — nguồn gốc ghi trong tài liệu đó.
- Docker Hub tags (đã thấy `valkey/valkey:9.1.2`, `postgres:18.6-bookworm`): https://hub.docker.com/r/valkey/valkey/tags · https://hub.docker.com/_/postgres/tags
- gitleaks release v8.30.1 (2026-03-21): https://github.com/gitleaks/gitleaks/releases
- Hetzner — điều chỉnh giá từ 15/06/2026: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ · trạng thái sản phẩm: https://www.hetzner.com/cloud/ · https://www.hetzner.com/cloud/regular-performance/
- Hetzner backup (7 slot/ngày, không gồm volume): https://docs.hetzner.com/de/cloud/servers/backups-snapshots/faq/
- Bối cảnh các đợt tăng giá Hetzner 2026 (nguồn thứ cấp): https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/ , https://northflank.com/blog/hetzner-cloud-server-price-increases
- DigitalOcean Droplets: https://www.digitalocean.com/pricing/droplets
- DigitalOcean Managed Databases: https://www.digitalocean.com/pricing/managed-databases · Valkey: https://docs.digitalocean.com/products/databases/valkey/details/pricing/
- DigitalOcean PostgreSQL — daily backup + WAL, PITR 7 ngày: https://docs.digitalocean.com/products/databases/postgresql/details/features/
- DigitalOcean App Platform — giá container: https://docs.digitalocean.com/products/app-platform/details/pricing/ · giới hạn: https://docs.digitalocean.com/products/app-platform/details/limits/
- Railway (tham khảo): https://docs.railway.com/reference/pricing/plans
- Render — **chỉ có nguồn thứ cấp** (⚠): https://temps.sh/blog/render-pricing-2026 , https://livemy.app/blog/render-pricing
- GitHub Environments — required reviewers miễn phí cho repo public: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- Socket.io nhiều node (sticky session chỉ cần khi có polling): https://socket.io/docs/v4/using-multiple-nodes/
- Next.js `output: 'standalone'`: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
