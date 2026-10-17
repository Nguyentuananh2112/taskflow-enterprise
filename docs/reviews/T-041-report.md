# T-041 — Web Mốc 3 (chấm công, nghỉ phép, HR): báo cáo chốt

Engineer E · 2026-10-17 · T-041a/b do E làm, T-041c do H làm và E nhận lại. Chi tiết từng phần: `T-041a-report.md`, `T-041b-report.md`, `T-041c-handoff.md` (các file đó viết lúc chưa merge — trạng thái cuối nằm ở đây).

## 1. Đã vào main

| Phần | Merge | Head nhánh | Cổng (TL / F) |
|---|---|---|---|
| T-041a chấm công + chuông + quyền HR | `bf6c052` | `31d7e86` | verify xanh (lần đầu ĐỎ ở `lint:deps`, xem §3); E2E-HR phần a 58/58 chromium + mobile (`1b6b6f2`) |
| T-041b nghỉ phép | `5c87789` | `9876700` | verify 8/8, integration 751/751, security 164, build xanh; E2E 65/65 (`280f6d4`) |
| T-041c `/hr` + công tắc "Quản lý nhân sự" | `92fb19b` | `9a9eb5c` | verify xanh; E2E 72/72, mọi ca E2E-HR chạy, không còn fixme (`db252de`) |

Web không còn schema tạm: `shared/api/m3-provisional` đã xóa; mọi DTO lấy từ `@taskflow/contracts/{attendance,leave,hr}` trên main. Đã đối chiếu route + mã trả về với API thật: thông báo `read`/`read-all` trả 204 (web dùng `NoContent`); 10 route nghỉ phép (`modules/leave/presentation/leave.routes.ts`) khớp đường dẫn, `201` khi gửi đơn, danh sách `?mine=1` strict + `meta.page`; mã lỗi khớp contracts (`422 rule` viết hoa, `409 reason` viết thường).

## 2. Review chéo (H → E) — đã sửa trước merge, mỗi điểm có test

| # | Vấn đề | Sửa |
|---|---|---|
| 1 | Riêng `attendance/me/today` lỗi ⇒ `/attendance`, `/leave` kẹt skeleton; thẻ Chấm công biến mất im lặng | Trạng thái lỗi + "Thử lại" ở cả ba nơi |
| 2 | "Đơn của tôi" chỉ trang đầu (50) | `useInfiniteQuery` theo cursor + "Tải thêm"; mock strict `ListLeaveRequestsQuery` + phân trang |
| 3 | Chấm vào/ra không làm mới lượt chấm hôm nay | Invalidate cả `month` và `events` |
| 4 | Mock chuông không lọc thông báo dành cho HR theo quyền hiện tại | Lọc `LEAVE_SUBMITTED/CANCELLED` theo `hasPermission(role, grants, 'hr:manage')` lúc đọc |
| 6 | `aria-label` trên `<p>` đồng hồ (ARIA 1.2 không cho) | Chữ `sr-only` bên trong |
| 7 | Tên nút "Hủy đơn" có thể trùng | Thêm loại nghỉ vào tên |

E review chéo các commit `/hr` của H trong lúc H làm (công tắc grant khóa với OWNER/VIEWER, `filename*` RFC 6266, xóa cache HR khi mất quyền, realtime phía nhân viên).

## 3. Sự cố trong quá trình và bài học

- **Verify T-041a đỏ ở `lint:deps`** (`fsd-no-cross-slice`): `widgets/app-header` import `widgets/notification-bell`. Sửa: `AppHeader` nhận slot `actions`, tầng app (`app/gates/app-shell.tsx`) ráp chuông. *Bài học:* chạy `pnpm -r lint:deps` trước khi báo DONE — eslint + tsc không bắt lỗi này.
- **Bỏ commit contracts khi rebase làm sống lại thư mục tạm:** commit contracts leave cherry-pick cũng chứa lệnh xóa `m3-provisional`; bỏ nó ⇒ thư mục trở lại (không ai import, nhưng làm rebase của c xung đột add/add). Sửa bằng commit xóa riêng. *Bài học:* trước khi bỏ một commit, xem `git show --stat` — nó có thể làm việc khác ngoài phần mình muốn bỏ.
- **Mock API chạy phía server của next dev** (H phát hiện): import barrel `@/entities…` vào `app/mock-api` ⇒ mọi route mock 500. Đã có `server-safe-imports.test.ts`.
- **Nghiệp vụ:** ngày trước khi gia nhập bị tính "Vắng" — E phát hiện khi rà giao diện, A xác nhận API cũng sai, TL chốt `NOT_EMPLOYED`; web hiển thị nhãn trung tính.

## 4. Còn mở (không chặn)

1. Mock chưa đủ như API (đủ cho UI; E2E dùng API thật): lịch HR lưu chỉ để hiển thị (`MockAttendance` vẫn tính theo lịch mặc định); `MockLeave` chưa trừ ngày lễ khi đếm ngày; gửi/hủy đơn trong mock chưa ghi thông báo.
2. Khi `member:grants-changed` có `userId` trong payload (B, phần 2 của T-037): thêm vào `grantsChanged()` ở `app/mock-api/workspace-events.ts`. Contracts trên main (`a9a1516`) chưa có.
3. Comment cũ ở `features/attendance-check/model/use-attendance-check.ts` ("T-038 sẽ thêm" luật Mốc 3 vào `BusinessRule`) — contracts đã có; đọc lỏng `rule` vẫn đúng, chỉ cần sửa chữ khi chạm file.
4. Worktree `h41c` của H: `git worktree remove` (không `--force`) đã gỡ đăng ký; thư mục trong scratchpad phiên H còn sót `node_modules` + vài file Windows không xóa được. Không chứa gì chưa commit (status rỗng, nhánh `9a9eb5c` đã trong main) — để người dùng/TL quyết dọn.
