# T-045 — Nhắc chấm công khi vào workspace + lối tắt chấm công / nghỉ phép

**Giao cho:** Engineer E · **Yêu cầu:** người dùng (qua TL d9, 2026-10-17) · **Nhánh:** `feat/T-045-checkin-prompt` từ `main` 657e8fd;
rebase lên `fix/T-041-server-today` khi nhánh đó merge · **Review:** TL · **E2E:** F thêm sau (đồng hồ test `TEST_CLOCK_ANCHOR`).

## 1. Dialog nhắc chấm công
Hiện giữa màn hình khi người dùng vào **trang dự án của workspace** (`/w/:ws/projects` — màn hạ cánh sau khi chọn workspace
lúc đăng nhập; `/w` chưa có workspace nên không hiện).

**Chỉ hiện khi TẤT CẢ đúng** — theo `attendance/me/today` của SERVER (không dùng giờ máy):
- có quyền `attendance:self` (VIEWER: không gửi request, không hiện);
- `isWorkday` và không `isHoliday`;
- chưa chấm vào (`firstIn = null`);
- không nghỉ cả ngày (`leave ≠ FULL`);
- trạng thái ≠ `NOT_EMPLOYED`;
- có lịch và ca **chưa kết thúc**: giờ server (theo `timezone` của lịch) < `schedule.endMin` (contracts bảo đảm
  `startMin < endMin` — ca không qua đêm).

**Nội dung:** lời chào theo giờ server (sáng < 11:00 ≤ trưa < 13:00 ≤ chiều < 18:00 ≤ tối) kèm tên; "Hôm nay bạn chưa chấm
công"; ca làm `HH:mm–HH:mm`; nút chính **"Chấm công vào"** (Idempotency-Key như thẻ — mỗi lần bấm một key, lỗi mạng thử lại
1 lần cùng key) và **"Để sau"**. Không tự chấm.

**Tối đa 1 lần / ngày** cho mỗi (user, workspace, workDate): ghi `workDate` vào localStorage (wrapper `shared/lib/storage`,
try/catch) ngay khi dialog HIỆN — kể cả khi đóng bằng tải lại trang. Storage lỗi ⇒ nhớ trong bộ nhớ của tab ⇒ vẫn tối đa
1 lần trong phiên. Khóa theo user + workspace, giá trị là ngày ⇒ không phình theo thời gian.

**Chấm xong:** đóng dialog, toast "Đã chấm vào lúc HH:mm" (giờ theo lịch), cập nhật hôm nay + invalidate bảng tháng và
lượt chấm (như thẻ). Lỗi (409 đã chấm / 422 / mạng) ⇒ câu tiếng Việt như thẻ, dialog đóng (thẻ đã tải lại trạng thái).

**A11y:** Radix Dialog (focus trap, nhãn = tiêu đề, mô tả), Esc / bấm nền = "Để sau", focus đầu tiên vào nút chính.

## 2. Hàng lối tắt dưới thẻ Chấm công (trang dự án)
| Lối tắt | Đích | Số |
|---|---|---|
| Bảng công của tôi | `/w/:ws/attendance` | — |
| Xin nghỉ · còn N ngày | `/w/:ws/leave` | `remainingDays` năm nay (năm theo ngày của server) |
| Đơn nghỉ của tôi · N chờ duyệt | `/w/:ws/leave` | số đơn PENDING của tôi (ẩn phần số khi 0) |
| Nhân sự · N đơn chờ | `/w/:ws/hr?tab=leave` | số đơn PENDING cả công ty; **chỉ khi có `hr:manage`** |

Số đếm lấy trang đầu (≤ 50) — trên 50 hiện "50+". Số chưa tải ⇒ chỉ hiện nhãn (không chặn link). Responsive 360–1440
(xuống dòng, không tràn ngang), sáng/tối bằng token. VIEWER: ẩn cả thẻ, hàng lối tắt và dialog.

## Test
- Unit: điều kiện hiện/ẩn (mỗi điều kiện một ca + biên `endMin`), lời chào theo giờ server, "1 lần/ngày" (localStorage +
  storage lỗi ⇒ bộ nhớ).
- Tích hợp (mock, giờ server cố định khác giờ máy): hiện sau khi vào trang dự án; "Để sau"/Esc ⇒ đóng và không hiện lại
  khi vào lại; "Chấm công vào" ⇒ toast có giờ, thẻ "Đang làm"; VIEWER / đã chấm / nghỉ cả ngày ⇒ không hiện; lối tắt có
  số và đúng đích; HR thấy "Nhân sự · N đơn chờ"; axe.
- E2E (F, sau merge): với `TEST_CLOCK_ANCHOR` (thứ Ba 10:00 VN) dialog phải hiện cho MEMBER mới.

## Done
`pnpm verify` exit 0 (gồm `pnpm -r lint:deps`), build prod, rà 360/768/1440 × sáng/tối không tràn + axe sạch, report
`docs/reviews/T-045-report.md`.
