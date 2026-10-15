# Runbook — Chạy TaskFlow trên máy dev Windows (từ máy trắng)

Áp dụng cho: Windows 10/11, chạy lệnh trong **PowerShell** (hoặc Git Bash nếu có ghi chú). Nguồn: `docs/design/devops.md`, ADR-060/061/065/070/072.

## 1. Cài công cụ (một lần)

| Công cụ         | Phiên bản                           | Cài bằng                                                                                                |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Git for Windows | mới nhất                            | `winget install --id Git.Git -e` — **bắt buộc**: git hook (lefthook) chạy bằng `sh` của Git for Windows |
| Node.js         | **24.22.0** (đúng `.nvmrc`)         | xem mục 1.1                                                                                             |
| pnpm            | **11.28.2** (theo `packageManager`) | qua corepack — mục 1.2                                                                                  |
| Docker Desktop  | mới nhất, backend WSL 2             | `winget install --id Docker.DockerDesktop -e`, khởi động lại máy, mở Docker Desktop                     |
| gitleaks        | **8.30.1**                          | mục 1.3 — **bắt buộc**, thiếu thì không commit được (ADR-072)                                           |

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
- Git worktree dùng chung thư mục hook với repo chính → chỉ cần cài một lần. Worktree chưa `pnpm install` thì hook in "Can't find lefthook in PATH" rồi **cho qua** — CI (job `gitleaks`) vẫn là lớp chặn bắt buộc.

- **Repo đặt `verifyDepsBeforeRun: error`** (pnpm-workspace.yaml): `node_modules` lệch lockfile (vd sau `git pull`/rebase) ⇒ `pnpm test`/`pnpm lint`/`pnpm run …` dừng ngay với `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN … Run "pnpm install"` — **pnpm không tự cài** (mặc định pnpm 11 tự cài, gây tranh khóa store/treo trên máy chung). Gặp lỗi đó: chạy `pnpm install` rồi chạy lại. Git hook gọi thẳng `node_modules/.bin/*`, không qua pnpm.
- **Một lệnh như CI:** `pnpm verify` (lint gồm `.env.example` ↔ `env.ts`, typecheck, test, audit; thêm `VERIFY_DB_URL=<DB riêng của bạn trên postgres-test, user migrator>` để chạy cả migrate + grant + drift). Chạy hết các bước rồi in bảng exit code; chỉ tin exit code.

### 2.1 Cài chậm trên Windows — nguyên nhân đo được và cách xử lý (T-022)

Đo trên máy dev ngày 2026-10-15 (12 luồng, 32 GB RAM, nhiều phiên agent chạy song song, Docker Desktop đang build):

| Lần cài (`--frozen-lockfile`, ~800 gói)            | Store                    | Cách nhập file                                     | Thời gian       |
| -------------------------------------------------- | ------------------------ | -------------------------------------------------- | --------------- |
| Bản sao repo trên C:, `--offline --ignore-scripts` | `D:.pnpm-store` (khác ổ) | **copy**                                           | 37 phút 46 giây |
| Worktree T-022 trên D:                             | `D:.pnpm-store` (cùng ổ) | **hardlink** (đã kiểm bằng `fsutil hardlink list`) | ~41 phút        |

Kết luận: **pnpm 11 đã tự dùng store cùng ổ** (`D:.pnpm-store`) khi store mặc định ở C: không hardlink được (cảnh báo "store … is not used because packages cannot be hard linked … Using the store at D:.pnpm-store"). Hardlink vẫn chậm ⇒ nút thắt là **tải chung của máy**, không phải copy/hardlink:

- **Microsoft Defender** quét từng file mới ghi vào `node_modules` (MsMpEng luôn bận khi cài).
- **Hết RAM/commit**: `vmmemWSL` (Docker Desktop) ~8,4 GB; khi commit trống < 4 GB, Git Bash chết với `Win32 error 1455` (paging file).
- **Nhiều phiên cài cùng lúc** tranh nhau một store và một ổ đĩa.

