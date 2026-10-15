# T-011 — Báo cáo: Docker local/production + GitHub Actions CI + quét secret

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/T-011` · **Ngày:** 2026-10-15

## File
| File | Ghi chú |
|---|---|
| `docker-compose.yml` | postgres 18.6-bookworm (volume `/var/lib/postgresql`), postgres-test (tmpfs, fsync off, DB `taskflow_template`), valkey 9.1.2 (noeviction, không persistence), mailpit (profile `mail`). Mọi image ghim tag + digest, cổng chỉ mở trên 127.0.0.1 |
| `docker/postgres/init/01-roles.sh` | Tạo `taskflow_migrator` (owner, CREATEDB cho shadow DB) + `taskflow_app` (chỉ DML qua DEFAULT PRIVILEGES, `statement_timeout 10s`). Dùng chung cho compose **và** CI |
| `docker/verify-argon2.mjs` | Kiểm chứng argon2id trong image: băm + verify + từ chối sai + không cắt 72 byte + đo thời gian |
| `apps/api/Dockerfile` | base → deps (`pnpm fetch`) → build (`install --offline`, build, `pnpm deploy --prod`) → `migrate` (`pnpm exec prisma migrate deploy`, user node) → `runtime` (node:24.22.0-bookworm-slim + digest, user node, HEALTHCHECK bằng fetch, `CMD node dist/main.js`) |
| `apps/web/Dockerfile` | standalone Next 16.4.1, copy `.next/static` + `public`, `.next` ghi được bởi node, user node, HEALTHCHECK `/api/healthz`, **không** build-arg URL (ADR-074) |
| `.dockerignore` | loại node_modules/build output, mọi `.env*` (trừ example), khóa/dump, `.git`, docs |
| `.env.example` (gốc), `apps/api/.env.example`, `apps/web/.env.example` | Đủ biến devops.md §2.2/§2.3 + security.md; giá trị local hậu tố `_local_only`, đánh dấu `[SECRET]` |
| `.github/workflows/ci.yml` | Jobs: `gitleaks`, `actionlint`, `static` (cấm `npx prisma`, typecheck, lint = prettier+eslint+depcruise, `pnpm audit --prod --audit-level high`), `unit`, `integration` (services postgres+valkey, tạo role, Prisma validate/deploy/diff khi có schema, `test:integration` khi có), `build` (needs static: pnpm build, 3 image không push, argon2 trong image, smoke healthz + non-root, Trivy) |
| `.github/actions/setup/action.yml` | composite: pnpm/action-setup (đọc packageManager) + setup-node (.nvmrc, cache pnpm) + install frozen |
| `.github/dependabot.yml` | npm, github-actions, docker, docker-compose; cooldown 3 ngày |
| `lefthook.yml`, `.gitleaks.toml` | pre-commit: gitleaks (staged) + prettier (stage_fixed) + eslint; gitleaks allowlist chỉ theo regex giá trị giả |
| `docs/runbook/local-dev.md` | Từ máy trắng Windows: Git, Node 24.22.0 (fnm/MSI), `corepack enable pnpm`, Docker Desktop, gitleaks, compose, env, migrate bằng migrator, DoD, image, sự cố |
| `docs/design/devops.md` | Đóng các điểm ⚠ T-011 bằng kết quả đã kiểm |
| `package.json` (gốc) | scripts `prepare`, `infra:up/down/reset/logs`, `docker:build`, `docker:verify-argon2`; devDependency `lefthook` |
| `pnpm-workspace.yaml` | catalog `@node-rs/argon2: 2.2.2`, `lefthook: 2.2.2`; `allowBuilds.lefthook: false`; `auditConfig.ignoreGhsas` (1 mục) |
| `apps/api/package.json` | `"@node-rs/argon2": "catalog:"` (Tech Lead mở rộng phạm vi cho đúng dòng này) |
| `pnpm-lock.yaml` | theo 2 dependency trên |

## Kết quả kiểm chứng
<!-- KẾT QUẢ DOCKER: điền sau khi Docker Desktop chạy -->

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **lefthook 2.2.2** thay husky + lint-staged (1 file, song song, `stage_fixed` thay lint-staged). Hook được cài bằng script `prepare` (bỏ qua khi không có `.git`, vd trong Docker); postinstall của lefthook bị từ chối (`allowBuilds.lefthook: false`) vì pnpm 11 chặn build script.
2. **gitleaks trong CI = binary chính thức + kiểm SHA256**, không dùng `gitleaks-action` (cần license với tài khoản tổ chức).
3. **`pnpm audit` bỏ qua GHSA-vfj7-8cjw-p6xm** (braces ≤3.0.3, high, **chưa có bản vá**). Chỉ đi qua `packages/config > @next/eslint-plugin-next > fast-glob > micromatch > braces` (công cụ lint, không có trong image runtime). Xét lại 2026-11-15. Phương án sạch hơn (ngoài phạm vi, thuộc A): chuyển các plugin ESLint của `packages/config` từ `dependencies` sang `devDependencies` — khi đó `--prod` không còn tính lint tooling và có thể bỏ mục ignore.
4. **Trivy 0.75.0** thay 0.76.0 (0.76.0 mới phát hành < 24h — cùng tinh thần `minimumReleaseAge`).
5. **Không password cho Valkey local** (chỉ bind 127.0.0.1) — tránh rắc rối healthcheck; prod bắt buộc `rediss://` + mật khẩu (env schema).
6. Postgres-test dùng `POSTGRES_DB=taskflow_template` (owner migrator) → harness tự `CREATE DATABASE taskflow_w<N> TEMPLATE taskflow_template`.
7. Integration test theo quy ước: gói nào có thì khai script root **`test:integration`**; CI tự chạy khi script tồn tại. Bước Prisma trong CI tự bật khi có `apps/api/prisma/schema.prisma`.

