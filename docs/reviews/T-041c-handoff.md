# T-041c — Bàn giao cho Engineer E (từ Engineer H, đêm 2026-10-16)

**Nhánh:** `feat/T-041c-hr-web` (không push) · **Dựng trên:** `feat/T-041b-leave-web` @ `2576a67` (đã chứa main `0ec3bb4`).
**Worktree của H:** `C:\Users\Padoma1\AppData\Local\Temp\claude\d--TaskFlow-Enterprise\047c1980-aea3-41ae-a71e-564c65515379\scratchpad\h41c` — E nên tạo worktree riêng từ nhánh, không làm tiếp trong thư mục này (scratchpad của phiên H có thể bị dọn).

## 1. Trạng thái

Đủ phạm vi T-041c theo vé + `attendance-leave.md` §5, §6, §9, chạy trên **mock**. Chưa nối API thật (T-038/T-039 chưa vào main).

| Phần | Trạng thái |
|---|---|
| Công tắc "Quản lý nhân sự" (cài đặt › thành viên, chỉ OWNER) | ✅ xong + review của E/TL đã sửa |
| `/w/:ws/hr` — Hôm nay | ✅ |
| Bảng công tháng (50 người/trang) + xuất CSV + xem/thêm/hủy lượt | ✅ |
| Đơn nghỉ — duyệt / từ chối / thu hồi | ✅ |
| Lịch làm việc (phiên bản) & ngày lễ | ✅ |
| Số phép (chỉnh điều chỉnh) | ✅ |
| Lối vào "Nhân sự" (header + thẻ chấm công), chuông `LEAVE_SUBMITTED` ⇒ `?tab=leave` | ✅ |
| Toàn bộ vitest apps/web | ⏳ chưa chạy (TL xếp lượt sau verify T-040) — xem §5 |
| `pnpm verify`, E2E-HR (F), xem tay 360/1440 sáng/tối | ⏳ TL chưa cấp — chạy sau khi chuỗi a→b→c lên main có backend |

## 2. Commit (cũ → mới)

| Hash | Nội dung |
|---|---|
| `034f5aa` | Công tắc grant; `http.put`, `http.download()` (Blob, Bearer, refresh khi TOKEN_EXPIRED) |
| `5c3d58b` | Sửa theo review: công tắc khóa cho Chủ sở hữu/Người xem + chú thích; `filename*` RFC 6266; PATCH role ⇒ phát `member:grants-changed []` |
| `bf10947` | Mock API phía HR (+ `hr-api.test.ts`) |
| `16bcfac` | Trang `/hr` 5 tab + `test/hr-page.test.tsx` |
| `d58439b` | Xóa cache `['ws', ws, 'hr']` ngay khi mất `hr:manage` |
| `f91ee9f` | Unit test: tổng tháng, thay 1 ô cache, câu lỗi duyệt đơn |
| `e0c1955` | Link "Nhân sự" trên header (E2E-HR-03) |
| `5d1d4b6` | Test XSS mức tích hợp (E2E-HR-08) |
| `bd77821` | Đổi tên DTO tạm cho trùng tên contracts của A |
| `8165eb0` | handoff (bản đầu) |
| `946506b` | Realtime phía HR: đơn mới/hủy ⇒ hàng đợi `/hr` cập nhật; mất `HR_MANAGE` ⇒ xóa cache HR ở mọi trang |
| `8f55111` | Realtime phía nhân viên (E nhờ): `LEAVE_APPROVED/REJECTED/REVOKED/CANCELLED`, `ATTENDANCE_ADJUSTED` ⇒ làm mới `/leave` + chấm công |
| `c2ec0c9` | `DELETE holidays/:date` không gửi body trừ khi cần `{ reason }` (A) |
| *(cuối)* | handoff này — hash cuối gửi TL qua tin nhắn |

## 3. Bản đồ file

