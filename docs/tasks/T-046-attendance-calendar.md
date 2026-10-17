# T-046 — "Bảng công của tôi" dễ đọc cho người không rành IT (lịch tháng + tổng kết)

**Giao cho:** Engineer E (web) · Engineer A (API: totals) · **Yêu cầu:** người dùng (phản hồi qua TL d9, 2026-10-17 — ảnh:
16 dòng "Chưa/không làm việc" lặp lại, ngày tương lai ghi "Chưa tới giờ", không có tổng kết, chữ nhạt, hôm nay không nổi bật)
· **Nhánh:** `feat/T-046-attendance-calendar` nối tiếp T-045; cần `fix/T-041-server-today` (aria-current="date") trên main
· **E2E:** F (đồng hồ test).

## Phụ thuộc API (A — TL d9 đã chốt 4 điểm, 2026-10-17)
`GET attendance/me?month=` thêm `totals: AttendanceTotalsDto`, CÙNG hàm `totalsOf` với bảng HR (hai màn luôn khớp số). Bổ sung
vào `AttendanceTotalsDto`: `presentDays` (PRESENT + MISSING_OUT; nửa ngày nghỉ + đi làm nửa kia = 1), `throughDate`
(= hôm nay theo lịch, hoặc cuối tháng nếu tháng đã qua), `upcomingLeaveDays` (phép đã duyệt sau hôm nay). Chỉ đếm ngày
`date ≤ hôm nay` ở MỌI cột. `workedMin` chỉ cộng ngày đã có OUT (hôm nay đang làm hiện riêng ở ô "Hôm nay"). Web KHÔNG tự
cộng những gì server tính.

## Web
1. **Ô tổng kết tháng** ở đầu trang, chữ to: Ngày đi làm · Đi muộn (lần) / Về sớm (lần) · Nghỉ phép (ngày) · Vắng (ngày) ·
   Tổng giờ làm; dòng phụ "Tính đến hết ngày dd/MM" và "Sắp nghỉ: N ngày" (nếu có). Số 0,5 ⇒ "1,5 ngày".
2. **Ô "Hôm nay"** nổi bật (tháng hiện tại): trạng thái, giờ vào / giờ ra, nút chấm công dùng chung với thẻ.
3. **Mặc định dạng lịch tháng** (lưới 7 cột T2→CN). Mỗi ô: màu + biểu tượng + chữ ngắn — Đi làm (8:02–17:35), Đi muộn X phút,
   Về sớm X phút, Vắng, Nghỉ phép (cả ngày / nửa ngày), Chủ nhật, Ngày lễ (tên lễ). Bấm ô ⇒ panel chi tiết: Giờ vào, Giờ ra,
   Số giờ làm, lượt chấm (thiết bị / IP của chính mình, lượt đã hủy). Nút chuyển **Lịch / Danh sách**; nhớ lựa chọn
   (`shared/lib/storage`, try/catch).
4. **Ngoài nhiệm kỳ:** các ngày NOT_EMPLOYED liền nhau trước ngày vào làm gộp thành MỘT khối/dòng "Bạn bắt đầu làm từ dd/MM"
   (sau khi rời: "Bạn đã nghỉ làm từ dd/MM"). **Ngày tương lai:** ô trống, nhạt, không chữ.
5. **Chú thích màu** dưới lịch. Chữ to hơn, tương phản AA ở cả sáng/tối; trạng thái KHÔNG chỉ dựa vào màu (luôn có chữ +
   biểu tượng; ô thu gọn ở 360 có tên truy cập đầy đủ). **360 px:** lưới gọn (ô chỉ biểu tượng + số ngày), bấm mở chi tiết.
6. **Câu chữ đời thường:** "Giờ vào / Giờ ra / Số giờ làm", "Đi muộn 37 phút", "Về sớm 15 phút"; giờ dạng `8:02`
   (không số 0 đầu).
7. **Cùng ngôn ngữ thiết kế** cho lịch tháng từng người trong `/hr` (tab Bảng công). Bảng tổng của HR thêm cột
   **"Phép sắp tới"** (`upcomingLeaveDays` — TL chốt: để HR xếp lịch người).
8. Giữ `aria-current="date"` cho ô/hàng hôm nay (E2E của F dựa vào đó); lưới là `role="grid"` hoặc bảng có tiêu đề cột
   (T2…CN) — điều hướng bàn phím bằng phím mũi tên trong lưới, Enter mở chi tiết.

## Test
Unit (gộp NOT_EMPLOYED, định dạng giờ `8:02`, câu chữ theo trạng thái, xếp ngày vào lưới T2→CN kể cả tháng bắt đầu CN),
tích hợp (tổng kết từ `totals`, ô hôm nay + chấm công, lịch ↔ danh sách nhớ lựa chọn, bấm ô ⇒ chi tiết, tương lai trống,
/hr dùng cùng lưới), axe; rà trình duyệt 360/768/1440 × sáng/tối (0 tràn ngang, 0 lỗi axe serious/critical).

## Done
`pnpm verify` exit 0 (gồm `lint:deps`), build prod, E2E liên quan xanh (F), report `docs/reviews/T-046-report.md` kèm ảnh
trước/sau.
