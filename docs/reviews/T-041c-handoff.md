# T-041c — Bàn giao cho Engineer E (từ Engineer H, đêm 2026-10-16)

**Nhánh:** `feat/T-041c-hr-web` (không push) · **Dựng trên:** `feat/T-041b-leave-web` @ `7817d42` → T-041a `268c7d4` → main `cfd2a05` (đã có T-037, T-038 attendance thật, T-040). Lần rebase cuối: `git rebase --onto feat/T-041b-leave-web 8483104 feat/T-041c-hr-web`, không xung đột; sau đó `b8571b3` (mock chuông lọc thông báo HR theo role ∪ grants — E nhờ).
**Worktree của H:** `C:\Users\Padoma1\AppData\Local\Temp\claude\d--TaskFlow-Enterprise\047c1980-aea3-41ae-a71e-564c65515379\scratchpad\h41c` — E nên tạo worktree riêng từ nhánh, không làm tiếp trong thư mục này (scratchpad của phiên H có thể bị dọn).

**E đã nhận c (2026-10-17 ~01:15):** main `fec8215` (có T-038/T-039/T-040b/T-041a) → T-041b `9876700` (bỏ commit contracts leave tạm; thư mục `m3-provisional` xóa ở commit riêng) → c rebase bằng `git rebase --onto feat/T-041b-leave-web 7817d42 feat/T-041c-hr-web`, 25 commit, không xung đột; head code `50be192` (sau đó chỉ có commit docs). App-header trong c giữ `HeaderHr` + slot `actions` (chuông do `app-shell` ráp — sửa FSD của T-041a). Kiểm nhẹ: tsc 0, lint:deps 0 vi phạm (500 module), eslint các file của c 0, vitest 7 file test của c + chuông + leave 81/81. Lần rebase sau (khi b lên main): `git rebase --onto main 9876700 feat/T-041c-hr-web`.

## 1. Trạng thái

Đủ phạm vi T-041c theo vé + `attendance-leave.md` §5, §6, §9. Contracts đều là bản THẬT (`@taskflow/contracts/attendance` của A, `@taskflow/contracts/leave` của D) — thư mục `shared/api/m3-provisional` đã xóa. Chạy trên **mock**; chưa chạy với API thật (T-038 đã vào main `cfd2a05`, T-039 chưa).

| Phần | Trạng thái |
|---|---|
| Công tắc "Quản lý nhân sự" (cài đặt › thành viên, chỉ OWNER) | ✅ + review của E/TL đã sửa |
| `/w/:ws/hr` — Hôm nay | ✅ |
| Bảng công tháng (50 người/trang) + xuất CSV + xem/thêm/hủy lượt | ✅ |
| Đơn nghỉ — duyệt / từ chối / thu hồi | ✅ |
| Lịch làm việc (phiên bản) & ngày lễ | ✅ |
| Số phép (chỉnh điều chỉnh) | ✅ |
| Lối vào "Nhân sự" (header + thẻ chấm công), chuông `LEAVE_SUBMITTED` ⇒ `?tab=leave` | ✅ |
| Realtime: hàng đợi HR khi có đơn mới/hủy; phía nhân viên khi đơn được xử lý / HR sửa công | ✅ |
| Toàn bộ vitest apps/web | ✅ exit 0 trên `6b6b811` (gốc cũ) — **CHƯA chạy lại trên gốc mới** (`7f5ae98`); TL xếp vào lượt verify T-041c — xem §5 |
| Rà giao diện trình duyệt thật (next dev :3022 + mock, Chromium, 3 cỡ × sáng/tối, axe) | ✅ 42/42 sạch sau khi sửa — xem §5b |
| `pnpm verify`, E2E-HR (F) | ⏳ chờ chuỗi a→b→c lên main có backend (TL) |

## 2. Commit (cũ → mới, sau lần rebase cuối lên `8483104`)

`git log --oneline 8483104..feat/T-041c-hr-web` — tóm tắt:

