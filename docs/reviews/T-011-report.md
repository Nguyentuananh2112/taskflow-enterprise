# T-011 — Báo cáo: Docker local/production + GitHub Actions CI + quét secret

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/T-011` · **Ngày:** 2026-10-15
**Căn cứ:** ticket T-011 (+ mục Bổ sung), devops.md, ADR-060–065, 070–074, 097 (sửa đổi: dev 5435 / test 5434 / Valkey 6380 / web 3001 / API 4000), 098.

## File
| File | Nội dung |
|---|---|
| `docker-compose.yml` | `name: taskflow`; postgres 18.6-bookworm (volume `/var/lib/postgresql`, host **5435**), postgres-test (tmpfs, fsync off, DB `taskflow_template`, host **5434**), valkey 9.1.2 (noeviction, không persistence, host **6380**), mailpit (profile `mail`). Mọi image ghim tag + digest; cổng chỉ bind 127.0.0.1, đổi được qua `.env` gốc |
| `docker/postgres/init/01-roles.sh` | Tạo `taskflow_migrator` (owner DB/schema, CREATEDB cho shadow DB) + `taskflow_app` (chỉ DML qua DEFAULT PRIVILEGES, `statement_timeout 10s`). Dùng chung cho compose **và** CI |
| `docker/verify-argon2.mjs` | Kiểm argon2id trong image: định dạng PHC đúng tham số OWASP, verify đúng/sai, không cắt 72 byte, đo thời gian |
| `docker/smoke-api.sh` | Smoke image api với Postgres 18 + Valkey 9 thật: non-root, `/healthz`, `/readyz`, Valkey chết ⇒ 200 + `degraded`, `docker stop` ⇒ exit 0 + log `shutdown.start/complete` + thời gian (đề xuất của A) |
| `apps/api/Dockerfile` | base (corepack pnpm 11.28.2) → deps (`pnpm fetch`) → build (`install --offline`, build, `pnpm deploy --prod`) → **migrate** (`pnpm exec prisma migrate deploy`, user node) → **runtime** (node:24.22.0-bookworm-slim@digest, chỉ `dist` + node_modules prod, user node, HEALTHCHECK bằng fetch, `CMD node dist/main.js`) |
| `apps/web/Dockerfile` | standalone Next 16.4.1 (`apps/web/server.js`), copy `.next/static` + `public`, `.next` ghi được bởi node, user node, HEALTHCHECK `/api/healthz`, **không** build-arg URL (ADR-074) |
| `.dockerignore` | loại node_modules/output, mọi `.env*` (trừ example), khóa/dump/backup, `.git`, docs |
| `.env.example` (gốc) | mật khẩu + cổng cho compose |
| `apps/api/.env.example` | **khớp 1-1** `apps/api/src/config/env.ts` (18 biến; ADR-098: bỏ `JWT_ACCESS_KID*`, secret UTF-8 ≥ 32 byte tiền tố `change-me`) |
| `apps/web/.env.example` | **không đổi** — xung đột khi rebase với bản của E (T-012), giữ bản trên main |
| `.github/workflows/ci.yml` | `gitleaks` · `actionlint` · `static` (cấm `npx prisma`, `.env.example`↔`env.ts`, typecheck, lint = prettier+eslint+depcruise, `pnpm audit --prod --audit-level high`) · `unit` (`pnpm test` + `pnpm --filter @taskflow/api test:coverage`, upload coverage) · `integration` (services postgres+valkey, tạo role, Prisma validate/deploy/`migrate diff --exit-code` khi có schema, `test:integration` khi có) · `build` (needs static: 3 image không push, argon2 trong image, **smoke api + graceful shutdown**, smoke web, Trivy). Concurrency cancel cho PR; `permissions: contents: read`; không secret; mọi action ghim SHA |
| `.github/actions/setup/action.yml` | composite: pnpm/action-setup (đọc packageManager) + setup-node (.nvmrc, cache pnpm) + install frozen |
| `.github/scripts/check-env-example.mjs` | so khóa `.env.example` ↔ `EnvSchema` |
| `.github/dependabot.yml` | npm, github-actions, docker, docker-compose; cooldown 3 ngày (≥ minimumReleaseAge) |
| `lefthook.yml`, `.gitleaks.toml` | pre-commit: gitleaks (staged) + prettier (stage_fixed) + eslint. Allowlist gitleaks chỉ theo regex giá trị giả (`change-me-…`, `test-only-…`, `*_local_only/_ci_only/_smoke_only`) |
| `docs/runbook/local-dev.md` | Máy trắng Windows → chạy được: Git, Node 24.22.0 (fnm hoặc MSI — winget mới có 24.20.0), `corepack enable pnpm` (+ `corepack pnpm` khi không có quyền), Docker Desktop, gitleaks (winget có 8.30.1), cổng ADR-097, env, migrate bằng migrator, DoD, image, bảng sự cố |
| `docs/design/devops.md` | Đóng các điểm ⚠ T-011; §2.2 theo ADR-098 + `READINESS_DRAIN_MS`; cổng ADR-097 |
| `package.json` (gốc) | scripts `prepare`, `infra:up/down/reset/logs`, `docker:build`, `docker:verify-argon2`; devDependency `lefthook` |
| `pnpm-workspace.yaml` | catalog `@node-rs/argon2: 2.2.2` (trùng entry của T-013), `lefthook: 2.2.2`; `allowBuilds.lefthook: false`; `auditConfig.ignoreGhsas` (1 mục) |
| `apps/api/package.json` | `"@node-rs/argon2": "catalog:"` (Tech Lead mở rộng phạm vi) — sau rebase trùng với T-013, không xung đột |

## Kết quả kiểm chứng (Docker Desktop 29.8.2, Windows 11, máy dev)

**Compose** — `docker compose up -d --wait postgres postgres-test valkey` → cả 3 `healthy`:
| Kiểm | Kết quả |
|---|---|
| init script | `[init] đã tạo taskflow_migrator + taskflow_app cho database taskflow` |
| migrator `CREATE TABLE` / `DROP TABLE` | OK |
| app `INSERT` | OK · `statement_timeout = 10s` |
| app `CREATE TABLE` | `ERROR: permission denied for schema public` ✅ |
| app `DROP TABLE` | `ERROR: must be owner of table probe` ✅ |
| `CREATE DATABASE taskflow_w1 TEMPLATE taskflow_template` (migrator, postgres-test) | OK |
| postgres-test `fsync` | `off` |
| data dir | `/var/lib/postgresql/18/docker` (đúng đường dẫn PG18) · `18.6 (Debian 18.6-1.pgdg12+2)` |
| Valkey | `maxmemory-policy noeviction` · `valkey_version:9.1.2` |

**Image**
| Image | Kích thước | Ghi chú |
|---|---|---|
| `taskflow-api:dev` (runtime) | 347 MB → **479 MB** sau khi main có Prisma/pg/socket.io (T-010/016) | `/app` chỉ có `dist`, `node_modules`, `package.json`; không pnpm; `uid=1000(node)` |
| `taskflow-api-migrate:dev` | 1.36 GB → **2.37 GB** | chứa toàn bộ workspace + devDeps để chạy Prisma CLI — chỉ dùng cho job migrate, không deploy làm service. **Đã chạy thật** trên DB trống qua mạng compose (user `node`, `DATABASE_URL`=migrator): `All migrations have been successfully applied.`, `_prisma_migrations`=1, collation `tasks.rank` = `C` |
| `taskflow-web:dev` | 390 MB | `uid=1000`, `/api/healthz` 200, `/` 200, Docker health `healthy`; sau rebase (T-012): config runtime qua env (`API_URL`/`WS_URL`/`APP_ENV`), header CSP có nonce |

**argon2id trong image runtime (ADR-065)** — `docker run --rm -i taskflow-api:dev node --input-type=module - < docker/verify-argon2.mjs`, qua đường `pnpm deploy` thật:
```
{"ok":true,"node":"v24.22.0","platform":"linux-x64","checks":{"phcPrefix":true,"verifyCorrect":true,"rejectWrong":true,"noTruncateAt72Bytes":true},"hashMs":{"min":24.5,"median":27.1,"max":39.6}}
{"ok":true,"node":"v24.22.0","platform":"linux-x64","checks":{...tất cả true},"hashMs":{"min":44.9,"median":49,"max":95.7}}   ← image sau rebase, lúc máy đang bận build
```
Median 27–49 ms/hash trên Docker Desktop (WSL2), so với 27.5 ms trên Windows native — khớp số đo của T-001 §9. Chỉ kiểm amd64 (máy dev); arm64 chưa kiểm.

**Smoke api** — `bash docker/smoke-api.sh taskflow-api:dev`:
```
ok  /healthz
ok  /readyz {"db":"ok","valkey":"ok"}
ok  Valkey chết ⇒ /readyz 200 {"db":"ok","valkey":"degraded"} (ADR-074)
ok  SIGTERM ⇒ exit 0, shutdown.start→complete 1003ms (docker stop tổng 3s)
SMOKE PASS (taskflow-api:dev)            ← image sau rebase 791f6fa (có Prisma, realtime, rate-limit)
```

**Lint workflow/script:** `actionlint 1.7.12` (image Docker, có shellcheck) → sạch; `shellcheck` cho `smoke-api.sh`, `01-roles.sh` → sạch.
**gitleaks 8.30.1:** quét toàn bộ lịch sử repo → `no leaks found`; probe token GitHub giả trong file staged → hook **chặn** (`leaks found: 1`); probe mật khẩu trong URL Postgres → **không** bị bắt (giới hạn luật mặc định — xem rủi ro).
**pre-commit (lefthook run pre-commit):** gitleaks ✔ · prettier ✔ · eslint ✔.
**pnpm 11:** `pnpm fetch` → `install --offline --frozen-lockfile` chạy (đã thử trên bản sao repo); `pnpm deploy --prod` không cần `--legacy`.

## Definition of Done (máy dev Windows, sau rebase lên main `791f6fa` — đã có T-009/010/012/013/015/016)
```
pnpm typecheck                              → Done (api, web, packages)
pnpm lint                                   → prettier ✔ · eslint ✔ · depcruise "no dependency violations found"
pnpm test                                   → Test Files 59 passed (59) · Tests 602 passed (602)
pnpm --filter @taskflow/api test:coverage   → Tests 324 passed · All files 98.33 stmts / 94.54 branch / 97.77 funcs / 99.01 lines (ngưỡng core đạt)
pnpm build                                  → api + web Done
pnpm audit --prod --audit-level high        → exit 0 (1 high đã ignore có lý do — Quyết định 3)
node .github/scripts/check-env-example.mjs  → khớp env.ts (18 biến)
docker compose up -d --wait                 → postgres :5435, postgres-test :5434, valkey :6380 — 3/3 healthy
DATABASE_URL=<migrator@5435> pnpm --filter @taskflow/api db:deploy       → "All migrations have been successfully applied."
DATABASE_URL=<migrator@5435> pnpm --filter @taskflow/api db:check-drift  → "No difference detected."
DATABASE_URL=<migrator@5435> pnpm --filter @taskflow/api db:seed         → 6 user, 2 workspace, 2 project, 30 task
psql (taskflow_app) SELECT count(*) users/tasks                          → 6 / 30 (DEFAULT PRIVILEGES hoạt động)
DATABASE_URL_TEST=<migrator@5434> pnpm --filter @taskflow/api test:integration → Test Files 1 passed · Tests 14 passed
actionlint 1.7.12 (+shellcheck) · shellcheck smoke-api.sh, 01-roles.sh   → sạch
```
Image sau rebase `791f6fa`: argon2 `{"ok":true,…,"hashMs":{"min":20.4,"median":31.2,"max":72.2}}` · smoke PASS · migrate image PASS.
CI chưa chạy trên GitHub (repo chưa push) — workflow kiểm bằng actionlint và chạy tay từng bước tương đương trên máy.

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **lefthook 2.2.2** thay husky + lint-staged: 1 file, chạy song song, `stage_fixed` thay lint-staged. Hook cài bằng script `prepare` (bỏ qua khi không có `.git`, vd trong Docker); postinstall của lefthook bị từ chối (`allowBuilds.lefthook: false`) vì pnpm 11 coi build script không khai báo là lỗi.
2. **gitleaks trong CI = binary chính thức + kiểm SHA256**, không dùng `gitleaks-action` (cần license với tài khoản tổ chức). PR quét `base..head`; push main quét toàn lịch sử.
3. **`pnpm audit` bỏ qua GHSA-vfj7-8cjw-p6xm** (braces ≤3.0.3, high, **chưa có bản vá**), chỉ đi qua `packages/config > @next/eslint-plugin-next > fast-glob > micromatch > braces` — công cụ lint, không có trong image runtime. Xét lại 2026-11-15. Phương án sạch hơn (thuộc A): chuyển plugin ESLint của `packages/config` sang `devDependencies` ⇒ `--prod` không còn tính lint tooling, bỏ được ngoại lệ.
4. **Trivy 0.75.0** (không 0.76.0 vì mới phát hành < 24h).
5. **Valkey local không mật khẩu** (chỉ bind 127.0.0.1); prod bắt buộc `rediss://` (env.ts).
6. Postgres-test có sẵn DB `taskflow_template` (owner migrator). Harness hiện tại của T-010 dùng **một** DB (`DATABASE_URL_TEST`, xóa + dựng lại schema `public`) ⇒ CI/runbook trỏ `DATABASE_URL_TEST` vào DB này bằng user migrator. Khi cần chạy song song theo worker (ADR-074) thì clone `CREATE DATABASE … TEMPLATE taskflow_template` (đã thử, chạy được).
7. CI job `integration`: `prisma validate` → `migrate deploy` → `db:check-drift` (user migrator) → `pnpm --filter @taskflow/api test:integration`. Composite setup chạy `prisma generate` sau install (client sinh vào `src/generated`, gitignore) — mọi job typecheck/test/build đều cần.
8. Không dùng BuildKit cache mount cho store pnpm — store nằm trong layer `deps` (chỉ đổi khi lockfile đổi), tránh lỗi hardlink chéo mount.
9. Smoke api chạy `NODE_ENV=test` (production đòi `rediss://`, https, Sentry — không có trong runner).
10. **gitleaks allowlist mở rộng có kiểm soát** sau khi quét lại toàn bộ ref (main đã có T-013/T-016, nhánh feat/T-017): 17 false positive ⇒ (a) path đúng 1 file `apps/api/src/modules/auth/infrastructure/security/data/common-passwords.json` (danh sách mật khẩu phổ biến công khai, 15 phát hiện), (b) regex `correct-horse-battery-staple` (fixture test trên feat/T-017), (c) literal base64 mẫu cũ còn trong lịch sử commit a28592c. Sau đó: toàn bộ ref `no leaks found`; probe token GitHub giả vẫn bị chặn.

