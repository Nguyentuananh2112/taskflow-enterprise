# Mốc 3 — Chấm công & Nghỉ phép (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **ĐÃ DUYỆT** (người dùng, 2026-10-16). ADR-119…123 trong `docs/blueprint/DECISIONS.md`; rủi ro R25–R30 trong `threat-model.md` §6; vé T-037…T-042.

## 0. Người dùng đã chốt
| Điểm | Chốt |
|---|---|
| Ai là admin | Quyền mới **"Quản lý nhân sự"** (`hr:manage`): OWNER mặc định có; OWNER cấp thêm được cho thành viên khác (HR, kế toán) mà không phải nâng lên OWNER |
| Chống gian lận | **Không giới hạn** nơi chấm — chỉ ghi IP + User-Agent mỗi lần chấm để HR đối chiếu |
| Ca làm | **Thứ 2 → thứ 7, 08:00–17:30**. Giả định nghỉ trưa **12:00–13:30** (để đủ 8 h/ngày, 48 h/tuần — BLLĐ 2019 Đ.105); HR sửa được |
| Thời điểm | Sau Mốc 1 (push + CI xanh), chạy localhost; deploy để sau |
| Máy chấm công vân tay/khuôn mặt | Làm SAU — v1 chỉ chừa sẵn chỗ (§7) |

**Một workspace = một công ty.** Chấm công/nghỉ phép thuộc workspace; dùng lại cách ly tenant (404 chung — ADR-020), kiểm quyền 2 lớp (`permit` + `requirePermission`), realtime phòng `user:{id}`.

## 1. Phạm vi v1
**Có:** chấm vào/ra trên web (giờ server), bảng công ngày/tháng tính đi muộn/về sớm/giờ làm, lịch làm việc có hiệu lực theo ngày, ngày lễ do HR nhập, HR thêm/hủy lượt chấm (có lý do, có audit), đơn nghỉ (gửi → duyệt/từ chối/hủy), số ngày phép năm, trung tâm thông báo trong app (chuông), xuất CSV bảng công tháng.

**Không (để sau):** tăng ca/OT và tính lương, nhiều ca/ca đêm/xoay ca, giới hạn IP/GPS, email thông báo (chưa có hạ tầng mail), đơn "điều chỉnh công" do nhân viên tự gửi (v1: nhân viên báo HR, HR thêm lượt chấm), phòng ban/quản lý trực tiếp, máy chấm công.

**Ai được chấm công/xin nghỉ:** OWNER, PM, MEMBER. **VIEWER không** (khách/đối tác xem dự án, không phải nhân viên). HR thấy cả công ty, nhân viên chỉ thấy của mình.

## 2. ADR đề xuất

**ADR-119 — Quyền cấp thêm theo thành viên (grants).** Hiện quyền chỉ suy từ `role`. Thêm cột `WorkspaceMember.grants MemberGrant[] @default([])` (enum Postgres, v1 chỉ có `HR_MANAGE`). Quyền hiệu lực = `ROLE_PERMISSIONS[role] ∪ GRANT_PERMISSIONS[grants]` — một hàm thuần `effectivePermissions(role, grants)` trong `workspace/domain/roles.ts`, bản Zod trong contracts, test parity như ADR-080. `loadMembership` đọc `grants` trong cùng câu truy vấn đang có (không thêm query, không cache). Chỉ OWNER cấp/thu (`hr:grant`); không cấp cho VIEWER (422); đổi role sang VIEWER ⇒ xóa grants trong cùng transaction. Cấp/thu ⇒ audit + event `member:grants-changed` tới `user:{id}` để web làm mới quyền.
*Bác:* bảng grant riêng (thêm join mỗi request, chưa cần); cờ boolean `isHr` (mỗi quyền mới một cột); role mới `HR` (một người vừa là PM vừa làm HR thì không biểu diễn được).

