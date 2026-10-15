# Thiết kế vận hành production, CI/CD & chiến lược kiểm thử (T-004)

**Tác giả:** Engineer D (`taskflow-enterprise-a5`) · **Phase:** 0 · **Trạng thái:** chờ Tech Lead duyệt
**Căn cứ:** `DECISIONS.md` v1.1 (ADR-000, 001, 003, 004, 012, 024–030), `docs/design/security.md` (T-002), `docs/design/data-and-api.md` (T-003).

> Quy ước:
> - "phải/không được" = bắt buộc khi làm Phase 1+.
> - **Không có số phiên bản** trong tài liệu này. Mọi image/thư viện ghi `<ver: T-001>` — lấy từ `docs/research/stack-versions.md` (chưa có lúc viết).
> - `⚠ CHƯA KIỂM CHỨNG` = mình tin là đúng nhưng chưa đối chiếu với tài liệu chính thức, phải kiểm tra trước khi dựa vào.
> - Giá lấy ngày **2026-10-15**, chưa gồm VAT. Giá cloud thay đổi liên tục (Hetzner đã tăng giá 2 lần trong 2026) → kiểm tra lại trước khi ký.

---

## Mục lục
1. Phương án hosting (so sánh + đề xuất)
2. Môi trường, biến môi trường, secret
3. Docker production & docker-compose local
4. Vận hành database (migrate, migration an toàn, backup/restore, pooling)
5. CI/CD (GitHub Actions)
6. Observability
7. Scale ngang, realtime, graceful shutdown, job định kỳ
8. Chiến lược kiểm thử tổng thể
9. Checklist go-live
10. Câu hỏi mở · Nguồn

---

## 1. Phương án hosting

### 1.1 Cấu hình cần chạy (giai đoạn đầu)
| Thành phần | Production | Ghi chú |
|---|---|---|
| `api` (Express 5 + Socket.io) | 1 instance, ≥ 1 vCPU, 1–2 GB RAM | bcrypt cost 12 ≈ 250ms CPU/lần login → 0.5 vCPU chia sẻ là quá yếu |
| `web` (Next.js standalone) | 1 instance, 0.5–1 GB RAM | Chỉ phục vụ shell/landing (ADR-026), tải nhẹ |
| PostgreSQL | 1 node, cần **PITR** | Dữ liệu thật — tài sản quan trọng nhất |
| Redis | 1 node, không cần persistence | Chỉ chứa cache `tv`, `sid-revoked`, rate-limit, (sau này) Socket.io adapter — mất hết vẫn chạy đúng nhờ fallback DB (T-002 §2.4) |
| Staging | bản thu nhỏ của production | Dùng để deploy thử, E2E, k6 |

**Vùng (region):** nếu người dùng chủ yếu ở Việt Nam → chọn **Singapore**. Đặt ở EU thêm ~150–200ms RTT mỗi request, làm UX kéo thả kém dù P95 phía server (ADR-030) vẫn đạt. → Câu hỏi mở Q1.

### 1.2 So sánh 3 phương án

| Tiêu chí | **A. 1 VPS + Docker Compose + Caddy** | **B. PaaS (Render)** | **C. Cloud managed (DigitalOcean: App Platform + Managed PostgreSQL + Managed Valkey)** |
|---|---|---|---|
| Thành phần | 1 máy chạy tất cả: Caddy, api, web, postgres, redis | Web service ×2, Postgres, Key Value | 2 component App Platform, 1 cluster PG, 1 cluster Valkey (Redis-compatible) |
| **Chi phí prod/tháng (ước tính)** | **≈ $36** (DO Droplet SGP 2 vCPU/4 GiB $24 + daily backup 30% = $7.2 + object storage cho backup ~$5 ⚠) · hoặc **≈ €10–15** ở Hetzner EU (CX33 €8.49 + backup + storage ⚠) | **≈ $60–90**: api Standard ~$25, web Starter ~$7, Postgres Basic-1gb ~$19 + ổ $0.30/GB, Key Value Starter ~$10, phí workspace $0–25 ⚠ (nguồn thứ cấp, mâu thuẫn) | **≈ $55–70**: api `apps-s-1vcpu-2gb` $25 (hoặc 1gb $12), web `apps-s-1vcpu-1gb` $12, PG 1 GiB $15.15, Valkey 1 GiB $15 |
| Chi phí staging | +$12 (droplet 2 GiB chạy compose) | +$30–40 | +$12 nếu staging là droplet compose (khuyến nghị), +$45 nếu clone đủ managed |
| Độ khó vận hành | **Cao**: tự vá OS, firewall, SSH, tự làm PITR (WAL-G/pgBackRest), tự giám sát ổ đĩa, 1 máy = 1 điểm chết | Thấp | Thấp–trung bình: không vá OS, không tự làm backup DB; vẫn tự lo CI/CD, giám sát app |
| WebSocket | Có (Caddy proxy WS mặc định) | Có | Có ⚠ (tài liệu limits không nhắc — cần thử ở staging) |
| Sticky session khi 2+ instance | Tự cấu hình (Caddy `lb_policy cookie`) | Không có ⚠ | Không có ⚠ |
| Backup DB | **Tự làm**. Snapshot máy (Hetzner/DO) **không phải** backup DB nhất quán, không PITR | Có, PITR ở gói trả phí ⚠ | **Daily full + WAL, PITR 7 ngày** (tài liệu DO) |
| HTTPS | Caddy tự cấp Let's Encrypt | Tự động | Tự động |
| Region Singapore | DO SGP1 có; Hetzner SIN1 chỉ dòng CPX, giá chưa rõ | Có ⚠ | Có ⚠ |
| Scale ngang | Phải thêm máy + LB → viết lại hạ tầng | Kéo số instance | Kéo số instance |
| Khóa nhà cung cấp | Thấp nhất | Trung bình | Trung bình (đều là Docker image + Postgres chuẩn → dễ chuyển) |

Lưu ý phương án A ở Hetzner: trang Cloud của Hetzner (truy cập 2026-10-15) đánh dấu dòng Cost-Optimized (CX) "Currently not available" và nút tạo CPX hiển thị "currently unavailable" → **có thể không mua được ngay**. Giá CX33 €8.49 / CPX22 €19.49 là giá mới cho đơn từ 15/06/2026 (Hetzner price adjustment).

### 1.3 Không có sticky session thì sao?
Socket.io chỉ **bắt buộc** sticky session khi bật HTTP long-polling. Nếu client dùng `transports: ['websocket']` thì mỗi kết nối là 1 TCP duy nhất, không cần sticky (`@socket.io/redis-adapter` lo broadcast xuyên node). Đánh đổi: mất fallback polling cho mạng chặn WebSocket (hiếm, chủ yếu proxy doanh nghiệp cũ). → Quyết định đề xuất ở §7.1.

### 1.4 Đề xuất: **Phương án C — DigitalOcean (App Platform + Managed PostgreSQL + Managed Valkey), region Singapore; staging chạy trên 1 droplet compose**

Lý do (theo thứ tự quan trọng):
1. **Dữ liệu thật mà team không có người trực DBA.** PITR 7 ngày có sẵn là thứ đắt nhất để tự làm đúng ở phương án A (WAL archiving, giám sát archive, diễn tập restore). Rủi ro mất dữ liệu > chênh lệch ~$25–35/tháng.
2. Không vá OS/SSH/firewall cho production → bớt mặt tấn công mà team nhỏ hay bỏ quên.
3. Scale ngang chỉ là kéo số instance (ADR-000), không phải xây lại hạ tầng.
4. Có region Singapore; giá công bố rõ trên tài liệu chính thức (B dựa trên nguồn thứ cấp, mâu thuẫn).
5. Vẫn là Docker image + Postgres chuẩn → muốn chuyển sang A/B về sau không phải sửa code.

