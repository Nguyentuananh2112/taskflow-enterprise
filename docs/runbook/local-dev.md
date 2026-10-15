# Runbook — Chạy TaskFlow trên máy dev Windows (từ máy trắng)

Áp dụng cho: Windows 10/11, chạy lệnh trong **PowerShell** (hoặc Git Bash nếu có ghi chú). Nguồn: `docs/design/devops.md`, ADR-060/061/065/070/072.

## 1. Cài công cụ (một lần)

| Công cụ | Phiên bản | Cài bằng |
|---|---|---|
| Git for Windows | mới nhất | `winget install --id Git.Git -e` — **bắt buộc**: git hook (lefthook) chạy bằng `sh` của Git for Windows |
| Node.js | **24.22.0** (đúng `.nvmrc`) | xem mục 1.1 |
| pnpm | **11.28.2** (theo `packageManager`) | qua corepack — mục 1.2 |
| Docker Desktop | mới nhất, backend WSL 2 | `winget install --id Docker.DockerDesktop -e`, khởi động lại máy, mở Docker Desktop |
| gitleaks | **8.30.1** | mục 1.3 — **bắt buộc**, thiếu thì không commit được (ADR-072) |

### 1.1 Node 24.22.0
Repo khóa `engines.node: 24.x` và `.nvmrc = 24.22.0`. Máy đang có Node cũ hơn (vd 24.18.0) vẫn cài được nhưng phải nâng để giống CI/Docker:
Lưu ý: ngày 2026-10-15, winget (`OpenJS.NodeJS.LTS`) mới có tới 24.20.0. Dùng một trong hai cách:
```powershell
node -v                                   # nếu khác v24.22.0 thì nâng:
# Cách A (khuyến nghị) — fnm, tải Node từ nodejs.org, đổi phiên bản theo .nvmrc:
winget install --id Schniz.fnm -e
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression   # thêm dòng này vào $PROFILE
fnm install 24.22.0; fnm use 24.22.0
# Cách B — file cài chính thức: https://nodejs.org/dist/v24.22.0/node-v24.22.0-x64.msi
#          (kiểm SHA256 với https://nodejs.org/dist/v24.22.0/SHASUMS256.txt)
```
Mở terminal mới rồi kiểm tra `node -v` → `v24.22.0`. Với fnm, `corepack enable pnpm` phải chạy lại sau mỗi lần cài bản Node mới.

### 1.2 pnpm qua corepack
```powershell
corepack enable pnpm      # cần quyền ghi thư mục cài Node (PowerShell "Run as Administrator" nếu Node cài ở Program Files)
pnpm -v                   # → 11.28.2 (corepack đọc "packageManager" trong package.json)
```
Không có quyền admin: dùng `corepack pnpm <lệnh>` thay cho `pnpm <lệnh>` ở mọi chỗ trong tài liệu này.
**Không** cài pnpm bằng `npm i -g pnpm` (dễ lệch phiên bản; pnpm 12 là bản viết lại khác hẳn).

### 1.3 gitleaks 8.30.1
```powershell
winget install --id Gitleaks.Gitleaks -e --version 8.30.1
gitleaks version          # → 8.30.1
```
Nếu winget không có đúng bản: tải `gitleaks_8.30.1_windows_x64.zip` từ https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1, **kiểm checksum** với `gitleaks_8.30.1_checksums.txt` (`Get-FileHash .\gitleaks_8.30.1_windows_x64.zip -Algorithm SHA256`), giải nén `gitleaks.exe` vào một thư mục trong `PATH`.

## 2. Lấy code và cài dependency
```powershell
git clone <repo-url> TaskFlow_Enterprise
cd TaskFlow_Enterprise
pnpm install              # cũng cài git hook (lefthook) qua script "prepare"
```
- pnpm 11 không cài bản phát hành < 24h (`minimumReleaseAge`) và chặn install script ngoài danh sách `allowBuilds` — lỗi kiểu `ERR_PNPM_IGNORED_BUILDS` nghĩa là có gói mới cần Tech Lead duyệt vào `allowBuilds`, **không** tự chạy `pnpm approve-builds`.
- Git worktree dùng chung thư mục hook với repo chính → chỉ cần cài một lần.