**ADR-120 — Múi giờ nằm trong phiên bản lịch làm việc.** Server vẫn không phụ thuộc múi giờ (R4). Múi giờ (IANA, mặc định `Asia/Ho_Chi_Minh`, Zod kiểm bằng `Intl.supportedValuesOf('timeZone')`) là một trường của `WorkSchedule` (có phiên bản, ADR-121) — **không** đặt ở `Workspace` — nên đổi múi giờ chỉ áp dụng từ phiên bản mới, không làm sai muộn/sớm tháng cũ (góp ý A#3). "Ngày công" (`workDate`) = ngày của thời điểm server ghi nhận, quy đổi theo múi giờ của lịch đang hiệu lực bằng `Intl.DateTimeFormat` (không thêm thư viện ngày); lưu cứng lúc ghi. Client KHÔNG gửi giờ chấm.

**ADR-121 — Chấm công là log sự kiện bất biến; bảng công tính khi đọc.** Bảng `AttendanceEvent` chỉ thêm, không sửa; sai thì HR **hủy** (`voidedAt/voidedBy/voidReason`) và thêm lượt `ADJUSTMENT`. Bảng công ngày/tháng tính bằng hàm thuần `summarizeDay(events, schedule, holiday, leave)` — không lưu bảng tổng hợp (tránh lệch dữ liệu; 500 người × 31 ngày × 2 sự kiện ≈ 31 nghìn dòng — đọc 1 lần theo index là đủ). Lịch làm việc lưu theo **phiên bản có hiệu lực từ ngày** để đổi lịch không làm sai số liệu tháng cũ. Vì tính khi đọc, **quá khứ không được sửa âm thầm**: lịch mới chỉ hiệu lực từ hôm nay; thêm/sửa/xóa ngày lễ có ngày < hôm nay ⇒ 422 với HR, chỉ OWNER làm được và bắt buộc lý do + `HrAuditLog` (góp ý A#4). Về sau: "chốt công tháng" (khóa tháng).
*Bác:* lưu bảng `AttendanceDay` cập nhật mỗi lần chấm (phải đồng bộ khi đổi lịch/duyệt nghỉ/hủy lượt — nhiều chỗ sai hơn); ngăn chấm trùng bằng code thuần (race) — dùng unique index một phần.

**ADR-122 — Đơn nghỉ và số ngày phép.** Trạng thái `PENDING → APPROVED | REJECTED | CANCELLED`, `APPROVED → CANCELLED | REVOKED` (bảng chuyển đầy đủ ở §9; optimistic lock `version`, xung đột ⇒ 409). Không cho 2 đơn PENDING/APPROVED chồng ngày của cùng người: kiểm trong transaction dưới `pg_advisory_xact_lock(workspace, user)` (không dùng exclusion constraint vì cần extension `btree_gist` — vai trò migrator không tạo được extension). Người duyệt có `hr:manage` và **khác người gửi**; riêng OWNER tự duyệt được đơn của mình (chủ công ty). Phép năm: `LeaveBalance(year, entitledDays mặc định 12, adjustmentDays)`; "đã dùng" tính khi đọc từ đơn APPROVED loại ANNUAL; đơn ANNUAL chỉ hợp lệ khi `entitled + adjustment − used − pending_khác ≥ days(đơn này)` (`pending_khác` loại chính đơn đang xét), kiểm cả lúc gửi lẫn lúc duyệt, trong khóa (§9); vượt ⇒ 422. Không cho đơn vắt qua 2 năm (v1). Số ngày nghỉ = số ngày làm việc trong khoảng theo lịch hiệu lực, trừ ngày lễ; nửa ngày = 0,5.

**ADR-123 — Thông báo bền trong app.** Bảng `Notification` ghi **trong cùng transaction** với thay đổi nghiệp vụ (không mất khi rớt socket); sau commit phát `notification:new` tới `user:{id}` (best-effort như hiện nay — client tải lại danh sách khi kết nối lại). Payload chỉ chứa id + loại (không chép lý do nghỉ/ghi chú vào thông báo); web dựng câu chữ. Danh sách chỉ trả thông báo của workspace người dùng còn là thành viên.

## 3. Dữ liệu (Prisma, migration thứ 3)
```
enum MemberGrant        { HR_MANAGE }
enum AttendanceKind     { IN OUT }
enum AttendanceSource   { WEB DEVICE ADJUSTMENT }
enum LeaveType          { ANNUAL SICK PERSONAL_PAID UNPAID OTHER }
enum LeaveDayPart       { FULL AM PM }
enum LeaveStatus        { PENDING APPROVED REJECTED CANCELLED REVOKED }
enum NotificationType   { LEAVE_SUBMITTED LEAVE_APPROVED LEAVE_REJECTED LEAVE_CANCELLED LEAVE_REVOKED ATTENDANCE_ADJUSTED HR_GRANTED HR_REVOKED }

WorkspaceMember  + grants MemberGrant[] @default([])

WorkSchedule      (id, workspaceId, effectiveFrom Date, timezone String @default("Asia/Ho_Chi_Minh"),
                   workdays Int /*bitmask T2..CN*/,
                   startMin, endMin, breakStartMin, breakEndMin, graceMin, createdBy, createdAt)
                   @@unique([workspaceId, effectiveFrom])          -- seed: T2–T7, 480/1050/720/810, grace 0
Holiday           (workspaceId, date Date, name) @@id([workspaceId, date])
AttendanceEvent   (id, workspaceId, userId, kind, source, occurredAt Timestamptz(3), workDate Date,
                   ip?, userAgent?(≤256), deviceId?, idempotencyKey?, note?(≤500),
                   createdBy, voidedAt?, voidedBy?, voidReason?)
                   @@index([workspaceId, workDate]) @@index([workspaceId, userId, workDate])
                   SQL tay: UNIQUE (workspaceId,userId,workDate) WHERE kind='IN' AND source='WEB' AND voidedAt IS NULL
                            UNIQUE (workspaceId,userId,source,idempotencyKey) WHERE idempotencyKey IS NOT NULL
                   -- key gắn theo user (góp ý A#1, B-M6): Zod UUID bắt buộc; key của user khác không bao giờ va.
                   --   Replay chỉ trả kết quả khi ws+user+kind trùng (cùng key khác kind ⇒ 422 `idempotency_key_reused`)
                   --   và VẪN kiểm membership/quyền hiện tại trước. DEVICE sau này: key theo deviceId.
LeaveRequest      (id, workspaceId, userId, type, startDate, endDate, dayPart /*≠FULL chỉ khi start=end*/,
                   reason(≤1000), status, decidedBy?, decidedAt?, decisionNote?(≤500), version, timestamps)
                   -- KHÔNG lưu `days`: số ngày tính khi đọc từ lịch + ngày lễ (D-H3a, nhất quán ADR-121)
                   CHECK endDate >= startDate; @@index([workspaceId, status]) @@index([workspaceId, userId, startDate])
LeaveBalance      (workspaceId, userId, year, entitledDays Decimal(4,1) @default(12), adjustmentDays Decimal(4,1) @default(0), version)
                   @@id([workspaceId, userId, year])                -- tạo lười khi đọc lần đầu
Notification      (id, workspaceId, recipientId, type, refId, actorId?, readAt?, createdAt)
                   @@index([recipientId, readAt, createdAt])
HrAuditLog        (id, workspaceId, actorId, action, targetUserId?, refId?, before Json?, after Json?, createdAt)
                   -- như TaskAuditLog: chỉ thêm; action: GRANT/REVOKE, SCHEDULE_SET, HOLIDAY_SET/DELETE,
                   --   EVENT_ADJUST/VOID, LEAVE_SUBMIT/CANCEL/DECIDE/REVOKE, BALANCE_ADJUST, EXPORT (tháng + số dòng)
                   -- before/after KHÔNG chép `reason` của đơn nghỉ (B-H2). Chỉ OWNER đọc HrAuditLog (B-L1).
```
**FK (góp ý A#2):** `workspaceId` → `workspaces` (cascade theo purge ADR-047); `userId`/`recipientId`/`actorId`/`decidedBy`/`createdBy` → `users` `onDelete: Restrict` như actor của TaskAuditLog — **KHÔNG** FK tới `WorkspaceMember`, để xóa thành viên/nghỉ việc không xóa lịch sử công, đơn, số dư. "Là thành viên" kiểm ở tầng ứng dụng lúc ghi. Tài nguyên con (event/đơn/số dư) luôn truy vấn kèm `workspaceId` của actor nên không trỏ chéo tenant. HR **vẫn xem/xuất được công của người đã rời** workspace (gắn nhãn "đã rời"); `userId` chưa từng có dữ liệu trong workspace ⇒ 404. `grant-app.sql` đã cấp DML cho mọi bảng — không cần script mới.

## 4. Quy tắc tính công (`summarizeDay`, hàm thuần, Stryker ≥ 90 %)
- Chữ ký (góp ý A#5): `summarizeDay({ date, events, schedule /*có timezone*/, holiday, leave /*FULL|AM|PM|null*/, now })` — nhận `now` để `PENDING`/`MISSING_OUT` vẫn thuần, test được.
- Lượt hợp lệ = chưa bị hủy. `firstIn` = IN sớm nhất, `lastOut` = OUT muộn nhất sau `firstIn`.
- Web: IN chỉ 1 lần/ngày (lần 2 ⇒ 409 `already_checked_in`, lặp request trùng `Idempotency-Key` của chính mình ⇒ trả kết quả cũ); OUT cần đã IN, bấm OUT lại ⇒ lượt mới, lấy lượt muộn nhất.
- **Ra sau 00:00** (góp ý A#7): OUT gắn vào `workDate` của lượt IN còn mở nếu OUT xảy ra **trước 06:00 (giờ của lịch) ngày kế tiếp** `workDate` đó — giờ chốt ngày công, hằng số v1 trong domain (TL chốt phương án b của A, thay "16 h"); không có IN mở ⇒ OUT thuộc ngày hiện tại (mồ côi, hiển thị thô).
- Giờ làm = phần giao của `[firstIn, lastOut]` với `[start, end]` trừ phần giao với giờ nghỉ trưa (đơn vị phút). Ngoài giờ chỉ hiển thị thô, không tính OT.
- Muộn = `firstIn − start` nếu `> graceMin` (không vượt grace ⇒ `lateMin = 0`, không cờ `late`); giờ làm khi chưa OUT (`inProgress`/`MISSING_OUT`) = 0; về sớm = `end − lastOut` nếu > 0. Nghỉ nửa ngày AM ⇒ mốc bắt đầu = `breakEnd`; PM ⇒ mốc kết thúc = `breakStart`.
- Trạng thái ngày, **theo thứ tự ưu tiên** (góp ý A#6): `HOLIDAY` > `OFF` (không phải ngày làm) > `ON_LEAVE` (nghỉ cả ngày) > `PRESENT` (+ cờ `late`/`early`; `inProgress` khi `now < end` và chưa OUT) / `MISSING_OUT` (đã qua giờ kết thúc mà chưa OUT) > `ABSENT` (ngày làm đã qua, không IN, không nghỉ) > `PENDING` (hôm nay chưa tới giờ / tương lai).
  - Nghỉ nửa ngày mà nửa kia không đi làm ⇒ `ABSENT` + cờ `absentHalf` (đếm 0,5 ngày vắng, không phải 1).
  - Chấm công vào ngày `OFF`/`HOLIDAY` ⇒ vẫn ghi nhận, trạng thái giữ nguyên + giờ thô (không tính OT ở v1).
  - **`NOT_EMPLOYED`** (ưu tiên cao nhất): ngày nằm ngoài mọi nhiệm kỳ thành viên (trước `joinedAt`, hoặc sau `leftAt` của lần rời) **và** không có lượt chấm chưa hủy ⇒ tính 0 ở mọi tổng và CSV; chính ngày gia nhập tính bình thường. Ngày rời lưu ở bảng `workspace_member_departures` (migration 4, ghi cùng transaction với lệnh xóa thành viên — T-037b của B); attendance đọc qua port `IMembershipTenurePort` (bên dùng sở hữu). Bác heuristic "sau lượt chấm cuối" vì làm mất ngày vắng thật trong tháng tính lương cuối (A phát hiện, TL chốt).
- Bảng ví dụ bắt buộc trong test: đúng giờ, muộn 1 phút với grace 0/5, IN trong giờ trưa, OUT trước trưa, chỉ có IN, OUT 2 lần, ra sau 00:00, nghỉ nửa ngày + đi làm nửa còn lại, nghỉ AM + vào muộn sau `breakEnd + grace`, nghỉ nửa ngày + vắng nửa kia, ngày lễ trùng thứ 7, đổi lịch giữa tháng, múi giờ có DST (vd `Europe/Berlin` ngày đổi giờ).

**Port giữa 2 module — do BÊN DÙNG sở hữu** (góp ý A#12, D-H4; tránh vòng import, đúng luật depcruise), nối ở composition root, chốt ngay để A và D làm song song bằng fake:

- `leave/application/ports/work-calendar.port.ts` — `workingDays({ workspaceId, from, to }): Promise<{ date, isWorkday, isHoliday, schedule }[]>`; adapter do A viết trong attendance.
- `attendance/application/ports/approved-leave.port.ts` — `approvedLeaves({ workspaceId, userIds?, from, to }): Promise<{ userId, date, part: 'FULL'|'AM'|'PM' }[]>`; adapter do D viết trong leave.

## 5. API (`/api/v1/workspaces/:wsId/…`, contracts Zod + đăng ký OpenAPI A2)
| Route | Quyền | Ghi chú |
|---|---|---|
| `GET attendance/me/today` · `POST attendance/check-in` · `POST attendance/check-out` | `attendance:self` | hạn mức 10/phút/user; header `Idempotency-Key` |
| `GET attendance/me?month=YYYY-MM` | `attendance:self` | bảng công tháng của mình |
| `GET attendance/today` · `GET attendance?month=` · `GET attendance/export.csv?month=` | `hr:manage` | `GET attendance?month=` phân trang theo nhân viên (cursor, limit 50). CSV: cả công ty, stream, UTF-8 BOM (Excel), chống CSV injection theo OWASP (ô bắt đầu bằng `= + - @ \t \r` ⇒ thêm `'`; bọc mọi ô bằng `"` và nhân đôi `"`), hạn mức, audit EXPORT |
| `POST attendance/events` (ADJUSTMENT) · `POST attendance/events/:id/void` | `hr:manage` | bắt buộc lý do; thông báo cho nhân viên |
| `GET attendance/events?userId=&date=YYYY-MM-DD` | `hr:manage` | lượt thô theo `workDate` của một người, gồm lượt đã hủy (`AttendanceEventDto` có id, IP/UA); `userId` chưa từng có dữ liệu ⇒ 404. ADJUSTMENT ⇒ 201, void ⇒ 200, cùng trả `AttendanceEventDto` (A, TL duyệt) |
| `GET attendance/me/events?date=YYYY-MM-DD` | `attendance:self` | lượt của chính mình kèm IP/UA (NĐ 13 Đ.14, §9) |
| `GET/POST attendance/schedules` · `GET/PUT/DELETE attendance/holidays/:date` | đọc: thành viên · ghi: `hr:manage` | lịch mới chỉ hiệu lực từ hôm nay trở đi |
| `POST leave-requests` · `GET leave-requests?mine=1` · `POST leave-requests/:id/cancel` | `leave:self` | hủy: của mình, PENDING hoặc APPROVED chưa tới ngày bắt đầu |
| `GET leave-requests/preview?type&startDate&endDate&dayPart` | `leave:self` | `{ days, remainingDays }` (null nếu không phải ANNUAL); kiểm tra như submit, không ghi, không khóa. `reason` của đơn **tùy chọn** (trim, ≤ 1000); ghi chú từ chối tùy chọn; thu hồi bắt buộc lý do (D, TL duyệt) |
| `GET leave-requests?status=` · `POST leave-requests/:id/approve` · `…/reject` · `…/revoke` | `hr:manage` | gửi `expectedVersion`; không tự duyệt (trừ OWNER) |
| `GET leave-balances/me?year=` · `GET leave-balances?year=` · `PATCH leave-balances/:userId/:year` | self · `hr:manage` | |
| `PUT members/:userId/grants` | `hr:grant` (OWNER) | |
| `GET /api/v1/me/notifications?cursor=` · `GET …/unread-count` · `POST …/:id/read` · `POST …/read-all` | đăng nhập | chỉ của mình; chỉ workspace còn là thành viên |

**Hợp đồng cho web (góp ý E):**

- CORS `allowedHeaders` (`core/http/middleware.ts`) thêm `Idempotency-Key` (T-038), có ca SEC preflight.
- `GET attendance/me/today` trả đủ cho thẻ + banner trong 1 lần gọi: `serverNow`, `timezone`, `isWorkday`, `isHoliday`, ca (`start/end/breakStart/breakEnd`), trạng thái ngày (`summarizeDay`), `firstIn`, `lastOut`, nghỉ hôm nay (`FULL|AM|PM|null`). Web chạy đồng hồ theo độ lệch `serverNow`, không tin giờ máy.
- Quyền: `WorkspaceDto`/membership thêm `myGrants`; event `member:grants-changed { workspaceId, grants }` cập nhật tức thì như `member:role-changed` (T-037/T-040).
- DTO danh sách thông báo join sẵn ngữ cảnh tối thiểu lúc đọc: `workspaceId` + tên workspace, tên actor, với đơn nghỉ: loại + khoảng ngày (KHÔNG lý do) — không để web gọi N request.
- Xuất CSV: web `fetch` (Bearer) → Blob → tải; không thêm URL ký.

**Thứ tự lỗi** (góp ý A#11, để F viết SEC khớp): không phải thành viên workspace ⇒ 404 `workspace` (ADR-020); thành viên gọi route `hr:manage` ⇒ **403** (route tồn tại với mọi thành viên, không lộ gì thêm); HR hỏi `userId` chưa từng có dữ liệu trong workspace ⇒ 404; id đơn/lượt chấm của workspace khác hoặc không tồn tại ⇒ 404; thành viên thường hủy đơn của người khác ⇒ 404 (không lộ id đơn tồn tại).

## 6. Web
- `/w/[wsId]` vẫn chuyển sang `/projects` (frontend.md §1.1); thẻ **Chấm công** đặt ở **đầu trang danh sách dự án** — màn hạ cánh sau khi chọn workspace, không thêm màn mới. VIEWER: ẩn toàn bộ UI chấm công/nghỉ (server vẫn 403). Lịch tháng là `<table>` có tiêu đề hàng/cột, trạng thái bằng chữ + biểu tượng (không chỉ màu). Thẻ gồm (giờ server hiện tại, trạng thái hôm nay, nút Vào/Ra). Header: nút gọn khi đang ở route có `wsId` (`useParams`), và **chuông thông báo** (số chưa đọc, danh sách, đánh dấu đã đọc).
- Sau đăng nhập, ngày làm việc mà chưa chấm vào ⇒ banner nhắc (KHÔNG tự chấm — phiên đăng nhập kéo dài nhiều ngày, mở ở nhà vẫn còn phiên).
- `/w/[wsId]/attendance`: lịch tháng của tôi. `/w/[wsId]/leave`: đơn của tôi + số phép còn + form gửi.
- `/w/[wsId]/hr` (ẩn nếu không có `hr:manage`; server vẫn kiểm): Hôm nay (ai vào/muộn/vắng/nghỉ) · Bảng công tháng + xuất CSV · Đơn chờ duyệt · Lịch làm việc & ngày lễ · Số ngày phép. Cài đặt thành viên: công tắc "Quản lý nhân sự" (chỉ OWNER thấy).
- Responsive 360 → 1440, sáng/tối, chuỗi tiếng Việt, giờ hiển thị theo múi giờ workspace (không theo máy).

## 7. Chừa chỗ cho máy chấm công (KHÔNG làm ở v1)
- Đã có sẵn: `source=DEVICE`, `deviceId`, `idempotencyKey` duy nhất, quy tắc "lượt sớm nhất/muộn nhất" chịu được nhiều lượt/ngày.
- Sau này: bảng `AttendanceDevice` (khóa bí mật riêng mỗi máy, lưu hash, thu hồi được), `WorkspaceMember.employeeCode`, `POST /api/v1/devices/attendance-events` theo lô, ký HMAC (thân + timestamp ±5 phút + nonce), máy mất mạng gửi bù — trùng `idempotencyKey` bỏ qua. Giờ lấy từ máy (có kiểm lệch đồng hồ) nên phải ghi rõ trong ADR riêng khi làm.
- **Sinh trắc học không rời khỏi máy** (vân tay/khuôn mặt là dữ liệu cá nhân nhạy cảm — NĐ 13/2023): máy tự nhận diện, chỉ gửi "mã nhân viên + thời điểm".

## 8. Bảo mật & kiểm thử (F viết `docs/design/test-spec-hr.md`)
- SEC: thành viên thường đọc công/đơn người khác ⇒ 404/403 đúng thứ tự; IDOR id đơn của workspace khác ⇒ 404; VIEWER chấm công ⇒ 403; HR tự duyệt ⇒ 403; PM không cấp được grant; thu grant xong request kế tiếp mất quyền ngay; CSV injection; IP/UA chỉ HR thấy.
- Đồng thời (CC): 2 check-in song song ⇒ đúng 1 IN; approve vs cancel song song ⇒ 1 thắng, 1 nhận 409; 2 đơn ANNUAL song song vượt số dư ⇒ 1 bị 422; 2 đơn chồng ngày song song ⇒ 1 bị 409.
- E2E: nhân viên chấm vào/ra; gửi đơn ⇒ HR thấy chuông realtime ⇒ duyệt ⇒ nhân viên thấy chuông + lịch đổi "Nghỉ phép"; OWNER cấp quyền HR cho MEMBER.
- Riêng tư: IP/UA là dữ liệu cá nhân, lý do nghỉ ốm là dữ liệu sức khỏe (nhạy cảm) — xem §9; **thời hạn lưu PHẢI chốt trước deploy** (R27).

## 9. Chốt sau review bảo mật (B) và nghỉ phép (D)

**Máy trạng thái đơn nghỉ** (D-H1) — thêm `REVOKED` vào `LeaveStatus`. "Hôm nay" = ngày theo múi giờ lịch hiệu lực (D-M5). Mọi chuyển khác ⇒ 409 `invalid_transition`.

| Từ → Đến | Ai | Điều kiện | Số dư | Thông báo · Audit |
|---|---|---|---|---|
| (mới) → PENDING | người gửi | ≥ 1 ngày làm việc (0 ⇒ 422 `no_working_days`); không chồng (theo ngày + phần: AM + PM cùng ngày hợp lệ, AM/PM + FULL là chồng — D-M2); ANNUAL không vượt "còn − đang chờ" | giữ chỗ | HR · LEAVE_SUBMIT |
| PENDING → APPROVED / REJECTED | `hr:manage`, khác người gửi (trừ OWNER) | người gửi vẫn là thành viên đủ điều kiện (không thì 409 `requester_not_member`, HR chỉ từ chối được — D-M4); approve kiểm LẠI số dư trong khóa (⇒ 422 `insufficient_balance` — D-H2) | trừ / trả | người gửi · LEAVE_DECIDE |
| PENDING → CANCELLED | người gửi | — | trả | HR · LEAVE_CANCEL |
| APPROVED → CANCELLED | người gửi | `startDate` > hôm nay | trả | HR · LEAVE_CANCEL |
| APPROVED → REVOKED | `hr:manage`, khác người gửi (trừ OWNER) | `startDate` > hôm nay; bắt buộc lý do | trả | người gửi · LEAVE_REVOKE |

Đơn đã bắt đầu: v1 không hủy/thu một phần. Không cộng dồn phép sang năm sau (v1). Người vào giữa năm: HR tự chỉnh `adjustmentDays` (BLLĐ tính theo tỷ lệ tháng).

**Khóa & số học (D-H2, M3, M6):** submit / approve / cancel / revoke / PATCH balance của cùng (ws, user, năm) lấy CÙNG `pg_advisory_xact_lock(hashtextextended('taskflow:leave:<ws>:<user>', 0))` và tính lại số dư trong khóa; `version` giữ cho xung đột trạng thái. Tạo `LeaveBalance` lười bằng `INSERT … ON CONFLICT DO NOTHING`. Domain đếm bằng **số nguyên nửa ngày** (×2), chỉ đổi sang thập phân ở biên DTO/DB. Giả định v1: mọi ngày làm cùng một hình dạng ca (D-M7).

**Luật "không tự xử lý dữ liệu của mình"** (B-H1): mọi lệnh ghi cần `hr:manage` có `targetUserId === actor` (adjust, void, PATCH balance, approve, reject, revoke) ⇒ **403**, trừ OWNER; OWNER tự làm ⇒ bắt buộc lý do + HrAuditLog (rủi ro chấp nhận R26).

**Thu quyền tức thì** (B-H3): lệnh ghi `hr:manage` đọc lại membership + grants **sau khi lấy khóa** trong transaction (như `lockOwnersAndReloadActor`), mất quyền ⇒ 403; có test stale-actor. Danh sách chuông lọc thông báo "dành cho HR" theo quyền **hiện tại**, không chỉ "còn là thành viên".

**Grants (B-M1, M2):** `GRANT_PERMISSIONS[HR_MANAGE]` liệt kê tường minh; test parity chứng minh KHÔNG gồm `hr:grant`, `member:*`, `workspace:*`, `project:*`; grant mới phải qua ADR. OWNER không lưu grant tường minh (cấp cho OWNER ⇒ 422); hạ role ⇒ response + audit hiện grants còn lại; hạ VIEWER ⇒ xóa grants.

**Dữ liệu nhạy cảm (B-H2, M5, L2–L4):** lý do nghỉ chỉ người gửi + `hr:manage` đọc; không vào CSV, thông báo, log, audit; form gợi ý "không cần ghi bệnh". CSV KHÔNG xuất IP/UA; `Content-Disposition` dựng từ `month` đã validate; `Cache-Control: no-store`; chống injection chỉ áp cho ô CHỮ (ô số/ngày do server sinh giữ nguyên); hạn mức theo user + ws. Nhân viên xem được IP/UA của chính mình (NĐ 13 Đ.14). IP lấy theo `TRUST_PROXY_HOPS`, chỉ để đối chiếu, không dùng ra quyết định. Ẩn danh hóa user phải xóa IP/UA trong `AttendanceEvent`.

**API bổ sung (B-M3, M4):** mọi truy vấn notifications có `recipientId = me` trong WHERE (id người khác ⇒ 404). `PATCH leave-balances/:userId/:year`: `userId` có lịch sử trong ws (không thì 404), `year` trong ±1 năm. Route `hr:manage`: `permit` chạy TRƯỚC validate body/query ⇒ thành viên thường gửi body sai nhận 403, không 400.

**Threat-model §6 thêm (B):** R25 không chống gian lận vị trí (người dùng chốt) · R26 OWNER tự duyệt/tự chỉnh của mình · R27 IP/UA + lý do nghỉ là dữ liệu cá nhân/nhạy cảm — thời hạn lưu, job xóa/ẩn danh, thông báo xử lý dữ liệu cho nhân viên phải chốt TRƯỚC deploy · R28 CSV đã tải ra ngoài tầm kiểm soát (chỉ audit EXPORT) · R29 realtime best-effort (có bảng bền) · R30 giữ lịch sử của người đã rời (gắn R27).

**CC bổ sung cho F (D-L3, L4):** submit ‖ PATCH balance; approve ‖ HR giảm số dư; 2 đơn nửa ngày AM ‖ PM (cả 2 thành công); thêm ngày lễ trùng đơn APPROVED (số ngày tính lại khi đọc); HR mất quyền giữa lúc mở và bấm duyệt. Không thêm `Idempotency-Key` cho gửi đơn (bấm 2 lần ⇒ 409 chồng ngày là đủ — D-L2).

## 10. Chia việc (sau khi duyệt; nhánh riêng, cổng như mọi việc)
| Vé | Ai | Nội dung | Phụ thuộc |
|---|---|---|---|
| T-037 | B | ADR-119/120: grants + `effectivePermissions` + parity, `HrAuditLog`, quyền mới trong ma trận, route grants, migration 3 (gồm toàn bộ bảng §3 để các vé sau không đụng nhau) | — (làm trước, ~½ ngày) |
| T-038 | A | Module `attendance`: lịch/ngày lễ, check-in/out, `summarizeDay`, bảng công, điều chỉnh/hủy, xuất CSV; adapter cho `WorkCalendarPort` của leave | T-037 |
| T-039 | D | Module `leave` theo bảng chuyển trạng thái §9: đơn, khóa, duyệt/từ chối/hủy/thu hồi, số dư; adapter cho `ApprovedLeavePort` của attendance | T-037 (2 port chốt ở §4) |
| T-040 | B | Module `notifications` + `notification:new` + `member:grants-changed`; leave/attendance gọi qua port | T-037 |
| T-041a/b/c | E | Web §6 chia 3 để nối API theo từng vé backend: (a) thẻ chấm công + `/attendance` + chuông/header, (b) `/leave`, (c) `/hr` + công tắc grant; bắt đầu từ contracts + mock | T-037 |
| T-042 | F | test-spec-hr, SEC/CC, E2E, Stryker cho `summarizeDay` + đếm ngày nghỉ | song song |

Ước tính: 4–5 ngày làm việc của cả đội (đường găng là web ~4 ngày — E), tùy tải máy.
