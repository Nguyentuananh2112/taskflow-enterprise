# T-027 — Kiểm thử tải k6: đo P95 theo NFR + realtime

**Giao cho:** Engineer D (`taskflow-enterprise-a5`) · **Phase:** 5 · **Phụ thuộc:** T-020, T-023, T-024 đã merge

## Nguồn
Blueprint §1.1 NFR (GET P95 < 150ms, ghi P95 < 300ms, WebSocket < 100ms) · DECISIONS ADR-030 (login/register không áp dụng — argon2id) · `docs/design/devops.md` §8.

## Worktree
`../TaskFlow_wt/T-027`, branch `feat/T-027` từ `main`.

## Việc cần làm
1. `load/` với k6 (bản ổn định mới nhất, chạy bằng Docker image chính thức để không cài vào máy): kịch bản seed dữ liệu thực tế (5 workspace × 3 project × 500 task, 20 user/workspace).
2. Kịch bản đo: đọc board (list task theo project), tạo task, move task (có `expectedVersion`), cập nhật task; mức tải tăng dần đến khi P95 vượt ngưỡng — ghi **điểm gãy** (RPS).
3. Realtime: k6 WebSocket (hoặc xk6 socket.io nếu cần) — đo độ trễ từ lúc move qua HTTP tới lúc client khác nhận `task:moved`.
4. Ngưỡng k6 (`thresholds`) đúng NFR; output JSON + tóm tắt markdown.
5. Phân tích: 3 endpoint chậm nhất, kế hoạch truy vấn (`EXPLAIN ANALYZE`) cho query board, đề xuất index/caching nếu không đạt — **không tự tối ưu code module của người khác**, chỉ đề xuất có số liệu.

## Ràng buộc
Máy dev yếu và đang chạy nhiều thứ: số đo local chỉ để so sánh tương đối; ghi rõ cấu hình máy và tải nền lúc đo. Chạy khi Tech Lead báo "máy rảnh".

## Phạm vi sở hữu
`load/**`, `docs/reviews/T-027-report.md`.

## Done
Báo cáo P95/P99 từng endpoint, điểm gãy, độ trễ realtime, đề xuất. Nhắn `DONE T-027 feat/T-027`.
