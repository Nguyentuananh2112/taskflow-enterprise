# T-036 — Tài liệu repo công khai: README, kiến trúc, đóng góp

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 5 · **Phụ thuộc:** main ≥ 4803384

## Bối cảnh
Repo sẽ **public** (ADR-072). Người đọc mới (dev tham gia, người đánh giá) cần hiểu dự án trong 10 phút mà không đọc ~40 ticket. Tài liệu thiết kế chi tiết đã có trong `docs/design/`, `docs/blueprint/DECISIONS.md` — T-036 là lớp **cửa vào**, tham chiếu tới đó, không chép lại.

## Việc
1. `README.md` (root): sản phẩm là gì (1 đoạn), ảnh chụp board (chụp từ build prod với dữ liệu seed giả — không dữ liệu thật), tính năng v1 (và những gì CHƯA có: bình luận — ADR-111, xác minh email — ADR-049), stack + phiên bản chính, chạy local trong 5 bước (trỏ `docs/runbook/local-dev.md`), lệnh hay dùng, cấu trúc monorepo, link tới tài liệu sâu hơn. Không có secret/placeholder giống thật.
2. `docs/ARCHITECTURE.md`: sơ đồ (mermaid) — các module backend (auth, workspace, task) + core + ranh giới Clean Architecture + luật dependency-cruiser; luồng 1 request (move task: HTTP → use case → UoW → Prisma → afterCommit → Socket.io); FSD frontend; realtime; các quyết định quan trọng nhất (link ADR): optimistic lock (ADR-010/110), fractional rank (ADR-011) + rebalance (T-033), refresh rotation + `__Host-` (ADR-024/109), fail-closed revocation (ADR-105), allow-list logging (T-031).
3. `CONTRIBUTING.md`: quy trình branch/worktree, hook pre-commit (gitleaks/prettier/eslint — không bỏ qua), Definition of Done (kiểm exit code), quy tắc giảm tải máy (ADR-107), cách viết ADR mới.
4. `SECURITY.md` (chuẩn GitHub): cách báo lỗ hổng (kênh riêng, không issue công khai), phạm vi; trỏ `docs/runbook/security-go-live.md`.
5. Kiểm mọi lệnh trong README/CONTRIBUTING thật sự chạy được trên máy sạch (ghi kết quả vào report).

## Phạm vi sở hữu
`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, ảnh trong `docs/assets/`.

## Done
Hook xanh; F hoặc B đọc chéo 1 lượt (người không viết là người kiểm "10 phút có hiểu không"). Nhắn `DONE T-036 feat/T-036`.