**Phương án dự phòng nếu ngân sách < $40/tháng:** A trên DO Droplet SGP, **bắt buộc** WAL-G/pgBackRest đẩy WAL + base backup sang object storage khác nhà cung cấp, và diễn tập restore hằng tháng (§4.4) trước khi go-live.

**Phải thử ở staging/PoC trước khi chốt (Phase 1):** WebSocket qua App Platform ingress (timeout idle, ping 25s của Socket.io có giữ kết nối không), job PRE_DEPLOY chạy migrate (§4.1), giới hạn số connection của gói PG 1 GiB.

> Quyết định tốn tiền → Tech Lead hỏi người dùng chốt (Q1–Q3).

---

## 2. Môi trường, biến môi trường, secret

### 2.1 Ba môi trường
| | local | staging | production |
|---|---|---|---|
| Hạ tầng | `docker compose` (postgres, redis, mailpit tùy chọn); app chạy `pnpm dev` trên máy | 1 droplet: compose chạy **đúng image** sẽ lên prod + Caddy | Phương án C |
| Domain | `localhost:3000` / `localhost:4000` | `staging.<domain>` / `api.staging.<domain>` | `app.<domain>` / `api.<domain>` (ADR-029: cùng registrable domain) |
| `NODE_ENV` | `development` | `production` | `production` |
| Dữ liệu | seed giả | seed giả cỡ lớn (cho k6) — **không bao giờ copy dữ liệu prod** | thật |
| Deploy | — | tự động khi merge `main` | thủ công, cùng image digest đã qua staging |

`NODE_ENV=production` ở staging là cố ý: staging phải chạy giống prod (cookie `__Secure-`, `COOKIE_SECURE=true`, log JSON). Phân biệt môi trường bằng `APP_ENV` (`local|staging|production|test`).

### 2.2 Biến môi trường — `apps/api`
| Biến | Secret? | Bắt buộc | Validate (Zod) | Ghi chú |
|---|---|---|---|---|
| `NODE_ENV` | | ✔ | enum | |
| `APP_ENV` | | ✔ | enum `local\|test\|staging\|production` | dùng cho log/Sentry tag |
| `PORT` | | | int, mặc định 4000 | |
| `DATABASE_URL` | **✔** | ✔ | url `postgresql://` | URL app dùng (có thể qua pooler sau này) |
| `DIRECT_DATABASE_URL` | **✔** | chỉ job migrate | url | luôn kết nối thẳng, không qua pooler (§4.5) |
| `DATABASE_POOL_MAX` | | | int 1–50, mặc định 10 | §4.5 |
| `REDIS_URL` | **✔** | ✔ | url `redis://`/`rediss://`; prod bắt buộc `rediss://` | Managed Valkey dùng TLS |
| `JWT_ACCESS_SECRET` | **✔** | ✔ | base64 giải mã ≥ 32 byte | T-002 §2.1 |
| `JWT_ACCESS_KID` | | ✔ | string ngắn | `kid` của khóa hiện tại (đề xuất — để xoay khóa) |
| `JWT_ACCESS_SECRET_PREVIOUS` / `JWT_ACCESS_KID_PREVIOUS` | **✔** / | | như trên | chỉ có trong cửa sổ xoay khóa |
| `CORS_ORIGINS` | | ✔ | danh sách URL, phân cách dấu phẩy; prod cấm `http://` và `*` | T-002 §6.3 |
| `COOKIE_SECURE` | | ✔ | boolean; **prod mà `false` → không khởi động** | T-002 §2.3 |
| `TRUST_PROXY_HOPS` | | ✔ | int ≥ 0 | **phải đo thực tế** ở mỗi môi trường (§9) |
| `BCRYPT_COST` | | | int, prod ≥ 12 | |
| `LOG_LEVEL` | | | enum pino, mặc định `info` | |
| `SENTRY_DSN` | ✔ (nhẹ) | prod/staging | url | DSN lộ ra chỉ cho phép gửi event, nhưng vẫn không commit |
| `GIT_SHA` | | ✔ | string | nhúng lúc build image (build-arg) — dùng trong log, `/healthz`, Sentry release |
| `SOCKET_REDIS_ADAPTER` | | | boolean, mặc định `false` | bật khi ≥ 2 instance (§7) |
| `SHUTDOWN_TIMEOUT_MS` | | | int, mặc định 20000 | §7.3 |
| `METRICS_TOKEN` | **✔** | prod | ≥ 32 ký tự | bảo vệ `/metrics` nếu không tách cổng nội bộ được (§6.4) |

`JWT_REFRESH_SECRET` của v1.0: **bỏ** (T-002 — refresh token là opaque).

### 2.3 Biến môi trường — `apps/web`
| Biến | Secret? | Lúc nào | Ghi chú |
|---|---|---|---|
| `API_URL` | | runtime | `https://api.<domain>` |
| `WS_URL` | | runtime | thường = `API_URL` |
| `SENTRY_DSN` | nhẹ | runtime | |
| `GIT_SHA`, `APP_ENV` | | build/runtime | |

**Bẫy cần tránh:** biến `NEXT_PUBLIC_*` bị **nhúng cứng lúc `next build`** → nếu dùng thì phải build image riêng cho staging và prod, phá nguyên tắc "build 1 lần, promote cùng image". Đề xuất: **không dùng `NEXT_PUBLIC_*` cho URL**; root layout (server component) đọc `process.env.API_URL` lúc chạy và truyền xuống client qua context/`<script>` cấu hình. Chi tiết do Engineer E (T-005) quyết — xem câu hỏi mở Q5. Web **không giữ secret nào** (ADR-026: Next chỉ phục vụ shell).

### 2.4 Validate env lúc khởi động
- `apps/api/src/config/env.ts`: một Zod schema, `safeParse(process.env)` **trước khi** tạo bất kỳ kết nối nào. Lỗi → in danh sách **tên biến** sai (không in giá trị) rồi `process.exit(1)`.
- Ràng buộc chéo bằng `superRefine`: `NODE_ENV=production` ⇒ `COOKIE_SECURE=true`, `REDIS_URL` là `rediss://`, `CORS_ORIGINS` toàn `https://`, `BCRYPT_COST ≥ 12`, `JWT_ACCESS_SECRET` khác giá trị mẫu trong `.env.example`.
- Kết quả là object `Env` đã có kiểu, truyền vào composition root (ADR-016); **code nghiệp vụ không đọc `process.env`** — ép bằng ESLint `no-restricted-properties` / `n/no-process-env` ngoài thư mục `config/` (ADR-004).
- Cùng schema đó được job migrate và script seed dùng lại (phần con).