- **Trang:** `app/(app)/w/[wsId]/hr/page.tsx` → `src/views/hr/ui/hr-page.tsx` (+ `hr-tabs.tsx`: WAI-ARIA tabs, ←/→/Home/End, `?tab=today|timesheet|leave|calendar|balances`).
- **Entity:** `src/entities/hr/` — `api/hr.api.ts` (`hrAttendanceApi`, `hrLeaveApi`), `model/use-hr.ts` (hooks), `model/query-keys.ts` (`hrKeys` dưới `['ws', wsId, 'hr']`), `model/use-forget-hr.ts`, `lib/timesheet-cache.ts` (`replaceTimesheetDay`, `totalsOf`), `lib/calendar-errors.ts`.
- **Widgets:** `hr-today`, `hr-timesheet` (+ `person-month.tsx` dùng lại `MonthTable` của E), `hr-leave-queue`, `hr-calendar` (+ `holiday-list.tsx`), `hr-balances`; `app-header/ui/header-hr.tsx`; link trong `attendance-card`.
- **Features:** `member-grants` (công tắc), `hr-leave-decide`, `hr-attendance-adjust` (dialog lượt thô + hủy + thêm), `hr-export-csv`, `hr-balance-adjust`, `hr-schedule-edit`, `hr-holiday-edit`.
- **Shared:** `shared/api/http.ts` (+`put`, `download`, `accept`), `shared/lib/save-blob.ts`.
- **Mock:** `mock-hr.ts`, `hr-attendance-handlers.ts`, `hr-calendar-handlers.ts`, `hr-leave-handlers.ts` (đăng ký TRƯỚC `leave-handlers` của E: `GET leave-requests?mine=1` trả `undefined` ⇒ MSW chuyển sang handler của E); thêm `grants` vào `mock-workspaces`, `PUT members/:userId/grants`, `forbiddenUnlessGranted`; thêm `adjust/locate/usersWithPunches/serverNow` vào `MockAttendance`, `adjustments` vào `MockLeave`.
- **Test:** `test/hr-page.test.tsx` (11), `test/hr-grants.test.tsx` (3), `src/app/mock-api/hr-api.test.ts` (8), `src/entities/hr/lib/timesheet-cache.test.ts` (3), `src/features/hr-leave-decide/model/decide-errors.test.ts` (8), thêm ca vào `src/shared/api/http.test.ts`; route `/hr` trong `test/app-harness.tsx`.

## 4. Thay `m3-provisional` khi T-038 (A) vào main — VIỆC ĐẦU TIÊN

Nghỉ phép phía HR đã dùng contracts THẬT (`@taskflow/contracts/leave`, D). Chỉ còn DTO chấm công phía HR ở `src/shared/api/m3-provisional/hr.ts`; tên đã TRÙNG với contracts của A (`feat/T-038-attendance` @ `cdd3096` — A báo "không khác bản chốt", có routes thật; `packages/contracts/src/attendance/attendance.schemas.ts`). H KHÔNG cherry-pick vào nhánh c (sẽ đụng mock/nhãn của E ở a/b — để lượt rebase của E):

| Tạm (`@/shared/api/m3-provisional`) | Thật (`@taskflow/contracts/attendance`) |
|---|---|
| `AttendanceCompanyTodayDto` | `AttendanceCompanyTodayDto` |
| `AttendanceMemberMonthDto` (`totals` inline) | `AttendanceMemberMonthDto` (+ `AttendanceTotalsDto`) |
| `HrDayDto` (= `AttendanceDayDto` + `timezone`) | `AttendanceDayDto` (bản của A ĐÃ có `timezone`) |
| `WorkScheduleDto`, `CreateWorkScheduleBody`, `TimeZoneName`, `HolidayDto`, `PutHolidayBody`, `DeleteHolidayBody` | cùng tên |

File import tạm (10): `app/mock-api/{hr-attendance-handlers,hr-calendar-handlers,mock-hr}.ts`, `entities/hr/api/hr.api.ts`, `entities/hr/lib/timesheet-cache{,.test}.ts`, `features/hr-holiday-edit/ui/delete-holiday-button.tsx`, `features/hr-schedule-edit/ui/schedule-form.tsx`, `widgets/hr-timesheet/ui/person-month.tsx`, `widgets/hr-today/ui/hr-today.tsx`.

Các bước: đổi import + `HrDayDto` → `AttendanceDayDto`; xóa thư mục `m3-provisional`; khi `AttendanceDayDto` có `timezone`, `MockAttendance.summarize` (file của E) phải trả thêm `timezone: MOCK_TZ` (hiện `MockHr.day` tự thêm); query `GET attendance?month` có thể dùng `AttendanceCompanyMonthQuery` trong mock; `hr-calendar-handlers.ts` có thể dùng `HolidayListQuery`/`HolidayDateParams`. Sau đó chạy `tsc` — `Record<DayStatus,…>` sẽ báo nếu thiếu nhãn `NOT_EMPLOYED` (E thêm ở `entities/attendance/lib/labels.ts`; `/hr` chỉ import `DAY_STATUS`, không có nhãn riêng; ô tổng ở tab Hôm nay không đếm `NOT_EMPLOYED`, `totalsOf` cũng không — khớp A "NOT_EMPLOYED tính 0").

Ghi chú API thật của A: mọi POST/PUT/PATCH phải có `Content-Type: application/json` + `{}` (http client đã làm), `GET attendance?month` tối đa `limit=50` (web gửi 50), `DELETE holidays/:date` không body trừ ngày đã qua (đã sửa `c2ec0c9`).

## 5. Lệnh đã chạy (exit 0) và chưa chạy

Trong worktree H, `pnpm` qua shim corepack, `--maxWorkers=2`:
- `pnpm exec tsc --noEmit -p apps/web` — sạch.
- `eslint` + `prettier --check` trên mọi file đổi — sạch; mọi commit qua hook lefthook (gitleaks + prettier + eslint) ✔.
- `vitest run` từng file: hr-page 11/11, hr-grants 3/3, hr-api 8/8, timesheet-cache 3/3, decide-errors 8/8, http 33/33; liên quan: admin-screens, admin-g1, mock-api, admin-api, leave-page, attendance-page, attendance-card, notification-bell, structure — xanh.
- **CHƯA:** toàn bộ vitest apps/web, `pnpm verify`, E2E (F), xem tay responsive/tối — chờ lượt TL.

