# T-022 — CI bổ sung + tối ưu build/image

**Giao cho:** Engineer D (`taskflow-enterprise-a5`) · **Phase:** 3 · **Phụ thuộc:** main ≥ 4bbe537

## Việc
1. `apps/api` script `build` tự `prisma generate --no-hints` trước tsdown (mở rộng phạm vi sang `apps/api/package.json` mục scripts); bỏ bước generate trùng trong Dockerfile/CI nếu thừa.
2. CI: job `test:security` (suite đen của F, Postgres + Valkey service) chạy trên mọi PR; job `test:integration`; workflow **mutation hằng tuần** (`schedule`) theo cấu hình Stryker của F, upload báo cáo làm artifact, không chặn PR.
3. Sau **2026-10-15T17:50Z**: xóa `minimumReleaseAgeExclude` (nếu chưa tới giờ khi bạn làm xong phần còn lại, báo tôi — tôi tự làm).
4. Image `migrate` 2.37 GB → mục tiêu < 500 MB (chỉ prisma CLI + migrations, không toàn bộ workspace); giảm thời gian `pnpm deploy` (cache mount pnpm store trong Dockerfile, `--offline` khi có thể). Ghi số trước/sau.
5. `pnpm audit` GHSA-vfj7-8cjw-p6xm (braces): phối hợp A — chuyển plugin ESLint của `packages/config` sang `devDependencies` để bỏ ignore; nếu không bỏ được, giữ ignore có hạn ngày rà lại.

## Phạm vi sở hữu
`.github/**`, `**/Dockerfile`, `docker/**`, `docker-compose*.yml`, `pnpm-workspace.yaml` (mục 3), `apps/api/package.json` (mục scripts), `docs/runbook/**`, `docs/design/devops.md`.

## Done
actionlint sạch; build image + số đo; report `docs/reviews/T-022-report.md`. Nhắn `DONE T-022 feat/T-022`.
