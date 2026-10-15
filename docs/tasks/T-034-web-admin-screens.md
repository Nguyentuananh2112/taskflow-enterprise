# T-034 — Web: màn hình quản trị workspace, thành viên, project

**Giao cho:** Engineer E (`taskflow-enterprise-54`) · **Phase:** 4 (bổ sung) · **Phụ thuộc:** main ≥ b56846d (API thật đầy đủ)

## Bối cảnh
Thiếu sót khi chia ticket: `docs/design/frontend.md` §1 (dòng ~54–77) có 3 màn quản trị nhưng chưa ticket nào làm. API đã có đủ (data-and-api §2.5–2.6).

## Màn hình
1. `/w/[wsId]/settings` — sửa tên/slug (R19: không tự lowercase, lỗi `RESOURCE_CONFLICT field=slug`), vùng nguy hiểm: xóa workspace (gõ lại slug; dialog nói rõ ẩn ngay + xóa vĩnh viễn sau 30 ngày, OWNER khôi phục được — ADR-047/050); danh sách workspace đã xóa + khôi phục cho OWNER (`GET /workspaces?deleted=true`, `POST …/restore`).
2. `/w/[wsId]/settings/members` — danh sách (cursor, tìm `q`), thêm theo email + role, đổi role (OWNER), xóa / tự rời; lỗi `LAST_OWNER` ⇒ "Workspace phải còn ít nhất một Chủ sở hữu"; thêm user không hợp lệ ⇒ thông báo chung (security §6.5); hiển thị `unassignedTaskCount` khi hạ VIEWER/xóa (ADR-044); xử lý realtime `member:role-changed`, `workspace:access-revoked` (bị xóa khỏi ws ⇒ rời màn, toast).
3. `/w/[wsId]/p/[projectId]/settings` — sửa tên/mô tả, lưu trữ / bỏ lưu trữ (keyPrefix bất biến — chỉ hiển thị).
4. Tạo workspace mới (`POST /workspaces`) + tạo project (nếu T-025 chưa có) từ UI.
5. Combobox chọn người phụ trách có tìm kiếm (`q`) thay `<select>` 100 người của T-025 (backlog #8 của T-025).

## Ràng buộc
`usePermission()` ẩn/hiện theo role; server là nguồn chặn thật. MSW handler khắt khe như server cho mọi route mới (bài học H2). Component ≤ 150 dòng, ≤ 3 `useState`, không `fetch` trong `.tsx`. A11y axe + bàn phím.

## Worktree
Dùng lại worktree T-025 (`git switch -c feat/T-034 main`).

## Done
DoD (exit code); 1 lượt chạy với API thật (dán kết quả); Lighthouse a11y các màn mới ≥ 95. Nhắn `DONE T-034 feat/T-034`.