| Nội dung | |
|---|---|
| Công tắc grant; `http.put`, `http.download()` (Blob, Bearer, refresh khi TOKEN_EXPIRED) | feat |
| Sửa theo review: công tắc khóa cho Chủ sở hữu/Người xem + chú thích; `filename*` RFC 6266; PATCH role ⇒ phát `member:grants-changed []` | fix |
| Mock API phía HR (+ `hr-api.test.ts`) | feat |
| Trang `/hr` 5 tab + `test/hr-page.test.tsx` | feat |
| Xóa cache `['ws', ws, 'hr']` ngay khi mất `hr:manage` | fix |
| Unit test: tổng tháng, thay 1 ô cache, câu lỗi duyệt đơn | test |
| Link "Nhân sự" trên header (E2E-HR-03) | feat |
| Test XSS mức tích hợp (E2E-HR-08) | test |
| Realtime phía HR + phía nhân viên (E nhờ) | feat |
| `DELETE holidays/:date` không body trừ khi cần `{ reason }` (A) | fix |
| **Đổi sang contracts thật của A**, xóa `m3-provisional`; `MockHr.day` truyền ngày gia nhập ⇒ `NOT_EMPLOYED` | refactor |
| **Mock dev 500 mọi route** (mock import `@/entities/attendance` có hook React vào route handler server) + route mock thiếu `PUT` | fix |
| Sửa sau rà trình duyệt: tràn 360, vùng cuộn focus được, cột grant, không thêm lượt cho ngày tương lai | fix |
| handoff (nhiều lần) | docs |

**Hash code cuối: `7f5ae98`** (TL đã nhận). Sau đó chỉ có commit handoff này.

## 3. Bản đồ file

- **Trang:** `app/(app)/w/[wsId]/hr/page.tsx` → `src/views/hr/ui/hr-page.tsx` (+ `hr-tabs.tsx`: WAI-ARIA tabs, ←/→/Home/End, `?tab=today|timesheet|leave|calendar|balances`).
- **Entity:** `src/entities/hr/` — `api/hr.api.ts` (`hrAttendanceApi`, `hrLeaveApi`), `model/use-hr.ts` (hooks), `model/query-keys.ts` (`hrKeys` dưới `['ws', wsId, 'hr']`), `model/use-forget-hr.ts`, `lib/timesheet-cache.ts` (`replaceTimesheetDay`, `totalsOf`), `lib/calendar-errors.ts`.
- **Widgets:** `hr-today`, `hr-timesheet` (+ `person-month.tsx` dùng lại `MonthTable` của E), `hr-leave-queue`, `hr-calendar` (+ `holiday-list.tsx`), `hr-balances`; `app-header/ui/header-hr.tsx`; link trong `attendance-card`.
- **Features:** `member-grants` (công tắc), `hr-leave-decide`, `hr-attendance-adjust` (dialog lượt thô + hủy + thêm), `hr-export-csv`, `hr-balance-adjust`, `hr-schedule-edit`, `hr-holiday-edit`.
- **Shared:** `shared/api/http.ts` (+`put`, `download`, `accept`), `shared/lib/save-blob.ts`.
- **Mock:** `mock-hr.ts`, `hr-attendance-handlers.ts`, `hr-calendar-handlers.ts`, `hr-leave-handlers.ts` (đăng ký TRƯỚC `leave-handlers` của E: `GET leave-requests?mine=1` trả `undefined` ⇒ MSW chuyển sang handler của E); `grants` trong `mock-workspaces`, `PUT members/:userId/grants`, `forbiddenUnlessGranted`; `MockAttendance` thêm `adjust`, `entries()`, `serverNow`; `MockLeave.adjustments`; `app/mock-api/v1/[...path]/route.ts` export `PUT`; `server-safe-imports.test.ts` cấm mock import `@/entities|features|widgets|views`.
- **File của E đã sửa nhỏ (E đồng ý):** `features/realtime-session/model/use-realtime-session.ts`, `widgets/attendance-card`, `entities/notification/lib/notification-text.ts`, `entities/attendance/ui/month-table.tsx` (khung cuộn `relative`), `widgets/member-table` (cột + `relative`), `app/mock-api/v1/[...path]/route.ts` (`PUT`).
- **Test:** `test/hr-page.test.tsx` (11), `test/hr-grants.test.tsx` (3), `src/app/mock-api/hr-api.test.ts` (8), `src/app/mock-api/server-safe-imports.test.ts` (1), `src/entities/hr/lib/timesheet-cache.test.ts` (3), `src/features/hr-leave-decide/model/decide-errors.test.ts` (8), thêm ca vào `src/shared/api/http.test.ts`; route `/hr` trong `test/app-harness.tsx`.