## Rủi ro / việc cho ticket khác
- **Migrate local bằng `taskflow_migrator`:** `prisma.config.ts` chỉ đọc `DATABASE_URL` (ADR-061) và `process.loadEnvFile` không ghi đè biến đã có ⇒ runbook §5 đặt tạm `$env:DATABASE_URL` (migrator) rồi gọi `db:deploy`/`db:seed`/`db:migrate`. Đã thử: chạy đúng.
- **Script `build` của api không gọi `prisma generate`** (T-010): Dockerfile và CI tự gọi trước. Đề xuất `build: prisma generate --no-hints && tsdown` để `pnpm build` tự đủ.
- **Web dừng chậm:** `docker stop`/SIGTERM với `taskflow-web` mất ~7.7–10 s (exit 143) — Next standalone không thoát ngay; vẫn trong hạn `stop_grace_period 30s` nhưng rolling deploy chậm hơn. Đề xuất Phase 4/5 (E) xem `NEXT_MANUAL_SIG_HANDLE` hoặc handler riêng.
- **`apps/web/package.json` vẫn `next dev --port 3000`** — ngoài phạm vi; ADR-097 cần 3001 (cổng 3000 đang bị dự án khác chiếm). Runbook/`.env.example` đã ghi 3001.
- **gitleaks** không bắt mật khẩu trong URL Postgres với luật mặc định ⇒ dựa vào `.gitignore` + review; có thể thêm luật tùy chỉnh sau.
- **`.gitignore` (ngoài phạm vi):** đề nghị thêm `*.dump`, `*.sql.gz`, `backups/` (devops.md §2.5) — `.dockerignore` đã có.
- **`minimumReleaseAgeExclude`:** **chưa đến giờ** (làm việc ~03:00–05:00Z, mốc 17:50Z) — để nguyên; Tech Lead xóa lúc merge.
- **Hook git dùng chung giữa các worktree:** `pnpm install` (prepare) ghi hook vào `.git/hooks` chung. Trong lúc làm tôi đã gỡ lại (`lefthook uninstall`) để không ảnh hưởng worktree khác. Sau merge, `pnpm install` đầu tiên của mỗi người cài hook ⇒ **mọi người (kể cả agent) cần gitleaks trên PATH** (runbook §1.3), nếu không commit bị chặn. Khi hook chưa cài, các commit trên branch này dùng `LEFTHOOK=0` nhưng tôi đã chạy `lefthook run pre-commit` tay (xanh).
- **Image migrate 2.37 GB** — chấp nhận ở Phase 1; tối ưu trước Phase 5 (vd image riêng chỉ có `prisma` + `prisma/`) vì kéo image chậm khi deploy.
- **`pnpm deploy --prod` trong Docker mất ~11 phút** (648 s) trên máy này: nó tải lại package từ registry thay vì dùng store của `pnpm fetch` (mạng tới registry npm chập chờn, `ECONNRESET`). CI có cache `type=gha` nên chỉ chậm lần đầu / khi lockfile đổi. Theo dõi; có thể thử `--offline` cho `deploy` sau.
- **Smoke đo shutdown bằng timestamp log** (`shutdown.start` → `shutdown.complete`), không bằng đồng hồ `docker stop`: một lần chạy lúc Docker Desktop đang build song song, `docker stop` mất 39 s trong khi app tự dừng sau 1 s.
- **Dependabot** với `catalog:` của pnpm và `ARG NODE_IMAGE=…@digest` trong Dockerfile: chưa kiểm khả năng cập nhật — theo dõi PR đầu tiên.
- **Docker Desktop tự cập nhật** trong lúc làm (29.7.2 → 29.8.2); build lần đầu ~10 phút do mạng tới registry npm chập chờn (`ECONNRESET`).