## Việc cho ticket khác / Tech Lead
- **T-010 (prisma.config.ts):** local cần chạy migrate bằng `taskflow_migrator` trong khi app dùng `taskflow_app`, nhưng `prisma.config.ts` chỉ đọc `DATABASE_URL` (ADR-061). Runbook hiện đặt tạm `$env:DATABASE_URL` từ `MIGRATOR_DATABASE_URL`. Đề xuất: `db:migrate`/`db:deploy` của T-010 tự làm việc này (vd `dotenv -v DATABASE_URL=$MIGRATOR…` hoặc script node nhỏ), hoặc Tech Lead cho phép `prisma.config.ts` đọc `MIGRATOR_DATABASE_URL ?? DATABASE_URL ?? ""`.
- **T-009 (env.ts):** schema hiện chỉ có 3 biến; `apps/api/.env.example` đã có đủ danh sách để T-009 bổ sung.
- **`.gitignore` (ngoài phạm vi):** đề nghị thêm `*.dump`, `*.sql.gz`, `backups/` (devops.md §2.5) — `.dockerignore` đã có.
- **gitleaks giới hạn:** luật mặc định **không** bắt mật khẩu nằm trong URL Postgres (`postgresql://user:pass@host`) — đã thử. Hiện dựa vào việc `.env` bị ignore + review. Có thể thêm luật tùy chỉnh sau.
- **`minimumReleaseAgeExclude`:** **chưa đến giờ** (làm việc lúc ~03:00–04:00Z, mốc là 17:50Z) — để nguyên, Tech Lead xóa lúc merge nếu đã qua mốc.
- **Hook git dùng chung giữa các worktree:** `pnpm install` (script `prepare`) và `lefthook run` ghi hook vào `.git/hooks` chung. Trong lúc làm tôi đã gỡ lại (`lefthook uninstall`) để không ảnh hưởng worktree khác trước khi merge. Sau merge, lần `pnpm install` đầu của mỗi người sẽ cài hook — mọi người cần có gitleaks (runbook §1.3), nếu không commit bị chặn.

## Definition of Done
<!-- điền -->