### 2.5 Quản lý secret
- `.env*` trong `.gitignore`, trừ `.env.example` (chỉ tên biến + giá trị giả rõ ràng như `change-me-…`). CI có bước **gitleaks** quét secret trên mọi PR.
- Local: mỗi dev tự copy `.env.example` → `.env`. Secret local khác hoàn toàn staging/prod.
- Staging/Prod (C): secret lưu trong **App Platform env vars kiểu encrypted** (prod) và file `.env` quyền `600` trên droplet staging, do workflow deploy ghi từ **GitHub Environment secrets** (`staging`, `production`).
- Sinh secret: `openssl rand -base64 48`. Mỗi môi trường một bộ, không dùng lại.
- **Xoay vòng:**
  - `JWT_ACCESS_SECRET`: đặt khóa mới làm hiện tại, khóa cũ sang `_PREVIOUS` + `kid` cũ → deploy → sau ≥ 15 phút (TTL access token) bỏ `_PREVIOUS`. Không rớt phiên. Định kỳ 6 tháng hoặc ngay khi nghi lộ.
  - Mật khẩu DB/Redis: tạo user/password mới (managed cho phép) → cập nhật env → deploy → xóa cái cũ.
  - Nghi lộ refresh token hàng loạt: `UPDATE users SET token_version = token_version + 1` + thu hồi mọi refresh token (runbook, cần lệnh admin — Phase 2).
- Ai có quyền: chỉ người dùng (chủ dự án) + Tech Lead có quyền đọc secret prod. Agent không bao giờ được nhận secret prod trong prompt.

---

## 3. Docker production & docker-compose local

### 3.1 Nguyên tắc chung
- Base image: `node:<ver: T-001>-<debian slim, vd bookworm-slim>`; **ghim theo digest** (`@sha256:…`) trong Dockerfile, Renovate/Dependabot cập nhật. Chọn Debian slim thay Alpine: tránh lỗi musl với module native (bcrypt nếu T-001 chọn bản native) và engine Prisma. ⚠ T-001 xác nhận Prisma 7 còn cần binary engine không.
- `corepack` bật pnpm đúng phiên bản trong `packageManager` của `package.json` gốc.
- Build cache pnpm: `pnpm fetch` dựa trên `pnpm-lock.yaml` (layer chỉ đổi khi lockfile đổi) + `RUN --mount=type=cache,target=/pnpm/store`.
- Runtime: chạy bằng user `node` (uid 1000) có sẵn trong image, `WORKDIR` thuộc root nhưng chỉ đọc; không cài trình biên dịch, không pnpm, không source TS.
- `CMD ["node", "dist/main.js"]` dạng exec — **không** `pnpm start`/`npm start` (không chuyển tiếp SIGTERM ổn định). Chạy với `init: true` (compose) / tini để reaping + chuyển tín hiệu.
- `ENV NODE_ENV=production`, `ARG GIT_SHA` → `ENV GIT_SHA`. Label OCI (`org.opencontainers.image.revision`, `.source`).
- `.dockerignore`: `node_modules`, `.next`, `dist`, `.env*`, `.git`, `coverage`, `playwright-report`.
- `HEALTHCHECK` dùng `node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"` (slim không có curl). App Platform/Kubernetes bỏ qua `HEALTHCHECK` và dùng health check riêng → cấu hình cả hai.
- Image được quét Trivy trong CI (§5), không có CRITICAL chưa xử lý mới được deploy.

### 3.2 `apps/api/Dockerfile` (mô tả, chưa viết)
```
stage deps     : FROM node-slim AS deps      → copy lockfile + pnpm-workspace.yaml → pnpm fetch
stage build    : FROM deps AS build          → copy source monorepo → pnpm install --offline --frozen-lockfile
                                               → prisma generate → build packages/contracts → build apps/api (tsc/tsup)
                                               → pnpm deploy --filter @taskflow/api --prod /out   (⚠ cờ --legacy tùy phiên bản pnpm, T-001)
stage migrate  : FROM build AS migrate       → giữ prisma CLI + thư mục prisma/migrations; CMD prisma migrate deploy
stage runtime  : FROM node-slim AS runtime   → COPY --from=build /out + dist + client Prisma đã generate
                                               → USER node · EXPOSE 4000 · HEALTHCHECK · CMD ["node","dist/main.js"]
```
- Hai target cùng một lần build trên cùng commit: `api` (runtime) và `api-migrate`. Cả hai đẩy lên registry với cùng tag `GIT_SHA`.
- Image runtime **không chứa** prisma CLI, devDependencies, test, `.env`.

### 3.3 `apps/web/Dockerfile`
- `next.config`: `output: 'standalone'` + `outputFileTracingRoot` trỏ về gốc monorepo (không có thì standalone thiếu file của `packages/contracts`).
- Stage build: `pnpm --filter @taskflow/web build`.
- Stage runtime: copy `apps/web/.next/standalone/` → `/app`, **copy thêm** `apps/web/.next/static` → `/app/apps/web/.next/static` và `apps/web/public` → `/app/apps/web/public` (standalone không tự copy hai thư mục này). `ENV HOSTNAME=0.0.0.0 PORT=3000`, `USER node`, `CMD ["node","apps/web/server.js"]`.
- Healthcheck: route `/api/healthz` (Route Handler trả 200, không gọi API).
- ⚠ Next 16 có thay đổi gì về standalone/`sharp` → T-001.

### 3.4 `docker-compose.yml` cho local dev
| Service | Image | Ghi chú |
|---|---|---|
| `postgres` | `postgres:<ver: T-001>` | port 5432, volume `pgdata`, healthcheck `pg_isready`, `POSTGRES_DB=taskflow` |
| `postgres-test` | cùng image | port 5433, `tmpfs` cho data dir, `-c fsync=off -c synchronous_commit=off -c full_page_writes=off` (nhanh, chỉ cho test) |
| `redis` | `redis:<ver: T-001>` hoặc `valkey/valkey:<ver>` (khớp prod) | port 6379, không persistence |
| `mailpit` | `axllent/mailpit` | **profile `mail`**, tắt mặc định — v1 chưa gửi mail (T-002 §6.5); để sẵn cho xác minh email sau này |

- App (api/web) chạy trên máy bằng `pnpm dev` để hot reload nhanh; compose chỉ lo hạ tầng.
- `docker-compose.prodlike.yml` (Phase 1/5): chạy **image đã build** của api + web + migrate + Caddy, dùng cho E2E trong CI và staging. Đây chính là file deploy staging.
- Lệnh chuẩn (Phase 1 hiện thực trong `package.json` gốc): `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm infra:down`.

---

## 4. Vận hành database

### 4.1 Khi nào chạy `prisma migrate deploy`
- **Không bao giờ trong app start** (nhiều instance cùng lúc → tranh lock; migrate lỗi → app crash-loop; app có quyền DDL thừa).
- Chạy như **job riêng trước rollout**, dùng image `api-migrate` cùng `GIT_SHA`:
  - Prod (C): component job loại PRE_DEPLOY của App Platform ⚠ (kiểm chứng ở PoC) — job lỗi ⇒ không rollout. Nếu PRE_DEPLOY không đáp ứng: workflow GitHub chạy `docker run api-migrate` (kết nối DB qua trusted source/IP) **trước** bước cập nhật app.
  - Staging: `docker compose run --rm migrate` trước `docker compose up -d api web`.
- Dùng `DIRECT_DATABASE_URL` với user `taskflow_migrator` (quyền DDL). App chạy bằng user `taskflow_app` chỉ có DML trên schema (đề xuất — giảm thiệt hại khi bị SQL injection/RCE). ⚠ Prisma 7 đọc URL qua `prisma.config.ts` thay vì `.env` tự động — T-001.
- Migration đã apply **không được sửa**. Muốn sửa → migration mới.

### 4.2 Quy tắc migration an toàn (expand/contract)
Nguyên tắc: **code phiên bản N và N+1 phải cùng chạy được trên schema sau migration** (rolling deploy + rollback app không cần rollback DB).

