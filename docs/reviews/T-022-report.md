# T-022 — Báo cáo: CI bổ sung + tối ưu build/image

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/T-022` · **Ngày:** 2026-10-15
**Căn cứ:** ticket T-022 + 2 mục bổ sung của Tech Lead (prepare trong worktree; tốc độ cài trên Windows).

## Kết quả theo mục ticket
| # | Việc | Trạng thái |
|---|---|---|
| 1 | `apps/api` `build` = `prisma generate --no-hints && tsdown`; bỏ bước generate trùng trong Dockerfile | ✅ Composite CI vẫn generate sau install vì `pnpm test`/coverage/`test:security` cần client (không chạy `build`) |
| 2 | CI: job `security` (suite đen T-017) mọi PR; job `integration`; workflow mutation hằng tuần | ✅ — xem "CI" |
| 3 | Xóa `minimumReleaseAgeExclude` sau 2026-10-15T17:50Z | ⏳ **Chưa tới giờ** khi xong việc — Tech Lead tự làm như đã nói |
| 4 | Image migrate < 500 MB; giảm thời gian `pnpm deploy` | ✅ <!-- SỐ ĐO --> |
| 5 | Bỏ ignore GHSA-vfj7-8cjw-p6xm (braces) | ⏳ A đã chuyển plugin ESLint sang `devDependencies` (commit `0abe144` trên `feat/T-024`). **Giữ ignore trên nhánh này** để thứ tự merge nào cũng xanh; xóa mục `auditConfig` ngay sau khi T-024 vào main và `pnpm audit --prod --audit-level high` trên main báo sạch (hạn rà: 2026-11-15) |
| + | Script `prepare` không làm `pnpm install` fail trong worktree / ngoài git | ✅ |
| + | Tốc độ cài trên Windows: store cùng ổ | ✅ runbook §2.1 + số đo — **không** đổi config toàn cục |

## File
<!-- FILES -->

## Quyết định tự đưa ra
<!-- DECISIONS -->

## Rủi ro / việc mở
<!-- RISKS -->
