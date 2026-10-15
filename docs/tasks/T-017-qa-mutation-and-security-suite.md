# T-017 — QA độc lập: mutation testing + bộ test bảo mật đầu-cuối

**Giao cho:** Engineer F — QA/Tester (cửa sổ mới) · **Phase:** 2–3 · **Vai trò:** người kiểm thử độc lập — **tìm cách phá**, không viết code sản phẩm.

## Nguồn
`docs/TEAM.md` · `docs/blueprint/DECISIONS.md` · `docs/design/security.md` (SEC-01..58 — nguồn chính) · `docs/design/test-spec-auth-workspace.md`, `docs/design/test-spec-task.md` · `docs/design/data-and-api.md` (API contract) · `docs/design/devops.md` §8 (chiến lược test).

## Worktree
`../TaskFlow_wt/T-017`, branch `feat/T-017` từ `main`.

## Phần 1 — Mutation testing cho code đã merge (làm ngay)
1. Thiết lập StrykerJS (bản ổn định mới nhất, kiểm chứng tương thích Vitest 5 — nếu không tương thích, báo Tech Lead trước khi chọn công cụ khác) cho `apps/api/src/core/**` và `apps/api/src/modules/auth/**`.
2. Chạy, báo cáo mutation score theo thư mục. Liệt kê **mutant sống sót có ý nghĩa** (bỏ qua mutant vô hại như đổi chuỗi log), mỗi mục: file:dòng, đột biến, vì sao test không bắt, đề xuất test cần thêm.
3. **Không tự sửa test của người khác** — đưa danh sách vào `docs/reviews/T-017-findings.md`; Tech Lead phân về engineer chủ module.

## Phần 2 — Bộ test bảo mật đầu-cuối (viết trước, sẽ đỏ tới Phase 3)
1. Harness test HTTP + Socket.io đen (black-box) tại `apps/api/test/security/`: khởi động app thật với Postgres/Valkey thật (cổng theo ADR-097), helper tạo user/workspace/role qua **API công khai** (không chọc thẳng DB trừ khi kịch bản bắt buộc).
2. Hiện thực tối đa SEC-01..58 dưới dạng test. Case chưa chạy được vì route chưa có ⇒ `it.todo` hoặc `skip` có nhãn `PENDING-ROUTE` — **không được để test giả xanh**.
3. Ưu tiên: IDOR chéo workspace, VIEWER cố ghi, MEMBER xóa task người khác, reuse refresh token, token sau logout-all, join socket room trái phép, Origin lạ (SEC-56), mass assignment (SEC-57/58), rate limit.

## Phạm vi sở hữu
`apps/api/test/security/**`, `stryker.config.*`, devDependency Stryker (ghi rõ trong report), `docs/reviews/T-017-*.md`. **Không sửa** `apps/*/src/**`.

## Done
Phần 1: báo cáo mutation score + findings. Phần 2: harness chạy được, danh sách SEC → trạng thái (xanh / PENDING-ROUTE / phát hiện lỗi). Lỗi bảo mật thật phát hiện được ⇒ nhắn Tech Lead **ngay**, không đợi DONE. Nhắn `DONE T-017 feat/T-017`.