## 4. Contracts — ĐÃ dùng bản thật

`AttendanceCompanyTodayDto`, `AttendanceMemberMonthDto`, `AttendanceDayDto` (có `timezone`), `DayStatus` (có `NOT_EMPLOYED`), `WorkScheduleDto`, `CreateWorkScheduleBody`, `HolidayDto`, `PutHolidayBody`, `DeleteHolidayBody` từ `@taskflow/contracts/attendance`; nghỉ phép từ `@taskflow/contracts/leave`. `/hr` chỉ dùng `DAY_STATUS` của E (không nhãn riêng); `NOT_EMPLOYED` không được đếm ở ô tổng "Hôm nay" và `totalsOf` (khớp A "tính 0").

Ghi chú API thật của A: mọi POST/PUT/PATCH có `Content-Type: application/json` + `{}` (http client đã làm), `GET attendance?month` `limit` ≤ 50 (web gửi 50), `DELETE holidays/:date` không body trừ ngày đã qua.

Có thể làm khi rảnh: mock dùng `AttendanceCompanyMonthQuery`, `HolidayListQuery`, `HolidayDateParams` của A thay cho schema tự viết.

## 5. Lệnh đã chạy (exit 0)

Trong worktree H, `pnpm` qua shim corepack, `--maxWorkers=2`:
- **Toàn bộ vitest apps/web** (lượt TL, máy rảnh, commit `7edb6d4` — trước khi đổi sang contracts thật): `pnpm exec vitest run --maxWorkers=2` trong `apps/web` ⇒ **exit 0, 74 file / 548 test**; `--config vitest.server.config.ts` ⇒ **exit 0, 1 file / 2 test**.
- Sau khi đổi contracts + sửa rà trình duyệt: `tsc --noEmit -p apps/web` sạch; `eslint .` toàn bộ apps/web exit 0; `prettier --check apps/web` sạch; vitest từng file: hr-page 11/11, hr-grants 3/3, toàn bộ `src/app/mock-api` (gồm hr-api 8, server-safe-imports 1), timesheet-cache, decide-errors, attendance-page, attendance-card, admin-screens, notification-bell, leave-page — xanh. Mọi commit qua hook lefthook (gitleaks + prettier + eslint) ✔.
- **Toàn bộ vitest apps/web lần 2** (lượt TL, commit `6b6b811` — đã dùng contracts thật, sau mọi sửa của rà trình duyệt): `web` **exit 0, 75 file / 549 test**; `web-server` **exit 0, 1 file / 2 test**.
- **Sau lần rebase cuối lên T-041b `7817d42` (head `7f5ae98`):** tsc sạch, `eslint .` toàn apps/web exit 0, vitest liên quan 90/90 (mock-api, hr-page, hr-grants, notification-bell, leave-page). **Vitest TOÀN BỘ apps/web CHƯA chạy lại trên gốc mới** — TL không cấp lượt đêm nay (máy verify T-041a → E2E của F → T-039); chạy trong lượt verify T-041c.
- **CHƯA:** `pnpm verify`, E2E (F) — sau khi chuỗi a→b→c lên main có backend.

## 5b. Rà giao diện trên trình duyệt thật (next dev :3022 + mock, Playwright Chromium)