## 6. Quyết định H tự đưa ra (TL/E xem lại được)

1. Chú thích công tắc dùng `ROLE_LABEL` ("Chủ sở hữu luôn có quyền Quản lý nhân sự" / "Người xem không được cấp quyền Quản lý nhân sự") theo góp ý E4 của E — TL ban đầu viết "OWNER luôn có quyền nhân sự"; cùng ý, khác chữ.
2. CẤP quyền phải xác nhận (mở dữ liệu nhạy cảm), THU làm ngay.
3. Tab theo `?tab=`; chuông `LEAVE_SUBMITTED` đổi sang `/hr?tab=leave` (file của E: `entities/notification/lib/notification-text.ts`, 1 dòng).
4. Link header ẩn dưới `sm` (header 360 đã chật sau fix của E); màn hẹp dùng link trên thẻ chấm công.
5. Bảng tháng: dòng tổng mỗi người + bấm tên ⇒ lịch tháng của người đó (không vẽ lưới 50×31). Thêm/hủy lượt ⇒ thay 1 ô từ `{event, day}` + tính lại tổng người đó ở client bằng `totalsOf` (CÙNG quy tắc A gửi) — nếu A đổi quy tắc tổng, sửa `totalsOf` hoặc invalidate dòng.
6. "Tháng sau" khóa ở tháng hiện tại; Số phép chỉ năm nay ±1 (giới hạn PATCH); "Còn lại" âm tô đỏ.
7. Mất `hr:manage` ⇒ `removeQueries(['ws', ws, 'hr'])` ở 2 chỗ: `HrPage` (`useForgetHrWhenRevoked`, cả khi hạ role) và handler `member:grants-changed` trong `features/realtime-session/model/use-realtime-session.ts` (file của E — mọi trang). Cùng file: `notification:new` loại `LEAVE_SUBMITTED`/`LEAVE_CANCELLED` ⇒ invalidate `['ws', ws, 'hr']` để hàng đợi đơn cập nhật realtime (E2E-HR-02; test "realtime" trong `hr-page.test.tsx`). Phía nhân viên (`LEAVE_APPROVED`… ⇒ trang `/leave`, lịch tháng) vẫn là phần của E.
8. Thu hồi / tự xử lý đơn của mình (OWNER) / OWNER tự chỉnh số dư ⇒ ô lý do bắt buộc ở UI (khớp 422 REASON_REQUIRED/400 của D). HR không phải OWNER: ẩn nút với đơn/số dư/chấm công của chính mình (server vẫn 403).

## 7. Việc còn lại cho E

1. Rebase chuỗi a → b → c lên main khi T-038/T-039 vào; làm §4; `pnpm install --frozen-lockfile`.
2. Chạy toàn bộ vitest web + `pnpm verify` (xin lượt TL); viết `docs/reviews/T-041c-report.md` + `DONE T-041c`.
3. Xem tay `/hr` ở 360 / 1440, sáng / tối (bảng có `overflow-x-auto`, tab cuộn ngang) — H chưa xem được vì không chạy `next dev`.
4. Mock: ngày lễ / lịch HR lưu chỉ để hiển thị — `MockAttendance` vẫn tính theo lịch mặc định, đếm ngày nghỉ của `MockLeave` chưa trừ ngày lễ. Gửi / hủy / duyệt đơn trong mock của E chưa ghi thông báo (test realtime tự gọi `mock.notifications.notify`); duyệt / từ chối / thu hồi trong mock của H có ghi. Đủ cho UI; E2E dùng API thật.
5. Khi rebase lên T-037 bản có `userId` trong payload `member:grants-changed` (B-part2): thêm `userId` vào `grantsChanged()` ở `app/mock-api/workspace-events.ts` (main `0ec3bb4` chưa có trường này).
6. Tùy chọn: so khớp câu lỗi với mã thật của A/D khi chạy API thật (các hàm `*ErrorMessage` đọc `rule`/`reason` bằng schema cục bộ, không dùng enum đóng `BusinessRule`).

## 8. Ghi chú kỹ thuật

- `Intl.supportedValuesOf('timeZone')` của Node 24 KHÔNG có `Asia/Ho_Chi_Minh` (chỉ `Asia/Saigon`) — A đã né bằng `isSupportedTimeZone`; mock + DTO tạm làm y như A.
- Test: Radix Dialog đặt `aria-hidden` cho phần ngoài ⇒ khi dialog mở, `getByRole` không thấy phần tử nền — giữ tham chiếu trước khi mở (xem test "Bảng công").
- Trong máy này, viết file bằng heredoc bash chứa `''` có thể làm bash báo lỗi quoting — dùng công cụ ghi file.