| Thay đổi | Cách làm đúng |
|---|---|
| Thêm cột | Nullable hoặc có `DEFAULT` hằng (PG 11+ không rewrite bảng). Cột NOT NULL không default: thêm nullable → backfill theo lô → `SET NOT NULL` ở release sau (dùng `CHECK … NOT VALID` + `VALIDATE` để tránh khóa lâu) |
| Đổi tên cột/bảng | **Cấm đổi tên trực tiếp**. Expand: thêm cột mới, ghi cả hai → backfill → đọc cột mới → contract: bỏ cột cũ ở release sau nữa |
| Xóa cột | Release 1: code ngừng dùng (Prisma schema bỏ field). Release 2: migration `DROP COLUMN` |
| Tạo index trên bảng lớn | `CREATE INDEX CONCURRENTLY` trong migration **riêng** (không chạy được trong transaction) ⚠ kiểm tra Prisma 7 có bọc migration trong transaction không |
| Thêm FK | `ADD CONSTRAINT … NOT VALID` rồi `VALIDATE CONSTRAINT` ở migration sau |
| Đổi kiểu cột | Coi như đổi tên (cột mới + backfill) |
| Enum Postgres thêm giá trị | An toàn; **bỏ** giá trị enum = expand/contract |
| SQL tay (collation `"C"`, partial unique index của T-003) | Giữ trong file migration, có comment lý do; test integration kiểm tra index tồn tại |

- Mọi migration đầu file: `SET lock_timeout = '5s'; SET statement_timeout = '15min';` → không giữ hàng đợi lock làm treo cả app; lỗi thì thử lại sau.
- Backfill dữ liệu lớn **không** nằm trong migration — viết script/job riêng, chạy theo lô 1–5k dòng.
- Review checklist cho PR có migration (gắn label `db-migration`, Tech Lead + D duyệt): khóa bảng gì? chạy bao lâu với 1M dòng? code cũ có chạy được không? rollback app có chạy được không?
- CI kiểm tra: `prisma migrate diff` giữa schema và migrations phải rỗng (quên tạo migration ⇒ đỏ); migrate từ DB rỗng lên head thành công.

### 4.3 Backup
| Lớp | Phương án C (đề xuất) | Phương án A (dự phòng) |
|---|---|---|
| PITR | Có sẵn: daily full + WAL, khôi phục mọi thời điểm trong **7 ngày** | WAL-G/pgBackRest đẩy WAL liên tục + base backup hằng ngày sang object storage **khác nhà cung cấp** |
| Logical backup độc lập | Job hằng ngày `pg_dump -Fc` → object storage **ngoài DigitalOcean** (vd Backblaze B2/AWS S3), mã hóa phía client (age/gpg), bucket bật object lock/versioning | như cột trái |
| Thời gian giữ | PITR 7 ngày; logical: 14 bản hằng ngày + 8 bản hằng tuần + 12 bản hằng tháng | như vậy |
| Redis | Không backup (chỉ chứa dữ liệu dựng lại được) | như vậy |

Lý do có logical backup ngoài nhà cung cấp dù đã có PITR: bảo vệ trước xóa nhầm cluster/tài khoản bị chiếm/khóa tài khoản billing — PITR nằm cùng tài khoản nên mất cùng lúc.

**Mục tiêu:** RPO ≤ 5 phút (PITR), ≤ 24h (kịch bản mất tài khoản); RTO ≤ 2 giờ.

### 4.4 Diễn tập restore (bắt buộc — backup chưa từng restore = chưa có backup)
- **Hằng tháng** (và trước go-live), làm theo runbook `docs/runbooks/restore.md` (Phase 5 viết):
  1. PITR: tạo cluster mới từ backup tại thời điểm T−1h (fork). Đo thời gian.
  2. Logical: tải bản `pg_dump` mới nhất từ bucket ngoài, giải mã, `pg_restore` vào Postgres tạm.
  3. Kiểm tra: `prisma migrate status` = up to date; đếm dòng các bảng chính khớp ± sai số; chạy bộ smoke query (đăng nhập user test, đọc board); kiểm tra index collation `"C"` + partial unique còn nguyên.
  4. Ghi kết quả (thời gian, RTO thực tế, lỗi gặp) vào `docs/ops/restore-drills.md`; xóa cluster tạm.
- Job backup logical tự kiểm tra: sau mỗi lần dump, chạy `pg_restore --list` để chắc file không hỏng; job lỗi hoặc không chạy > 26h → cảnh báo (§6.5).

### 4.5 Connection pooling
- Prisma 7 dùng driver adapter (`@prisma/adapter-pg` + `pg.Pool`) ⚠ T-001 xác nhận. Đặt `max = DATABASE_POOL_MAX` (mặc định 10), `idleTimeoutMillis`, `connectionTimeoutMillis = 5000`.
- Ngân sách: `số instance × DATABASE_POOL_MAX + 2 (migrate) + 3 (admin/backup) ≤ giới hạn kết nối của gói PG`. Gói 1 GiB có giới hạn connection thấp ⚠ (đo ở PoC: `SHOW max_connections` trừ phần dự trữ của nhà cung cấp).
- Giai đoạn 1–2 instance: **kết nối thẳng**, không pooler.
- Khi vượt ngân sách: bật pooler (PgBouncer của DO) chế độ transaction cho `DATABASE_URL`; migrate vẫn dùng `DIRECT_DATABASE_URL`. ⚠ Phải kiểm tra interactive transaction + `AsyncLocalStorage` UoW (ADR-012) hoạt động đúng qua pooler transaction mode trước khi bật.
- `statement_timeout` cho user app: 10s (đặt bằng `ALTER ROLE taskflow_app SET statement_timeout = '10s'`) — chặn query chạy lố giữ connection.

---

## 5. CI/CD (GitHub Actions)

### 5.1 Workflow `ci.yml` — chạy trên mọi PR và push `main`
```
setup ──┬── static   (typecheck · lint+depcruise · format check · gitleaks · migrate-diff)
        ├── unit     (vitest unit + coverage threshold)
        ├── integration (vitest integration, services: postgres + redis)
        └── build    (pnpm build mọi package; docker build api/web không push; trivy scan)
                       └── e2e (từ Phase 4: compose prodlike + Playwright)   ← chỉ cần sau khi build xanh
```
Chi tiết:
- **Chung:** `actions/checkout` → `pnpm/action-setup` → `actions/setup-node` với `cache: 'pnpm'` (cache store theo hash `pnpm-lock.yaml`) → `pnpm install --frozen-lockfile`. Mọi action **ghim theo commit SHA** (không `@v4`), `permissions: contents: read` mặc định. `concurrency: ci-${{ github.ref }}` + `cancel-in-progress: true` cho PR.
- **static:** `pnpm typecheck` (tsc `--noEmit` toàn workspace), `pnpm lint` (ESLint gồm `max-lines`, `no-restricted-imports` — ADR-004), `pnpm depcruise` (dependency-cruiser), `prettier --check`, gitleaks, `prisma validate` + `prisma migrate diff --exit-code` (schema ↔ migrations).
- **unit:** `vitest run --project unit --coverage`; ngưỡng ở §8.2 — dưới ngưỡng ⇒ đỏ. Upload báo cáo coverage làm artifact.
- **integration:** `services:` postgres (`<ver: T-001>`, healthcheck `pg_isready`) + redis; `prisma migrate deploy` vào DB template; `vitest run --project integration` (gồm bộ SEC-01…SEC-39 của T-002 khi có code). Timeout job 15 phút.
- **build:** `pnpm build`; `docker buildx build` cả 3 target (`api`, `api-migrate`, `web`) với cache `type=gha`, **không push** trên PR; `trivy image --severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed`.
- **e2e (Phase 4+):** dựng `docker-compose.prodlike.yml` từ image vừa build, seed, chạy Playwright (Chromium trên PR; Chromium + WebKit + Firefox ở nightly). Upload trace/video khi lỗi.
- `pnpm audit --prod --audit-level high` chạy **nightly** (không chặn PR vì CVE mới xuất hiện bất kể PR), mở issue khi đỏ. Dependabot/Renovate cho npm, Docker digest, GitHub Actions.

