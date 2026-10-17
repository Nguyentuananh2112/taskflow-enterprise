# T-041a — Web chấm công: thẻ, bảng công, chuông, quyền HR

> **Đã merge** — trạng thái cuối, cổng và việc còn mở: `T-041-report.md`. Phần dưới viết trước merge.

Engineer E · 2026-10-16 · branch `feat/T-041a-attendance-web` (từ main `dd58774`, rebase `f8ddb7b`).

## Đã làm
| Phần | Nội dung | File chính |
|---|---|---|
| http | Tùy chọn `idempotencyKey` ⇒ header `Idempotency-Key` | `shared/api/http.ts` (+ test) |
| Thẻ Chấm công | Đầu trang `/w/:ws/projects`: đồng hồ theo `serverNow` + múi giờ của lịch (không theo máy, không lùi sau giờ nhận response), ca, trạng thái chữ + biểu tượng, Vào / Ra / Ra lại, giờ vào/ra ("00:30 (+1)" khi ra sau nửa đêm), banner "Bạn chưa chấm vào hôm nay" (không tự chấm). Mỗi lần bấm một key; lỗi mạng tự thử lại 1 lần với CÙNG key; 409 `already_checked_in` / 422 `NOT_CHECKED_IN` ⇒ câu tiếng Việt + làm mới | `widgets/attendance-card`, `features/attendance-check`, `entities/attendance` |
| Header | Nút gọn Vào/Ra khi route có `wsId` (ẩn < sm và với VIEWER); chuông thông báo | `widgets/app-header/ui/header-attendance.tsx`, `widgets/notification-bell` |
| `/w/:ws/attendance` | Bảng công tháng `<table>` (tiêu đề cột + tiêu đề hàng), mặc định tháng của SERVER, `?month=`, tháng trước/sau; bấm ngày ⇒ hộp thoại lượt chấm của mình kèm IP/thiết bị, lượt đã hủy gạch ngang + người hủy + lý do | `views/attendance`, `entities/attendance/ui/*` |
| Chuông | Số chưa đọc, 20 mới nhất, câu chữ dựng ở web từ type + ngữ cảnh join sẵn (không lý do nghỉ), đánh dấu một/tất cả đã đọc; `notification:new` + kết nối lại ⇒ làm mới | `entities/notification`, `features/notification-read` |
| Quyền | `usePermission` = `hasPermission(role, myGrants, p)` (contracts); `member:grants-changed` vá `myGrants` trong cache ⇒ UI HR đổi ngay + toast; UI chấm công theo `can('attendance:self')` (VIEWER ẩn) | `entities/workspace/model/use-permission.ts`, `features/realtime-session` |
| Primitive | `Popover` (Radix) trong `shared/ui` | `shared/ui/popover` |
| Mock API | Chấm công (today / check-in / check-out / month / me/events, mã lỗi đúng như A chốt), thông báo (4 route + phát `notification:new`) | `app/mock-api/*attendance*`, `notification-handlers.ts` |

## Contracts — lấy từ nhánh khác (CHÚ Ý thứ tự merge)
Nhánh có cherry-pick contracts chưa vào main: T-038 của A (attendance DTO + events, đồng bộ theo `a913d9e`) và T-037 của B (`f3523e3` migration 3 + quyền/grants + contracts hr, `c0ac57c` subpath `./hr`). ⇒ **merge T-037 và T-038 trước**, rồi rebase nhánh này (git bỏ các bản trùng). Web không còn schema tạm nào (P5).

Đã báo và được xử lý: `AttendanceKind`/`AttendanceSource` khai báo trùng ở `hr.schemas.ts` và `attendance.schemas.ts` ⇒ TS2308 ở barrel — TL chốt giữ ở hr, A đã sửa (`a913d9e`).

## Test
- Unit: http (Idempotency-Key), giờ theo múi giờ (VN, "(+1)", DST Europe/Berlin), mock chấm công 5 ca (mã lỗi, idempotency, VIEWER 403, tháng).
- Tích hợp (mock + socket giả, giờ server cố định 10:00 VN dù máy test UTC): thẻ (đồng hồ, nhắc, Vào ⇒ Đang làm/đi muộn, VIEWER không thấy), bảng tháng (cấu trúc bảng, trạng thái chữ + biểu tượng, `?month=`), chi tiết ngày (IP/thiết bị, lượt hủy, payload HTML hiển thị như chữ), chuông (số → danh sách → đích link + đã đọc, realtime tăng số, tên chứa HTML), `member:grants-changed`. axe sạch ở mọi màn mới.
- Các bộ cũ dùng trang dự án/header (admin-screens, admin-g1, auth-flow, board-flow, structure, error-states) xanh.

## Lỗi tự gặp và đã sửa trong lúc làm
- Đồng hồ lùi 1 s ngay sau khi tải (state `now` lấy trước khi response về).
- `PopoverClose asChild` gắn `type="button"` lên `<a>` (HTML sai) ⇒ bỏ, tự đóng trong `onClick`.
- Tên truy cập của mục thông báo bị ghép dính chữ ("Chưa đọc:Đơn…duyệtCông ty") ⇒ `aria-label` tường minh.
- `useWorkspace('')` gửi request rỗng từ header ở `/w`, `/account` ⇒ `enabled`.

## Chưa làm / để cổng
- `pnpm verify` + `next build` chờ lượt máy; E2E-HR-01/03/04/05/07 (phần T-041a) do F chạy.
- Responsive/sáng-tối kiểm bằng E2E viewport của F (màn mới dùng `PageMain`, token màu).
- Link trong chuông trỏ `/leave` và `/hr` — hai trang thuộc T-041b/c.

## Rà giao diện trên trình duyệt thật (2026-10-16, next dev :3021 + mock, Playwright Chromium)
Thẻ Chấm công (`/projects`), `/attendance`, `/leave` × 360 / 768 / 1440 × sáng / tối (18 tổ hợp):
- Tràn ngang trang: **0** ở cả 18. Bảng tháng tự cuộn ngang trong khung ở 360 (`min-w-[36rem]`).
- axe WCAG 2.1 A/AA (kể cả độ tương phản — jsdom không đo được): **0** lỗi serious/critical ở cả 18.
- Thứ tự Tab trên `/leave`: header (TaskFlow → Chấm ra → Thông báo → Tài khoản → Đăng xuất) → form (Loại → Từ ngày → Đến ngày → Buổi → Lý do → Gửi) → Hủy đơn; ô ngày native dừng theo từng phần ngày/tháng/năm (hành vi chuẩn của trình duyệt).
- **Đã sửa sau lượt đầu:** ở 360 header bị chật sau khi thêm chuông ("Tài khoản"/"Đăng xuất" xuống dòng) và nút/link trên thẻ gãy chữ ⇒ ẩn avatar dưới `sm`, giảm khoảng cách, `whitespace-nowrap` cho `Button` (nút trong app vốn một dòng) và link header, hàng hành động của thẻ tự xuống hàng. Chạy lại: vẫn 0 tràn, 0 lỗi axe.
- **Phát hiện nghiệp vụ (đã báo A, A xác nhận cả API cũng sai):** ngày trước khi nhân viên gia nhập workspace bị tính "Vắng". A đề xuất `DayStatus = NOT_EMPLOYED` (TL chốt) — web sẽ thêm nhãn khi contracts đổi.
