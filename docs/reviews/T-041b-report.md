# T-041b — Web nghỉ phép (`/w/:ws/leave`)

Engineer E · 2026-10-16 · branch `feat/T-041b-leave-web` (tách từ `feat/T-041a-attendance-web`).

## Đã làm
- Số phép năm (còn / đang chờ / đã dùng / được hưởng); số còn có thể ÂM thì hiện số âm (tô đỏ).
- Form gửi đơn: loại, từ – đến ngày, buổi (nửa ngày chỉ khi một ngày), lý do TÙY CHỌN (TL chốt) với gợi ý "không cần ghi bệnh hay chẩn đoán". **Xem trước** số ngày (`GET leave-requests/preview`, debounce 400 ms, chỉ khi khoảng hợp lệ, `aria-live`): "Đơn này: N ngày làm việc · phép năm còn X ngày" hoặc lỗi y như khi gửi.
- Lỗi gửi → câu tiếng Việt theo mã D chốt: `LEAVE_SPANS_YEARS` (gắn ô Đến ngày), `NO_WORKING_DAYS` (ô Từ ngày), `overlapping_leave`, `INSUFFICIENT_BALANCE` (kèm còn / cần bao nhiêu).
- Đơn của tôi: mới nhất trước, trạng thái chữ + biểu tượng, người duyệt, lý do + ghi chú HR (TEXT). Hủy có xác nhận + `expectedVersion`; APPROVED chỉ hủy trước ngày bắt đầu (so với ngày của SERVER theo lịch — D-M5); `invalid_transition` / `VERSION_CONFLICT` → câu rõ + tải lại.
- VIEWER: câu giải thích, không form. Lối vào từ thẻ Chấm công.

## Contracts
DTO đơn nghỉ / số phép / preview là schema **TẠM** `shared/api/m3-provisional/leave.ts`, tên đã thống nhất với D (T-039); enum lấy từ contracts/hr thật. Danh sách = phong bì chuẩn (data + meta.page). Khi T-039 có contracts: thay import, xóa thư mục tạm.

## Test
Tích hợp (mock + socket giả, ngày server cố định 15/10/2026): gửi đơn 2 ngày, trùng ngày, vượt phép (câu có số), hủy đơn chờ duyệt, đơn đã duyệt bắt đầu hôm nay không còn nút hủy, lý do chứa HTML hiện như chữ, VIEWER, xem trước (số ngày + lỗi vượt phép trước khi gửi). Unit: nhãn khoảng ngày, số thập phân kiểu Việt, quy tắc được hủy. axe sạch.

## Rà giao diện
Cùng lượt với T-041a (xem `T-041a-report.md`): 0 tràn ngang, 0 lỗi axe AA ở 360/768/1440 × sáng/tối.

## Chưa làm / chờ
`pnpm verify` + build + E2E-HR liên quan (sau khi T-037/T-038/T-039 merge và rebase).