**Điều kiện chặn merge (required status checks trên `main`):** `static`, `unit`, `integration`, `build` (+ `e2e` từ Phase 4) xanh · ≥ 1 approve (Tech Lead) · branch cập nhật với `main` · không push thẳng `main`, không force-push. PR gắn label `db-migration` cần thêm approve của D.

> ⚠ **Ràng buộc gói GitHub:** branch protection/rulesets cho repo **private** cần GitHub Pro/Team trở lên; **required reviewers và wait timer cho Environment trên repo private chỉ có ở Enterprise** (gói Free/Pro/Team chỉ áp dụng cho repo public — tài liệu GitHub). → Câu hỏi mở Q3. Nếu không có: "duyệt tay" production = workflow `workflow_dispatch` chỉ người có quyền write mới bấm được + bước kiểm tra `github.actor` nằm trong danh sách cho phép (biện pháp mềm, ghi rõ trong runbook).

### 5.2 Workflow `release.yml` — push `main` (sau khi merge)
```
ci (lặp lại các job trên commit merge)
  └─ publish-images: build + push ghcr.io/<owner>/taskflow-{api,api-migrate,web}:<GIT_SHA> (+ :main)
                     ghi lại digest; tạo SBOM + provenance (buildx --sbom --provenance)
        └─ deploy-staging (environment: staging, concurrency: deploy-staging, không cancel giữa chừng)
              1. SSH vào droplet staging (key riêng, chỉ lệnh deploy)
              2. docker compose pull (theo digest) → compose run --rm migrate → compose up -d api web
              3. đợi /readyz xanh (timeout 2 phút) → smoke test (Playwright @smoke ~10 test) chạy từ runner vào staging
              4. lỗi ⇒ redeploy digest trước đó, báo đỏ
```

### 5.3 Workflow `deploy-production.yml` — thủ công
- Trigger: `workflow_dispatch` với input `git_sha` (mặc định: commit mới nhất đã deploy staging xanh). Environment `production` (secret prod chỉ ở đây; bật required reviewers nếu gói hỗ trợ).
- Chặn: commit đó phải có run `release.yml` thành công (bước kiểm tra qua API GitHub) — **không build lại**, deploy đúng digest đã qua staging.
- Các bước: (1) chạy job migrate (§4.1) → (2) cập nhật image digest cho component `api`, `web` (`doctl apps update` với app spec trong repo `.do/app.yaml`) → (3) đợi deployment ACTIVE + `/readyz` → (4) smoke test read-only trên prod (healthz, login user canary, đọc board canary) → (5) tạo git tag `prod-<yyyyMMdd-HHmm>` + GitHub Release ghi chú.
- **Rollback:** chạy lại workflow với `git_sha` cũ. Nhờ expand/contract (§4.2) không cần rollback DB. Migration hỏng dữ liệu ⇒ runbook PITR (§4.4).
- `concurrency: deploy-production`, `cancel-in-progress: false`.
- Khung giờ deploy: ngoài giờ cao điểm người dùng, có người trực theo dõi 30 phút sau deploy.

---

## 6. Observability

### 6.1 Log
- pino JSON ra stdout (không ghi file trong container). Trường chuẩn: `time, level, msg, requestId, userId?, workspaceId?, route, method, statusCode, durationMs, gitSha, appEnv`.
- `requestId`: pino-http lấy `X-Request-Id` nếu là uuid hợp lệ, không thì sinh mới; trả lại ở header response (đã có trong `exposedHeaders` — T-002). Lan truyền qua `AsyncLocalStorage` để log trong use case/repository tự có `requestId`. Socket: mỗi event có `socketId` + `userId`.
- `redact` đúng danh sách T-002 §6.7. Test SEC-33 kiểm tra.
- Không dùng `pino-pretty` ở staging/prod.
- **Nơi gom log:** App Platform giữ log ngắn hạn và có "log forwarding" sang dịch vụ ngoài ⚠ → đề xuất Better Stack (Logtail) hoặc Grafana Cloud Logs, dùng gói free/thấp nhất ở giai đoạn đầu (giá chưa kiểm chứng — Q4). Giữ log ≥ 30 ngày; log sự kiện bảo mật (T-002) ≥ 90 ngày.

### 6.2 Health endpoints (api)
| Endpoint | Kiểm tra | Dùng cho | Trả về |
|---|---|---|---|
| `GET /healthz` | Chỉ tiến trình còn sống (event loop phản hồi) — **không** chạm DB/Redis | liveness, Docker HEALTHCHECK | `200 {status:"ok", gitSha}` |
| `GET /readyz` | `SELECT 1` (timeout 1s) + Redis `PING` (timeout 500ms) + cờ `shuttingDown` | readiness của load balancer, bước chờ deploy | `200 {db:"ok", redis:"ok"\|"degraded"}`; `503` khi DB lỗi **hoặc** đang shutdown |

Quyết định tự đưa ra: **Redis lỗi không làm `/readyz` đỏ** (chỉ báo `degraded` + cảnh báo). Lý do: Redis là dùng chung cho mọi instance; nếu readyz đỏ thì LB rút **toàn bộ** instance → sập hẳn, trong khi T-002 đã thiết kế fallback DB (fail-open API thường, fail-closed login). DB lỗi thì app không làm được gì → đỏ là đúng.
- Hai endpoint không qua rate limit, không log ở mức info (tránh rác log), không lộ chi tiết lỗi.

### 6.3 Error tracking
- Sentry (hoặc tương đương) cho api + web. `release = GIT_SHA`, `environment = APP_ENV`. Upload source map lúc build (CI) nhưng **không** phục vụ source map công khai từ web.
- `beforeSend`: xóa header `authorization`, `cookie`, body của `/auth/*`. Không gửi PII ngoài `userId`.
- Chỉ gửi lỗi 5xx và exception không bắt được; 4xx là hành vi bình thường.

### 6.4 Metrics tối thiểu
`prom-client` expose `/metrics` trên **cổng nội bộ riêng** (vd 9464) không đi qua ingress; nếu nền tảng không cho cổng nội bộ thì đặt sau `Authorization: Bearer METRICS_TOKEN`.
| Metric | Loại | Mục đích |
|---|---|---|
| `http_request_duration_seconds{route,method,status}` | histogram | P95 theo route (ADR-030), tỉ lệ 5xx |
| `socketio_connected_clients` | gauge | tải realtime |
| `socketio_events_emitted_total{type}` / `realtime_broadcast_errors_total` | counter | ADR-012: broadcast fire-and-forget phải nhìn thấy được khi lỗi |
| `db_pool_{total,idle,waiting}` | gauge | cạn pool |
| `redis_fallback_active` | gauge 0/1 | đang chạy chế độ fallback DB (T-002 §2.4) |
| `rate_limit_blocked_total{rule}` | counter | phát hiện brute force |
| `auth_refresh_reuse_detected_total` | counter | sự kiện bảo mật nghiêm trọng |
| `task_rank_retry_total` / `version_conflict_total` | counter | sức khỏe kéo thả (T-003) |
| process default (event loop lag, heap, GC) | | |

