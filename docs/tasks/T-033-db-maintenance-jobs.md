# T-033 — Job bảo trì dữ liệu: purge workspace + cân bằng lại rank

**Giao cho:** Engineer C (`taskflow-enterprise-d7`) · **Phase:** 5 · **Phụ thuộc:** main ≥ ab86f02 (T-023)

## Nguồn
DECISIONS ADR-011, 047, 050, 095, 110 · `docs/design/data-and-api.md` §1.3, §1.7 · `docs/design/devops.md` (graceful shutdown).

## Việc 0 (commit riêng)
`data-and-api.md` §3.2: thêm `"route"` vào `RESOURCE_NOT_FOUND.details.resource` (A báo ở T-021).

## Việc chính
1. **Lên lịch purge workspace** (ADR-095): scheduler trong process API (`setInterval` mỗi giờ, có jitter), mỗi lượt mở transaction + `pg_try_advisory_xact_lock(<hằng số>)` — không lấy được khóa thì bỏ qua lượt; xóa theo lô (vd 50 workspace/lượt), idempotent; dừng sạch khi graceful shutdown (không bắt đầu lượt mới, chờ lượt đang chạy ≤ timeout). Bật/tắt và chu kỳ qua env (mặc định bật ở staging/production). Test tầng I: 2 instance cùng chạy ⇒ chỉ 1 lượt thực thi; purge không đụng workspace đã được khôi phục (race restore ‖ purge).
2. **Cân bằng lại rank** (ADR-011 đã ghi "không rebalance ở v1.1, rank có thể dài dần"): đo độ dài rank tối đa sau N lần chèn vào giữa (benchmark); thêm job hoặc thao tác theo cột: khi rank > ngưỡng (vd 64 ký tự) ⇒ tính lại rank đều cho cột đó trong 1 transaction, tăng `version` các task bị đổi, phát event realtime để client cập nhật. Có khóa theo (project, status) để không đụng move đang chạy (optimistic lock vẫn bảo vệ). Test tầng I/C: move song song trong lúc rebalance ⇒ không mất thứ tự, không mất task.
3. Metrics/log: số workspace purge, số cột rebalance, thời gian chạy.

## Phạm vi sở hữu
`apps/api/src/modules/workspace/infrastructure/**` (purge job — phối hợp B vì module của B; chỉ thêm file job + wiring), `apps/api/src/modules/task/**` (rebalance), `apps/api/src/composition/**` (đăng ký job — phối hợp A), `docs/design/data-and-api.md`.

## Done
DoD + integration trên DB riêng (exit code). Nhắn `DONE T-033 feat/T-033`.