Cách xử lý (**không tự đổi cấu hình máy**):

1. Loại trừ Defender / Dev Drive / đóng bớt ứng dụng: **đã cân nhắc, người dùng không chọn** — giảm tải bằng quy trình (mục 3 và E2E/integration nặng chạy một lượt một lúc).
2. Giới hạn RAM cho Docker Desktop/WSL (`%UserProfile%.wslconfig`: `[wsl2] memory=6GB`), tắt container không dùng.
3. **Không cài nhiều worktree cùng lúc** (store `index.db` là SQLite, cài song song bị treo) — xếp hàng; worktree mới có thể tái dùng `node_modules` bằng `pnpm install --offline` sau khi store đã đủ gói.
4. Ghi rõ store (không bắt buộc, chỉ để khỏi phụ thuộc cơ chế tự chọn): `pnpm config set store-dir D:.pnpm-store --location global`. Không ghi `store-dir` vào `pnpm-workspace.yaml` (đường dẫn phụ thuộc máy).

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

> **Cấm chạy app (API) bằng `taskflow_migrator`** — kể cả "sửa nhanh" khi gặp `permission denied for table …`. App luôn dùng `taskflow_app` (chỉ DML). Lỗi quyền sau migrate nghĩa là bước grant chưa chạy: `db:deploy` (và image migrate) = `migrate deploy` **+** `docker/migrate/grant-app.sql` (cấp DML cho `taskflow_app` trên mọi bảng/sequence, đặt default privileges, thu hồi CREATE). DB tạo sau init (vd `taskflow_<ticket>`) cũng chỉ cần chạy `db:deploy` một lần. Gọi `prisma migrate deploy` trần sẽ **không** grant.

Đặt một lần cho phiên PowerShell (CI/Docker đã đặt sẵn): Prisma CLI không gọi mạng kiểm tra phiên bản/telemetry — trên mạng chậm có thể treo 120 s+ làm migrate/test đỏ oan (T-022):

```powershell
$env:CHECKPOINT_DISABLE = '1'; $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
```

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

Postgres-test (cổng 5434) dùng chung ⇒ **mỗi người/việc một DB riêng** (ADR-106, TEAM.md). Harness integration và suite bảo mật đều **xóa schema `public`** của DB đích; cấm trỏ vào `taskflow_template` hoặc DB dev (5435):

| DB                                       | Dùng cho                                         | Ghi chú                                                                        |
| ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `taskflow_it`                            | `test:integration` mặc định (CI cũng dùng)       | init script tạo sẵn (`TASKFLOW_EXTRA_DBS`)                                     |
| `taskflow_<ticket>` (vd `taskflow_t020`) | integration của từng engineer khi chạy song song | tự tạo: `CREATE DATABASE taskflow_t020` bằng `taskflow_migrator` (có CREATEDB) |
| `taskflow_sec`                           | suite bảo mật `test:security`                    | harness tự tạo + migrate, giữ khóa advisory để 2 lần chạy không giẫm nhau      |

```powershell
# Integration — Valkey phải ghi RÕ db 1–15 riêng (lượt chạy FLUSHDB db đó; db 0 bị từ chối)
$env:DATABASE_URL_TEST = 'postgresql://taskflow_migrator:migrator_local_only@127.0.0.1:5434/taskflow_it'
$env:VALKEY_URL_TEST = 'redis://127.0.0.1:6380/3'
pnpm --filter @taskflow/api test:integration
Remove-Item Env:DATABASE_URL_TEST, Env:VALKEY_URL_TEST

# Suite bảo mật (mặc định đã trỏ postgres-test 5434 / Valkey 6380 db 15 / DB taskflow_sec)
pnpm --filter @taskflow/api test:security
```