Giai đoạn đầu (1 instance) có thể chỉ cần Grafana Cloud Agent/Alloy scrape — hoặc tạm thời ghi metric quan trọng thành log có cấu trúc và dựng dashboard từ log. Chốt ở Q4.

### 6.5 Cảnh báo cần có (go-live)
| Cảnh báo | Điều kiện | Mức |
|---|---|---|
| Uptime | `/readyz` prod từ bên ngoài lỗi 2 lần liên tiếp (check 1 phút) — dịch vụ uptime độc lập nhà cung cấp hosting | Gấp |
| Tỉ lệ 5xx | > 2% trong 5 phút | Gấp |
| P95 | đọc > 300ms hoặc ghi > 600ms trong 15 phút (gấp đôi mục tiêu ADR-030) | Cảnh báo |
| Backup | job backup logical lỗi hoặc không chạy > 26h | Gấp |
| DB | CPU > 80% 15 phút · ổ > 80% · connection > 80% giới hạn | Cảnh báo |
| Redis | không kết nối được > 1 phút (`redis_fallback_active=1`) · memory > 80% | Cảnh báo |
| Bảo mật | `auth_refresh_reuse_detected_total` tăng · `rate_limit_blocked_total{rule="login"}` > 50/5 phút | Cảnh báo |
| Chứng chỉ TLS | hết hạn < 14 ngày (phòng khi auto-renew hỏng) | Cảnh báo |
| Crash loop | instance restart > 3 lần/10 phút | Gấp |
| Sentry | issue mới ở prod | Thông báo |

Kênh nhận: email + 1 kênh chat của người dùng (Q4). Mỗi cảnh báo "Gấp" phải trỏ tới 1 runbook.

---

## 7. Scale ngang, realtime, graceful shutdown

### 7.1 Ngay từ 1 instance phải tuân thủ (để không chặn scale — ADR-000)
- Không state quan trọng trong RAM: rate limit ở Redis (T-002), `tv`/`sid` ở Redis + DB, phiên ở DB. Cache trong RAM chỉ được phép nếu sai lệch giữa instance là vô hại và có TTL ngắn.
- Mọi thao tác thu hồi socket dùng API cấp server (`io.in(room).socketsLeave/disconnectSockets`) — T-002 §5.4 đã yêu cầu.
- Job định kỳ không được chạy trùng khi nhiều instance (§7.4).
- **Client Socket.io dùng `transports: ['websocket']`** ngay từ đầu (đề xuất, cần Engineer E đồng ý): không cần sticky session ở mọi phương án hosting, và hành vi dev = prod. Đánh đổi: mạng chặn WebSocket không kết nối được realtime — FE vẫn dùng được nhờ REST, chỉ mất cập nhật tự động. Ghi nhận ở Q6.

### 7.2 Khi lên ≥ 2 instance
| Việc | Chi tiết |
|---|---|
| Bật `SOCKET_REDIS_ADAPTER=true` | `@socket.io/redis-adapter` (ADR-027), dùng **2 connection Redis riêng** (pub/sub) ngoài connection dùng cho cache/rate-limit. Kiểm tra Managed Valkey hỗ trợ pub/sub đầy đủ ⚠ (adapter sharded cần Redis 7+ `SSUBSCRIBE`) |
| Sticky session | Không cần nếu giữ websocket-only (§7.1). Nếu sau này bật polling → bắt buộc sticky (cookie affinity ở LB) — nền tảng C/B không có ⇒ không được bật polling |
| Rate limit | Đã ở Redis → đúng xuyên instance. Kiểm tra `TRUST_PROXY_HOPS` vẫn đúng sau LB |
| Pool DB | Tính lại ngân sách connection (§4.5), có thể cần pooler |
| Job định kỳ | Advisory lock (§7.4) |
| Test | Integration test 2 instance api cùng Redis: event ghi ở A tới client nối vào B; logout ở A ngắt socket ở B (chạy trong compose prodlike, nightly) |
| Rolling deploy | Readiness đúng (§6.2) + graceful shutdown (§7.3) ⇒ không rớt request |

### 7.3 Graceful shutdown (SIGTERM / SIGINT)
Thứ tự trong `main.ts` (composition root):
1. Nhận SIGTERM → set `shuttingDown = true` → `/readyz` trả 503. Log `shutdown.start`.
2. Đợi `READINESS_DRAIN_MS` (~5s) để LB ngừng gửi request mới tới instance này.
3. `httpServer.close()` — ngừng nhận kết nối mới; HTTP request đang chạy được hoàn tất; `closeIdleConnections()` để keep-alive không giữ chân.
4. Socket.io: `io.local.disconnectSockets(true)` ⚠ (chỉ socket của **instance này**, không phải toàn cụm) → client tự reconnect sang instance khác/instance mới. Không emit gì thêm. Sau đó `io.close()`.
5. Đợi request đang chạy xong (đếm in-flight) hoặc hết hạn chót.
6. Đóng tài nguyên theo thứ tự ngược lúc mở: dừng scheduler job → `prisma.$disconnect()` → Redis adapter pub/sub `quit()` → Redis chính `quit()`.
7. `process.exit(0)`.
- **Hạn chót cứng** `SHUTDOWN_TIMEOUT_MS` (20s): quá hạn → log `shutdown.forced` + `exit(1)`. Phải **nhỏ hơn** thời gian chờ của nền tảng trước SIGKILL (Docker `stop_grace_period` mặc định 10s → đặt 30s trong compose; App Platform ⚠ kiểm chứng).
- Gọi shutdown 2 lần (SIGTERM rồi SIGINT) là no-op.
- `unhandledRejection` / `uncaughtException`: log fatal + gửi Sentry + chạy shutdown với exit code 1 (trạng thái tiến trình có thể đã hỏng — để nền tảng khởi động lại).
- Broadcast realtime sau commit đang dở dang lúc shutdown: chấp nhận mất (fire-and-forget, ADR-012); client reconnect sẽ refetch dữ liệu (T-003 §4.4 quy tắc 6 — FE join lại phòng + refetch board khi reconnect).
- Test: integration test gửi SIGTERM khi đang có request chậm → request vẫn 200, process thoát 0, Prisma/Redis đã đóng.

### 7.4 Job định kỳ
- Hiện có: dọn refresh token hết hạn > 7 ngày (T-002 §2.2), backup logical (§4.3). Sau này có thể có purge task xóa mềm (T-003 Q2).
- Đề xuất: scheduler trong process api (vd `node-cron`/`croner` ⚠ T-001) + **`pg_try_advisory_lock(<hằng số theo job>)`** — chỉ instance lấy được lock chạy; xóa theo lô (`DELETE … WHERE id IN (SELECT … LIMIT 1000)`) lặp đến hết, tránh khóa dài. Log + metric mỗi lần chạy.
- Backup logical **không** chạy trong api (cần `pg_dump`, credential khác) → GitHub Actions `schedule` hằng ngày hoặc job định kỳ của nền tảng.

---

## 8. Chiến lược kiểm thử tổng thể

