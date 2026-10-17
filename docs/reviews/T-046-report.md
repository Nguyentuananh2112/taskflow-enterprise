# T-046 — "Bảng công của tôi" dễ đọc (lịch tháng + tổng kết) · kèm T-045

Engineer E · 2026-10-17 · vé `docs/tasks/T-046-attendance-calendar.md` (và `T-045-checkin-prompt.md`). API totals / T-047 của A.

## 1. Đã vào main

| Vé | Merge | Cổng (TL d9 / F) |
|---|---|---|
| T-045 dialog nhắc chấm công + lối tắt | `35ef1f6` | verify xanh; E2E 77/77 (E2E-HR-10..12 mới) |
| T-046 lịch + tổng kết (cùng totals A, T-047, câu lỗi retention) | `eee812c` | verify 8/8, integration 768/768, security 169, build; E2E 77/77 |

Review riêng tư/bảo mật của B: APPROVE, 1 LOW (khóa localStorage của dialog lộ UUID thô trên máy dùng chung) — đã sửa: khóa băm ngắn + xóa mọi khóa khi phiên kết thúc.

## 2. Phản hồi của người dùng ⇒ thay đổi

| Phản hồi (ảnh) | Sau T-046 |
|---|---|
| 16 dòng "Chưa/không làm việc" lặp lại | Gộp thành MỘT câu "Bạn bắt đầu làm từ dd/MM" (rời giữa tháng: "Bạn đã nghỉ làm từ dd/MM") |
| Ngày tương lai ghi "Chưa tới giờ" | Tương lai để trống; chỉ hiện điều đã biết trước — ngày lễ (tên), phép đã duyệt (cả ngày / nửa ngày) |
| Không có tổng kết | Ô tổng kết chữ to: Ngày đi làm · Đi muộn · Về sớm · Nghỉ phép · Vắng · Tổng giờ làm + "Tính đến hết ngày d/M", quên chấm ra, sắp nghỉ phép — **số do server tính** (`totals`, cùng hàm với bảng HR) |
| Chữ nhạt | Chữ nội dung `text-text` (AA); màu chỉ ở viền trái / nền nhạt / biểu tượng; trạng thái luôn có chữ + biểu tượng |
| Hôm nay không nổi bật | Ô "Hôm nay" viền đậm: câu trạng thái, Giờ vào / Giờ ra dạng `8:02`, nút chấm dùng chung với thẻ; ô lịch hôm nay có viền + `aria-current="date"` |

Ngoài ra: mặc định **lịch T2→CN** (ô: màu + biểu tượng + chữ ngắn "Đi làm 8:02–17:35", "Đi muộn 37 phút", "Đi muộn 2 giờ", "Vắng", "Nghỉ phép", "Ngày lễ · tên", "Chủ nhật", "Ngoài thời hạn lưu"); 360 px chỉ biểu tượng + số ngày (tên truy cập đủ câu); phím mũi tên / Home / End, một điểm dừng Tab; công tắc **Lịch / Danh sách** (nhớ lựa chọn; không lệch hydrate); panel chi tiết ngày "Giờ vào / Giờ ra / Số giờ làm" + lượt chấm của chính mình. `/hr`: lịch từng người cùng ngôn ngữ + tổng kết; bảng HR thêm "Ngày đi làm", "Phép sắp tới".

T-045: dialog nhắc chấm công giữa màn hình khi vào trang dự án — chỉ khi `me/today` của server cho thấy phải chấm mà chưa (ngày làm, không lễ, chưa vào, không nghỉ cả ngày, không NOT_EMPLOYED, ca chưa hết); tối đa 1 lần/ngày/(user, ws); lối tắt Bảng công · Xin nghỉ (còn N ngày) · Đơn nghỉ của tôi (N chờ duyệt) · Nhân sự (N đơn chờ, chỉ `hr:manage`).

## 3. Quyết định đã chốt trong lúc làm

- **Totals (TL d9, 4 điểm):** `totals` trong `AttendanceMonthDto`; thêm `presentDays`, `throughDate`, `upcomingLeaveDays`; mọi cột chỉ đếm `date ≤ hôm nay`; `workedMin` chỉ ngày đã có OUT.
- **Web không tự cộng:** sau ADJUSTMENT / void, response mang `totals` của tháng ⇒ web thay đúng 1 ô + dòng tổng; hàm `totalsOf` phía web đã xóa (hai nơi cài cùng quy tắc sẽ lệch).
- **Giờ server ở mọi "hôm nay"** (`fix/T-041-server-today`, vào main trước): `meta.timestamp` ⇒ `serverClock`; E2E neo giờ bằng `TEST_CLOCK_ANCHOR`.
- **Retention (T-047 / R27):** ngày quá thời hạn lưu ⇒ "Ngoài thời hạn lưu" (trung tính, không phải vắng); sửa ngày đó ⇒ "Ngày này đã quá thời hạn lưu dữ liệu, không thể chỉnh."
- **Dialog T-045 trong test:** các bộ test khác tắt dialog modal ở setup (`suppressDailyOnceForTest`) — có hiện hay không phụ thuộc giờ máy; bộ của T-045 bật lại.

## 4. Test

Unit: điều kiện dialog (biên 17:29/17:30, múi giờ lịch), lời chào, daily-once (storage lỗi, băm khóa, xóa khi đăng xuất), câu chữ từng loại ngày, lưới T2→CN (tháng bắt đầu CN), gộp ngày ngoài nhiệm kỳ, giờ `8:02`. Tích hợp: dialog (9 ca), lối tắt có số, lịch (tổng kết, ô hôm nay, tương lai, chú thích, a11y), bàn phím trong lưới, Lịch ↔ Danh sách nhớ lựa chọn, chi tiết ngày, /hr lịch từng người + thêm lượt cập nhật 1 ô. Web: 83 file / 607 test. E2E (F): E2E-HR cập nhật cho lịch + E2E-HR-10..12 cho dialog.

## 5. Còn mở

1. **Rà trình duyệt 360/768/1440 × sáng/tối + axe** cho T-045/T-046 CHƯA chạy: lần đầu dev server thiếu `API_URL` (máy khởi động lại, mất `.env.local`), tiến trình next (PID 29036) còn giữ cổng 3023 và lệnh tắt bị hệ thống quyền từ chối; Next 16 không cho dev server thứ hai cùng thư mục. Chờ người dùng `taskkill /PID 29036 /F` ⇒ chạy script đã sẵn, đo cả tương phản nền màu nhạt (`bg-*/10`) — sẽ bổ sung kết quả vào report này.
2. Lối tắt "Phiếu lương" trên thẻ Chấm công — làm cùng T-050 (Mốc 4).