> **Integration luôn tuần tự, một lượt một DB.** Mọi file dùng chung DB đích ⇒ config ép `maxWorkers: 1` và **xóa `VITEST_MAX_WORKERS`** (biến này thắng `fileParallelism: false` — từng gây 40P01 TRUNCATE deadlock, P2002/P2003, rank trùng, register→login 401). Không truyền `--maxWorkers` cho `test:integration` (setupFile `serial-guard.ts` làm đỏ ngay nếu 2 file chạy chồng). `globalSetup` giữ **khóa advisory** theo DB Postgres đích + Valkey db suốt lượt: lượt thứ hai cùng DB/Valkey db **chờ** tối đa `INTEGRATION_LOCK_WAIT_MS` (mặc định 600000; `0` = từ chối ngay) rồi **từ chối** mà không chạy test nào.

Compose tạo trước T-022 chưa có `taskflow_it`: `docker compose exec -T -e PGPASSWORD=migrator_local_only postgres-test psql -h 127.0.0.1 -U taskflow_migrator -d postgres -c 'CREATE DATABASE taskflow_it'` (không cần recreate).

> Suite bảo mật xóa bộ đếm Valkey **db 15**: hai người chạy cùng lúc trên Valkey dùng chung sẽ làm `rate-limit.sec.ts` đỏ oan — đặt `SEC_REDIS_URL=redis://127.0.0.1:6380/<db riêng>` hoặc chạy lần lượt.

Mutation test (Stryker, chậm — CI chạy hằng tuần, workflow `Mutation (weekly)`): `pnpm --filter @taskflow/api mutation:<nhóm>` (vd `mutation:core-http`), báo cáo ở `apps/api/coverage/mutation/`.

## 6. Chạy ứng dụng

```powershell
pnpm dev                  # api http://localhost:4000 (GET /healthz) + web http://localhost:3001
```

## 7. Kiểm tra trước khi đẩy code (Definition of Done)

> **Luôn xét EXIT CODE, không đọc chữ** (T-022). Khi máy quá tải, Vitest có thể in `Test Files … passed` kèm `Unhandled Errors` / `Failed to start forks worker` — các file không khởi động được **không được đếm** trong dòng "passed", nhưng exit code = 1. PowerShell: `$LASTEXITCODE`; Git Bash: `$?`. Mặc định 4 worker (`vitest.config.ts`); máy đang bận thì `$env:VITEST_MAX_WORKERS = '2'` — **chỉ có tác dụng cho unit** (`pnpm test`); `test:integration` bỏ qua biến này và luôn chạy 1 file một lúc (§5).

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

| Triệu chứng                                                      | Nguyên nhân / cách xử lý                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `failed to connect to the docker API … dockerDesktopLinuxEngine` | Docker Desktop chưa chạy — mở Docker Desktop, đợi xanh                                                                                                                   |
| `Unsupported engine` khi `pnpm install`                          | Node không phải 24.x — mục 1.1                                                                                                                                           |
| `pnpm` không nhận lệnh                                           | chưa `corepack enable pnpm` — mục 1.2, hoặc dùng `corepack pnpm`                                                                                                         |
| Commit bị chặn "Thiếu gitleaks"                                  | cài gitleaks — mục 1.3                                                                                                                                                   |
| gitleaks báo leak ở file của bạn                                 | **coi như secret đã lộ nếu đã push**: xoay secret, rồi xóa khỏi commit; giá trị giả cho mẫu thì đặt hậu tố `_local_only`                                                 |
| `port is already allocated`                                      | cổng host đã bị chiếm (`docker ps` để xem) — đặt `POSTGRES_PORT` / `POSTGRES_TEST_PORT` / `VALKEY_PORT` khác trong `.env` gốc và sửa URL tương ứng trong `apps/api/.env` |
| Init script không chạy lại sau khi sửa                           | init chỉ chạy khi volume trống — `pnpm infra:reset`                                                                                                                      |