### 8.1 Kim tự tháp
| Tầng | Công cụ (ADR-003) | Phạm vi | Ước lượng tỉ lệ | Chạy khi |
|---|---|---|---|---|
| Unit | Vitest | domain (entity, value object, state machine, rank, policy), application (use case với fake repo/UoW/clock), contracts (Zod schema), FE logic thuần | ~70% số test | mọi PR, < 1 phút |
| Integration | Vitest + Postgres/Redis thật | repository Prisma, UoW + audit trong transaction (ADR-012), route HTTP qua supertest, middleware auth/RBAC/rate-limit, **bộ IDOR & SEC-01…39**, Socket.io gateway (client thật `socket.io-client`), migration SQL tay | ~25% | mọi PR, < 5 phút |
| E2E | Playwright | 10–20 hành trình chính: đăng ký → tạo task → kéo thả → người thứ 2 thấy realtime; refresh trang giữ phiên; logout-all ngắt tab khác; VIEWER không thấy nút xóa | ~5% | PR (Chromium) từ Phase 4; nightly 3 trình duyệt; smoke sau deploy |
| Tải | k6 | §8.5 | — | thủ công/tuần trước release lớn, Phase 5 |
| Bảo mật | integration (SEC) + ZAP baseline scan vào staging | | | nightly/trước go-live |

Quy tắc: luật nghiệp vụ (bảng R1…R16 của T-003, ma trận RBAC ADR-022) **phải** có test ở tầng thấp nhất kiểm được nó; luật có hệ quả bảo mật (tenant, quyền) **còn phải** có thêm integration test đi qua HTTP thật. Mỗi bug fix kèm test tái hiện.

### 8.2 Ngưỡng coverage (Vitest `coverage.thresholds` theo glob)
| Vùng | Lines/Statements | Branches |
|---|---|---|
| `apps/api/src/**/domain/**` | ≥ 90% | ≥ 85% |
| `apps/api/src/**/application/**` | ≥ 80% | ≥ 75% |
| `packages/contracts/**` | ≥ 80% | — |
| Infra/adapter (`**/infrastructure/**`, routes) | không đặt ngưỡng — đo bằng integration test, không phải số % | |
| `apps/web` | Phase 4 quyết (T-005) | |
Ticket yêu cầu domain/application ≥ 80%; mình đề xuất domain cao hơn vì code thuần, rẻ để test. Coverage không thay được việc review test có assert ý nghĩa — PR review kiểm tra.

### 8.3 DB test cô lập
- Một Postgres test (compose `postgres-test` local; `services` trong CI).
- `globalSetup` của Vitest integration: `prisma migrate deploy` vào DB `taskflow_template` **một lần**.
- Mỗi worker Vitest: `CREATE DATABASE taskflow_w<N> TEMPLATE taskflow_template` (nhanh, vài trăm ms) → mỗi worker một DB riêng → chạy song song không giẫm chân. Redis: mỗi worker một `keyPrefix` `test:w<N>:` (hoặc DB index riêng).
- Giữa các test file: `TRUNCATE … RESTART IDENTITY CASCADE` toàn bộ bảng nghiệp vụ (danh sách lấy tự động từ `pg_tables`, trừ `_prisma_migrations`). Không dùng "rollback transaction sau mỗi test" vì code dưới test tự mở transaction (UoW) và realtime phát **sau commit** — cần commit thật để test đúng ADR-012.
- Không mock Prisma trong integration test. Thời gian: dùng clock tiêm vào (ADR-016) thay vì fake timer toàn cục.

### 8.4 Seed dữ liệu
- **Factory** trong `apps/api/test/factories/` (builder hàm: `aUser()`, `aWorkspace({ owner })`, `aTask({ project, status })`) dùng cho integration — mỗi test tự tạo dữ liệu nó cần, không phụ thuộc seed chung.
- **Fixture bảo mật cố định** theo T-002 §7: ws A (Alice OWNER, Pam PM, Mia MEMBER, Vic VIEWER), ws B (Bob OWNER) — helper `seedSecurityFixture()`.
- `pnpm db:seed` (dev/E2E): dữ liệu demo nhỏ, idempotent, mật khẩu đã băm sẵn (bcrypt cost 12 làm seed chậm → cho phép `BCRYPT_COST=4` **chỉ khi** `APP_ENV=test|local`, env schema chặn ở prod).
- `pnpm db:seed:load` (staging, k6): 50 workspace × 5 project × ~400 task (~100k task), audit log tương ứng → đo P95 trên dữ liệu cỡ thật, không phải bảng rỗng.
- Seed **không bao giờ** chạy được khi `APP_ENV=production` (kiểm tra cứng).

### 8.5 Playwright & k6
**Playwright** chạy ở: (1) CI trên stack `docker-compose.prodlike.yml` (đúng image prod, cookie `Secure` qua Caddy TLS nội bộ — để test được `__Secure-` cookie; ⚠ cần CA tự ký tin cậy trong runner) ; (2) staging sau mỗi deploy (`@smoke`); (3) prod sau deploy: chỉ `@smoke-readonly` với tài khoản canary. Test cô lập dữ liệu bằng cách mỗi test tự đăng ký user/workspace mới qua API (không dùng chung user).

**k6** (chạy từ máy/runner gần region staging, không chạy vào prod):
| Kịch bản | Tải | Ngưỡng (ADR-030) |
|---|---|---|
| `read-board`: `GET tasks` theo project (list + filter), `GET task`, `GET audit-logs` | ramp 0 → 50 VU trong 2 phút, giữ 10 phút | `http_req_duration{kind:read}` p(95) < 150ms, lỗi < 0.5% |
| `write-mix`: tạo task, PATCH (có `expectedVersion`), move (đổi rank/cột), assign | 20 VU, 10 phút, cùng project để có tranh chấp | `{kind:write}` p(95) < 300ms; 409 `VERSION_CONFLICT` được đếm riêng, không tính là lỗi |
| `hot-column`: nhiều VU cùng thả vào 1 khe | 30 VU, 3 phút | không 500; retry rank (T-003) giữ tỉ lệ 409 `RESOURCE_CONFLICT` < 1% |
| `realtime-fanout`: 200 kết nối socket join cùng project, 1 VU ghi | 10 phút | độ trễ event (đo `occurredAt` → nhận) p(95) < 500ms ⚠ k6 nói giao thức WebSocket thô, không phải Socket.io — cần client Node riêng hoặc extension; Phase 5 quyết |
| `auth` (riêng, **không** tính vào ADR-030) | 5 VU login | theo dõi CPU bcrypt, kiểm tra rate limit trả 429 đúng |
Mỗi request gắn tag `kind`; k6 xuất kết quả JSON làm artifact. Điều kiện chạy: staging cùng cỡ instance với prod, đã `db:seed:load`, tắt rate limit **chỉ** cho IP runner k6 (allowlist qua env staging) để không đo nhầm 429.

---

## 9. Checklist go-live
Mỗi mục phải có người ký xác nhận + bằng chứng (link log/ảnh/run CI) trong `docs/ops/go-live.md`.

**Mạng & HTTPS**
1. ☐ HTTPS cho `app.` và `api.`; HTTP → 301 HTTPS; HSTS bật (bắt đầu `max-age` ngắn, tăng dần; chưa `preload`).
2. ☐ TLS ≥ 1.2, chứng chỉ auto-renew + cảnh báo hết hạn hoạt động.
3. ☐ FE và API cùng registrable domain (ADR-029); WebSocket `wss://` kết nối được qua ingress thật, giữ được > 10 phút không rớt.
4. ☐ `TRUST_PROXY_HOPS` đã **đo**: log `req.ip` khớp IP thật của máy test; gửi `X-Forwarded-For` giả không đổi được `req.ip`.

