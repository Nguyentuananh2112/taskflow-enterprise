# T-026 — E2E Playwright: luồng người dùng thật, đa trình duyệt, realtime

**Giao cho:** Engineer F — QA (`taskflow-enterprise-bb` hoặc phiên thay thế) · **Phase:** 5 · **Phụ thuộc:** T-020, T-023, T-024, T-025 đã merge (API + web chạy trên Prisma thật)

## Nguồn
`docs/design/frontend.md` §8 (E2E-01..16) · `docs/design/security.md` SEC-48..50 (CSP/XSS E2E) · `docs/design/devops.md` §8 · DECISIONS (ADR-003, 026, 101, 102, 106).

## Worktree
`../TaskFlow_wt/T-026`, branch `feat/T-026` từ `main`.

## Việc cần làm
1. `e2e/` (package riêng trong monorepo) với `@playwright/test`: khởi động API (Prisma, DB riêng `taskflow_e2e` — ADR-106) + web bản **build production** (`next start`, APP_ENV=test), seed dữ liệu qua API công khai.
2. Kịch bản bắt buộc: đăng ký → workspace mặc định → tạo project → tạo task → kéo qua các cột hợp lệ → cột sai state machine bị chặn; reload giữ phiên; đăng xuất mọi thiết bị ⇒ tab khác bị đẩy ra.
3. **Realtime 2 trình duyệt**: user A kéo thẻ ⇒ user B (context khác) thấy thẻ di chuyển < 2s; user ở workspace khác không thấy gì.
4. Xung đột: A và B cùng sửa một task ⇒ một bên nhận 409, UI hòa giải đúng theo frontend.md, không mất dữ liệu.
5. Phân quyền qua UI: VIEWER không thấy/không dùng được hành động ghi; MEMBER không xóa được task người khác; project archived chỉ đọc.
6. SEC-48..50: không vi phạm CSP trên mọi trang (bắt sự kiện `securitypolicyviolation`), token không nằm trong storage, cookie HttpOnly.
7. Chạy trên Chromium + Firefox (WebKit tùy chọn nếu máy chịu được); trace/video chỉ giữ khi fail.

## Ràng buộc
Máy dev thiếu RAM: `workers: 1` khi chạy local; CI chạy song song. Không dùng `waitForTimeout` cố định — chờ theo điều kiện.

## Phạm vi sở hữu
`e2e/**`, mục `scripts`/devDependency liên quan ở root (ghi rõ trong report).

## Done
Tất cả kịch bản xanh 3 lần liên tiếp (kiểm exit code); thời gian chạy; report `docs/reviews/T-026-report.md`. Nhắn `DONE T-026 feat/T-026`.
