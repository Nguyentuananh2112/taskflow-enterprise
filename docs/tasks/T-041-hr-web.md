# T-041a/b/c — Web Mốc 3

**Giao cho:** Engineer E (`taskflow-enterprise-0e`) · **Mốc:** 3 · **Phụ thuộc:** contracts của T-037 (bắt đầu bằng mock)

## Nguồn
`docs/design/attendance-leave.md` §5 "Hợp đồng cho web", §6 · `docs/design/test-spec-hr.md` §9 E2E-HR-*.

## Việc cần làm
- **T-041a:** thẻ Chấm công đầu trang danh sách dự án (đồng hồ theo `serverNow`, trạng thái, Vào/Ra, banner nhắc), nút gọn + **chuông** ở header, `/w/[wsId]/attendance` (lịch tháng `<table>`, trạng thái chữ + biểu tượng), `myGrants` + `member:grants-changed`.
- **T-041b:** `/w/[wsId]/leave` — đơn của tôi, số phép còn, form gửi (gợi ý "không cần ghi bệnh"), hủy.
- **T-041c:** `/w/[wsId]/hr` — Hôm nay, Bảng công tháng + xuất CSV (fetch → Blob), Đơn chờ duyệt (duyệt/từ chối/thu hồi), Lịch & ngày lễ, Số phép; công tắc "Quản lý nhân sự" trong cài đặt thành viên (OWNER).
VIEWER: ẩn toàn bộ. Responsive 360–1440, sáng/tối, tiếng Việt, giờ theo múi giờ của lịch.

## Done
Mỗi phần: tsc/eslint/unit xanh, verify exit 0, F chạy E2E-HR liên quan. `DONE T-041a|b|c`.