**Bảo mật ứng dụng**
5. ☐ Cookie refresh prod: `__Secure-tf_rt; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, không `Domain` (SEC-34 chạy trên staging).
6. ☐ `CORS_ORIGINS` chỉ chứa `https://app.<domain>`; origin lạ không nhận `Access-Control-Allow-Origin` (SEC-30).
7. ☐ Rate limit bật, dùng Redis store; thử 6 lần login sai → 429 (SEC-28) trên staging.
8. ☐ helmet header có mặt (kiểm bằng securityheaders hoặc curl); CSP web nonce-based, không `unsafe-inline`.
9. ☐ Toàn bộ bộ SEC-01…SEC-39 + test IDOR xanh trên commit sẽ deploy.
10. ☐ ZAP baseline scan staging: không có cảnh báo High.
11. ☐ Log prod không chứa password/token/cookie (grep log staging sau khi chạy E2E — SEC-33).

**Secret & truy cập**
12. ☐ Secret prod sinh mới, khác staging/local; không có trong git (gitleaks toàn lịch sử xanh); `.env.example` không chứa giá trị thật.
13. ☐ Đã diễn tập xoay `JWT_ACCESS_SECRET` trên staging (không rớt phiên).
14. ☐ DB/Redis chỉ nhận kết nối từ app (trusted sources/VPC), không mở public; Redis dùng TLS + mật khẩu.
15. ☐ App dùng user DB `taskflow_app` (không phải owner/superuser); migrate dùng `taskflow_migrator`.
16. ☐ Tài khoản hosting, GitHub, registry, Sentry bật 2FA; quyền prod chỉ người dùng + Tech Lead.

**Dữ liệu**
17. ☐ PITR bật; backup logical hằng ngày sang storage ngoài nhà cung cấp chạy ≥ 3 ngày liên tiếp.
18. ☐ **Đã diễn tập restore thành công** (cả PITR và logical), RTO đo được ≤ 2h, ghi vào `restore-drills.md`.
19. ☐ `prisma migrate status` prod = up to date; collation `"C"` + partial unique index có mặt.
20. ☐ Seed không chạy được ở prod (đã thử, bị chặn).

**Vận hành**
21. ☐ `/healthz`, `/readyz` hoạt động; health check của nền tảng trỏ đúng.
22. ☐ Graceful shutdown: deploy lại trong lúc chạy k6 nhẹ → 0 request 5xx.
23. ☐ Uptime monitor ngoài + mọi cảnh báo §6.5 đã cấu hình và **đã bắn thử** (tới đúng người).
24. ☐ Sentry nhận lỗi thử từ prod với đúng `release`, không có PII.
25. ☐ Log tập trung, tìm được theo `requestId`.
26. ☐ k6 trên staging đạt ADR-030 (đọc P95 < 150ms, ghi < 300ms) với dữ liệu `seed:load`.
27. ☐ Rollback đã diễn tập: deploy SHA cũ trên staging thành công < 10 phút.
28. ☐ Job dọn refresh token chạy đúng 1 lần/ngày (log + advisory lock).
29. ☐ Runbook có sẵn: restore DB, rollback, xoay secret, thu hồi mọi phiên, Redis sập, sự cố bảo mật (ai liên hệ ai).
30. ☐ Branch protection + required checks bật trên `main` (hoặc biện pháp thay thế đã ghi nếu gói GitHub không hỗ trợ — Q3).

---

## 10. Câu hỏi mở (cho Tech Lead / người dùng)
- **Q1 (tiền):** Chốt phương án C (≈ $55–70/tháng prod + ~$12 staging) hay dự phòng A (≈ $36 + công vận hành)? Người dùng chủ yếu ở đâu (để chọn region Singapore)?
- **Q2:** Đã có domain chưa? Cần `app.` / `api.` / `staging.` cùng registrable domain (ADR-029).
- **Q3:** Repo GitHub public hay private, gói gì? Ảnh hưởng branch protection và duyệt tay production (§5.1). Nếu private + Free: cân nhắc nâng Team, hoặc chấp nhận biện pháp mềm.
- **Q4:** Chọn dịch vụ gom log / metrics / uptime / kênh nhận cảnh báo (email, Telegram, Slack…). Ngân sách cho phần này?
- **Q5 (Engineer E):** Web nhận `API_URL` lúc runtime thay vì `NEXT_PUBLIC_*` lúc build — đồng ý không? Ảnh hưởng render tĩnh của shell.
- **Q6 (Engineer E + B):** Socket.io client chỉ dùng `transports: ['websocket']`?
- **Q7 (Engineer B):** Đồng ý readyz không đỏ khi Redis lỗi (§6.2)? Đồng ý tách user DB `taskflow_app`/`taskflow_migrator`?
- **Q8 (T-001):** Các điểm ⚠ phụ thuộc phiên bản: Prisma 7 (config file, driver adapter, migration có bọc transaction không, còn binary engine không), pnpm `deploy`, Next 16 standalone, Valkey vs Redis cho adapter.

## Nguồn (truy cập 2026-10-15)
- Hetzner — điều chỉnh giá từ 15/06/2026 (CX23 €5.49, CX33 €8.49, CPX22 €19.49, CPX32 €35.49, CAX11 €5.99): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner Cloud — trạng thái "Currently not available" của dòng Cost-Optimized: https://www.hetzner.com/cloud/ · CPX: https://www.hetzner.com/cloud/regular-performance/
- Hetzner backup (7 slot/ngày, không gồm volume): https://docs.hetzner.com/de/cloud/servers/backups-snapshots/faq/
- Bối cảnh các đợt tăng giá Hetzner 2026 (nguồn thứ cấp): https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/ , https://northflank.com/blog/hetzner-cloud-server-price-increases
- DigitalOcean Droplets (2 GiB $12, 4 GiB/2 vCPU $24; backup tuần 20%, ngày 30%): https://www.digitalocean.com/pricing/droplets
- DigitalOcean Managed Databases (PostgreSQL 1 GiB $15.15, Valkey 1 GiB $15): https://www.digitalocean.com/pricing/managed-databases · Valkey: https://docs.digitalocean.com/products/databases/valkey/details/pricing/
- DigitalOcean PostgreSQL — daily backup + WAL, PITR 7 ngày: https://docs.digitalocean.com/products/databases/postgresql/details/features/
- DigitalOcean App Platform — giá container: https://docs.digitalocean.com/products/app-platform/details/pricing/ · giới hạn: https://docs.digitalocean.com/products/app-platform/details/limits/
- Railway (tham khảo, không đưa vào bảng): Hobby $5, Pro $20 (đã gồm credit), RAM $10/GB, vCPU $20/tháng: https://docs.railway.com/reference/pricing/plans
- Render — **chỉ nguồn thứ cấp**, trang chính thức không đọc được giá (⚠): https://temps.sh/blog/render-pricing-2026 , https://livemy.app/blog/render-pricing , https://render.com/pricing
- GitHub — required reviewers/wait timer chỉ cho repo public ở Free/Pro/Team: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- Socket.io — sticky session chỉ cần khi có HTTP long-polling: https://socket.io/docs/v4/using-multiple-nodes/ (⚠ chưa mở lại trong phiên này, dựa trên hiểu biết về tài liệu v4)
- Next.js `output: 'standalone'` (phải tự copy `.next/static`, `public`; `outputFileTracingRoot` cho monorepo): https://nextjs.org/docs/app/api-reference/config/next-config-js/output (⚠ đối chiếu lại với Next 16 — T-001)