Script: `scratchpad/ui-review/review.mjs` của phiên H (seed qua mock: OWNER + MEMBER + PM có `HR_MANAGE` + VIEWER, chấm vào, 1 đơn ANNUAL, 1 ngày lễ). `/hr` 5 tab + dialog lượt thô + cài đặt thành viên × 360 / 768 / 1440 × sáng / tối = **42 tổ hợp**:
- **Lượt đầu (trước khi sửa):** 4/42 lỗi — 360 tab Số phép tràn ngang **220 px** (sáng + tối): `<span class="sr-only">` trong `<th>` cuối là `position:absolute` không có tổ tiên `relative` ⇒ bị định vị theo trang; 360 tab Hôm nay axe `scrollable-region-focusable` (bảng cuộn ngang không có phần tử focus được).
- **Đã sửa:** khung cuộn của mọi bảng là `relative overflow-x-auto` (HR, `MonthTable`, bảng thành viên); khung bảng "Hôm nay" là `role="region"` có tên + `tabIndex={0}`; ô công tắc grant `min-w-40` (ở 360 chú thích khóa bị vỡ từng chữ); dialog lượt thô không cho thêm lượt cho ngày sau hôm nay (server date), hiện lý do.
- **Lượt cuối:** **0 tràn, 0 lỗi axe WCAG 2.1 A/AA serious/critical ở cả 42.**
- **Thứ tự Tab** (1440, sáng; đã gỡ nút dev-tools `nextjs-portal` của next dev): `/hr?tab=today`: TaskFlow → Nhân sự → Chấm vào → Thông báo → Tài khoản → Đăng xuất → tab "Hôm nay" (chỉ tab đang chọn — roving) → vùng "Bảng chấm công hôm nay". `/hr?tab=leave`: … → tab "Đơn nghỉ" → ô Trạng thái → Duyệt đơn của Nguyễn An → Từ chối đơn của Nguyễn An. ArrowRight trên tab "Hôm nay" ⇒ focus "Bảng công tháng", URL `?tab=timesheet`.
- **Bảng tháng:** `<caption>` = tên nhân viên, 6 `th[scope=col]` (Ngày, Trạng thái, Vào, Ra, Giờ làm, Muộn / sớm), `th[scope=row]` 31/31 hàng; trạng thái là chữ + biểu tượng `aria-hidden` ("! Chưa chấm ra", "○ Chưa tới giờ", "– Không phải ngày làm", "· Chưa/không làm việc").
- **NOT_EMPLOYED trung tính:** "· Chưa/không làm việc", lớp `text-text-muted` (rgb 91,97,112 ở chế độ sáng) — không dùng màu vắng.
- **Phát hiện không chặn:** ở 360 bảng thành viên (của E) cuộn ngang trong khung, cột "Quản lý nhân sự" nằm ngoài khung nhìn ban đầu — đúng mẫu bảng hiện có; nếu muốn thì đổi bố cục dòng thành thẻ ở màn hẹp.
- Server đã tắt (PID theo cổng 3022), cổng trống.

## 6. Quyết định H tự đưa ra (TL/E xem lại được)

