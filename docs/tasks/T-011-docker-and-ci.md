# T-011 — Docker local/production + GitHub Actions CI + quét secret

**Giao cho:** Engineer D (`taskflow-enterprise-a5`) · **Phase:** 1b · **Phụ thuộc:** T-008 đã merge

## Nguồn
`docs/design/devops.md` (bạn là tác giả) · DECISIONS (ADR-060–063, 065, 070–074) · `docs/research/stack-versions.md` §6.

## Worktree
`../TaskFlow_wt/T-011`, branch `feat/T-011`.

## Việc cần làm
1. `docker-compose.yml` (dev): Postgres 18.6 (volume path mới), Valkey, healthcheck; user DB `taskflow_app` + `taskflow_migrator` qua init script; DB template cho test song song (ADR-074).
2. `apps/api/Dockerfile`, `apps/web/Dockerfile`: multi-stage, non-root, healthcheck, `pnpm deploy`/standalone theo devops.md; **không** `npx prisma` (ADR-061). Web nhận `API_URL` lúc runtime.
3. **Kiểm chứng `@node-rs/argon2` chạy trong image** (ADR-065) — script nhỏ băm + verify, ghi kết quả + thời gian vào report.
4. `.env.example` đầy đủ (gộp danh sách từ devops.md + security.md), không có secret thật.
5. `.github/workflows/ci.yml`: install (cache pnpm) → typecheck → lint (gồm dependency-cruiser) → unit → integration (service postgres + valkey) → `prisma migrate diff` rỗng → build images (không push). Job **gitleaks** riêng. Concurrency cancel. Không deploy (chưa có hosting — ADR-070).
6. Pre-commit (lefthook hoặc husky — chọn 1, lý do): gitleaks protect + lint-staged.
7. `docs/runbook/local-dev.md`: từ máy trắng Windows đến chạy được (Docker Desktop, pnpm, migrate, seed).

## Phạm vi sở hữu
`docker-compose*.yml`, `**/Dockerfile`, `.dockerignore`, `.github/**`, `.env.example`, `docker/**`, `docs/runbook/**`, `docs/design/devops.md`, file cấu hình pre-commit + mục `scripts`/devDependency liên quan trong root `package.json` (ghi rõ trong report để Tech Lead merge).

## Done
`docker compose up -d` lên xanh; build 2 image thành công; workflow hợp lệ (`actionlint` nếu có). Report `docs/reviews/T-011-report.md` trên branch. Nhắn `DONE T-011 feat/T-011`.