## 3. Hạ tầng local (Postgres 18.6 + Valkey 9.1.2)
Mở Docker Desktop trước (biểu tượng cá voi chuyển xanh).
```powershell
pnpm infra:up             # postgres :5435, postgres-test :5434 (RAM, cho test), valkey :6380 — đợi healthy
docker compose ps         # mọi service "healthy"
```
- **Cổng host riêng (ADR-097)**: máy dev có thể chạy dự án khác chiếm 5432/6379/3000, nên TaskFlow dùng Postgres 5435, Postgres test 5434, Valkey 6380, web 3001, API 4000. Bên trong mạng Docker vẫn là 5432/6379. Đổi bằng file `.env` ở gốc. **Không** dừng/sửa container của dự án khác.
- Lần đầu, script `docker/postgres/init/01-roles.sh` tạo 2 user: `taskflow_migrator` (DDL, chạy migrate) và `taskflow_app` (chỉ DML — app dùng). Mật khẩu mặc định chỉ cho máy dev, đổi được bằng file `.env` ở gốc (mẫu: `.env.example`).
- **Postgres 18 lưu dữ liệu ở volume `/var/lib/postgresql`** (khác ≤17). Muốn làm lại từ đầu (xóa sạch DB + chạy lại init script): `pnpm infra:reset` rồi `pnpm infra:up`.
- Hộp thư giả (chưa dùng ở v1): `docker compose --profile mail up -d mailpit` → http://localhost:8025.

## 4. Biến môi trường
```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```
Giá trị mẫu chạy được ngay với compose. **Không bao giờ commit** `.env`/`.env.local` (đã có trong `.gitignore`, gitleaks chặn thêm một lớp).

## 5. Migrate, seed, integration test
Luôn `pnpm exec prisma …` hoặc script `db:*`, **không** `npx` (ADR-061 — `npx` kéo Prisma 8 RC).
Migrate/seed phải chạy bằng user `taskflow_migrator` (app dùng `taskflow_app`, không có quyền DDL). `prisma.config.ts` đọc `DATABASE_URL` và chỉ nạp `apps/api/.env` cho biến **chưa có** trong môi trường ⇒ đặt tạm biến trong shell:
```powershell
$env:DATABASE_URL = 'postgresql://taskflow_migrator:migrator_local_only@127.0.0.1:5435/taskflow'   # mật khẩu theo .env gốc nếu đã đổi
pnpm --filter @taskflow/api db:deploy        # áp migration có sẵn (lần đầu / sau khi pull)
pnpm --filter @taskflow/api db:seed          # dữ liệu demo
pnpm --filter @taskflow/api db:migrate       # chỉ khi sửa schema: tạo migration mới
pnpm --filter @taskflow/api db:check-drift   # schema.prisma ↔ DB phải khớp (CI cũng chạy)
Remove-Item Env:DATABASE_URL
```
Integration test chạy trên **postgres-test** (cổng 5434). **Harness xóa sạch schema `public` của DB này** — không bao giờ trỏ vào DB dev:
```powershell
$env:DATABASE_URL_TEST = 'postgresql://taskflow_migrator:migrator_local_only@127.0.0.1:5434/taskflow_template'
pnpm --filter @taskflow/api test:integration
Remove-Item Env:DATABASE_URL_TEST
```

## 6. Chạy ứng dụng
```powershell
pnpm dev                  # api http://localhost:4000 (GET /healthz) + web http://localhost:3001
```

## 7. Kiểm tra trước khi đẩy code (Definition of Done)
```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm test }; if ($?) { pnpm build }
```
Commit sẽ tự chạy hook pre-commit: **gitleaks** (quét secret phần staged), **prettier** (tự format + add lại), **eslint** (file staged). Hook đỏ ⇒ sửa rồi commit lại; không dùng `--no-verify`.

## 8. Image Docker (như CI)
```powershell
pnpm docker:build                     # taskflow-api:dev + taskflow-web:dev (build từ gốc repo)
Get-Content docker/verify-argon2.mjs | docker run --rm -i taskflow-api:dev node --input-type=module -
docker run --rm -p 4000:4000 taskflow-api:dev    # rồi mở http://localhost:4000/healthz
docker run --rm -p 3001:3000 -e API_URL=http://localhost:4000/api/v1 taskflow-web:dev   # mở http://localhost:3001
```
(`pnpm docker:verify-argon2` dùng chuyển hướng `<` — chạy được trong Git Bash; PowerShell dùng dòng `Get-Content … |` ở trên.)

## 9. Sự cố thường gặp
| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `failed to connect to the docker API … dockerDesktopLinuxEngine` | Docker Desktop chưa chạy — mở Docker Desktop, đợi xanh |
| `Unsupported engine` khi `pnpm install` | Node không phải 24.x — mục 1.1 |
| `pnpm` không nhận lệnh | chưa `corepack enable pnpm` — mục 1.2, hoặc dùng `corepack pnpm` |
| Commit bị chặn "Thiếu gitleaks" | cài gitleaks — mục 1.3 |
| gitleaks báo leak ở file của bạn | **coi như secret đã lộ nếu đã push**: xoay secret, rồi xóa khỏi commit; giá trị giả cho mẫu thì đặt hậu tố `_local_only` |
| `port is already allocated` | cổng host đã bị chiếm (`docker ps` để xem) — đặt `POSTGRES_PORT` / `POSTGRES_TEST_PORT` / `VALKEY_PORT` khác trong `.env` gốc và sửa URL tương ứng trong `apps/api/.env` |
| Init script không chạy lại sau khi sửa | init chỉ chạy khi volume trống — `pnpm infra:reset` |