1. Chú thích công tắc dùng `ROLE_LABEL` ("Chủ sở hữu luôn có quyền Quản lý nhân sự" / "Người xem không được cấp quyền Quản lý nhân sự") theo góp ý E4 của E — TL ban đầu viết "OWNER luôn có quyền nhân sự"; cùng ý, khác chữ.
2. CẤP quyền phải xác nhận (mở dữ liệu nhạy cảm), THU làm ngay.
3. Tab theo `?tab=`; chuông `LEAVE_SUBMITTED` ⇒ `/hr?tab=leave`.
4. Link header ẩn dưới `sm` (header 360 đã chật); màn hẹp dùng link trên thẻ chấm công.
5. Bảng tháng: dòng tổng mỗi người + bấm tên ⇒ lịch tháng của người đó (không vẽ lưới 50×31). Thêm/hủy lượt ⇒ thay 1 ô từ `{event, day}` + tính lại tổng người đó ở client bằng `totalsOf` (CÙNG quy tắc A gửi) — nếu A đổi quy tắc tổng, sửa `totalsOf` hoặc invalidate dòng.
6. "Tháng sau" khóa ở tháng hiện tại; Số phép chỉ năm nay ±1 (giới hạn PATCH); "Còn lại" âm tô đỏ; không thêm lượt chấm cho ngày tương lai (cần A xác nhận API có chặn không).
7. Mất `hr:manage` ⇒ `removeQueries(['ws', ws, 'hr'])` ở `HrPage` (`useForgetHrWhenRevoked`, cả khi hạ role) và trong handler `member:grants-changed` (mọi trang). `notification:new`: `LEAVE_SUBMITTED`/`LEAVE_CANCELLED` ⇒ invalidate `['ws', ws, 'hr']`; `LEAVE_APPROVED/REJECTED/REVOKED/CANCELLED`, `ATTENDANCE_ADJUSTED` ⇒ invalidate `leaveKeys.all` + `attendanceKeys.all` (E nhờ). E không sửa `use-realtime-session.ts` tới khi T-041c merge.
8. Thu hồi / tự xử lý đơn của mình (OWNER) / OWNER tự chỉnh số dư ⇒ ô lý do bắt buộc ở UI (khớp 422 REASON_REQUIRED/400 của D). HR không phải OWNER: ẩn nút với đơn/số dư/chấm công của chính mình (server vẫn 403).

## 7. Việc còn lại cho E

1. Sau khi T-041a merge (TL đang verify) E rebase b lên main; rebase c bằng `git rebase --onto feat/T-041b-leave-web 7817d42 feat/T-041c-hr-web` (`7817d42` = gốc b hiện tại của c). Khi T-039 vào main lặp lại tương tự; `pnpm install --frozen-lockfile`, `prisma generate`, xóa `apps/web/.next/dev/types` nếu tsc báo route lạ.
2. Chạy lại TOÀN BỘ vitest web + `pnpm verify` (xin lượt TL); viết `docs/reviews/T-041c-report.md` + `DONE T-041c`.
3. Thử `/hr` với API thật (A/D) — các hàm `*ErrorMessage` đọc `rule`/`reason` bằng schema cục bộ; so khớp câu lỗi.
4. Mock: lịch HR lưu chỉ để hiển thị — `MockAttendance` vẫn tính theo lịch mặc định; đếm ngày nghỉ của `MockLeave` chưa trừ ngày lễ; gửi/hủy đơn trong mock của E chưa ghi thông báo (duyệt/từ chối/thu hồi của mock HR có ghi); chuông mock lọc thông báo dành cho HR theo role ∪ grants (`b8571b3`). Đủ cho UI; E2E dùng API thật.
5. Khi T-037 bản có `userId` trong payload `member:grants-changed` (B-part2) vào: thêm `userId` vào `grantsChanged()` ở `app/mock-api/workspace-events.ts`.

## 8. Ghi chú kỹ thuật

- **Mock API chạy phía server** (route handler của next dev): KHÔNG import `@/entities|features|widgets|views` — barrel kéo hook React ⇒ next dev lỗi RSC, mọi route mock 500. Vitest/jsdom không thấy; đã có `server-safe-imports.test.ts`.
- `Intl.supportedValuesOf('timeZone')` của Node 24 KHÔNG có `Asia/Ho_Chi_Minh` (chỉ `Asia/Saigon`) — A dùng `isSupportedTimeZone`.
- `sr-only` trong bảng cuộn ngang: khung cuộn phải `relative`, nếu không trang bị kéo rộng ở 360.
- Test: Radix Dialog đặt `aria-hidden` cho phần ngoài ⇒ khi dialog mở, `getByRole` không thấy phần tử nền — giữ tham chiếu trước khi mở (xem test "Bảng công").
- Trong máy này, heredoc bash chứa `''` có thể làm bash báo lỗi quoting — dùng công cụ ghi file.
