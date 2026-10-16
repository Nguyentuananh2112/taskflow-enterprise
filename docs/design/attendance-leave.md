# Mốc 3 — Chấm công & Nghỉ phép (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất** (Tech Lead, 2026-10-16). Các ADR-119…123 dưới đây chỉ ghi vào `docs/blueprint/DECISIONS.md` sau khi người dùng duyệt. Chưa ai được code trước khi duyệt.

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

**ADR-120 — Múi giờ workspace.** Server vẫn không phụ thuộc múi giờ (R4); thêm `Workspace.timezone` (IANA, mặc định `Asia/Ho_Chi_Minh`, Zod kiểm bằng `Intl.supportedValuesOf('timeZone')`). "Ngày công" (`workDate`) = ngày của thời điểm server ghi nhận, quy đổi theo múi giờ workspace bằng `Intl.DateTimeFormat` (không thêm thư viện ngày). Client KHÔNG gửi giờ chấm.

**ADR-121 — Chấm công là log sự kiện bất biến; bảng công tính khi đọc.** Bảng `AttendanceEvent` chỉ thêm, không sửa; sai thì HR **hủy** (`voidedAt/voidedBy/voidReason`) và thêm lượt `ADJUSTMENT`. Bảng công ngày/tháng tính bằng hàm thuần `summarizeDay(events, schedule, holiday, leave)` — không lưu bảng tổng hợp (tránh lệch dữ liệu; 500 người × 31 ngày × 2 sự kiện ≈ 31 nghìn dòng — đọc 1 lần theo index là đủ). Lịch làm việc lưu theo **phiên bản có hiệu lực từ ngày** để đổi lịch không làm sai số liệu tháng cũ.
*Bác:* lưu bảng `AttendanceDay` cập nhật mỗi lần chấm (phải đồng bộ khi đổi lịch/duyệt nghỉ/hủy lượt — nhiều chỗ sai hơn); ngăn chấm trùng bằng code thuần (race) — dùng unique index một phần.

**ADR-122 — Đơn nghỉ và số ngày phép.** Trạng thái `PENDING → APPROVED | REJECTED | CANCELLED` (optimistic lock `version`, xung đột ⇒ 409). Không cho 2 đơn PENDING/APPROVED chồng ngày của cùng người: kiểm trong transaction dưới `pg_advisory_xact_lock(workspace, user)` (không dùng exclusion constraint vì cần extension `btree_gist` — vai trò migrator không tạo được extension). Người duyệt có `hr:manage` và **khác người gửi**; riêng OWNER tự duyệt được đơn của mình (chủ công ty). Phép năm: `LeaveBalance(year, entitledDays mặc định 12, adjustmentDays)`; "đã dùng" tính từ đơn APPROVED loại ANNUAL; gửi đơn ANNUAL vượt "còn lại − đang chờ" ⇒ 422. Không cho đơn vắt qua 2 năm (v1). Số ngày nghỉ = số ngày làm việc trong khoảng theo lịch hiệu lực, trừ ngày lễ; nửa ngày = 0,5.

**ADR-123 — Thông báo bền trong app.** Bảng `Notification` ghi **trong cùng transaction** với thay đổi nghiệp vụ (không mất khi rớt socket); sau commit phát `notification:new` tới `user:{id}` (best-effort như hiện nay — client tải lại danh sách khi kết nối lại). Payload chỉ chứa id + loại (không chép lý do nghỉ/ghi chú vào thông báo); web dựng câu chữ. Danh sách chỉ trả thông báo của workspace người dùng còn là thành viên.

## 3. Dữ liệu (Prisma, migration thứ 3)
```
enum MemberGrant        { HR_MANAGE }
enum AttendanceKind     { IN OUT }
enum AttendanceSource   { WEB DEVICE ADJUSTMENT }
enum LeaveType          { ANNUAL SICK PERSONAL_PAID UNPAID OTHER }
enum LeaveDayPart       { FULL AM PM }
enum LeaveStatus        { PENDING APPROVED REJECTED CANCELLED }
enum NotificationType   { LEAVE_SUBMITTED LEAVE_APPROVED LEAVE_REJECTED LEAVE_CANCELLED ATTENDANCE_ADJUSTED HR_GRANTED HR_REVOKED }

WorkspaceMember  + grants MemberGrant[] @default([])
Workspace        + timezone String @default("Asia/Ho_Chi_Minh")

WorkSchedule      (id, workspaceId, effectiveFrom Date, workdays Int /*bitmask T2..CN*/,
                   startMin, endMin, breakStartMin, breakEndMin, graceMin, createdBy, createdAt)
                   @@unique([workspaceId, effectiveFrom])          -- seed: T2–T7, 480/1050/720/810, grace 0
Holiday           (workspaceId, date Date, name) @@id([workspaceId, date])
AttendanceEvent   (id, workspaceId, userId, kind, source, occurredAt Timestamptz(3), workDate Date,
                   ip?, userAgent?(≤256), deviceId?, idempotencyKey?, note?(≤500),
                   createdBy, voidedAt?, voidedBy?, voidReason?)
                   @@index([workspaceId, workDate]) @@index([workspaceId, userId, workDate])
                   SQL tay: UNIQUE (workspaceId,userId,workDate) WHERE kind='IN' AND source='WEB' AND voidedAt IS NULL
                            UNIQUE (workspaceId,source,idempotencyKey) WHERE idempotencyKey IS NOT NULL
LeaveRequest      (id, workspaceId, userId, type, startDate, endDate, dayPart /*≠FULL chỉ khi start=end*/,
                   days Decimal(4,1), reason(≤1000), status, decidedBy?, decidedAt?, decisionNote?(≤500), version, timestamps)
                   CHECK endDate >= startDate; @@index([workspaceId, status]) @@index([workspaceId, userId, startDate])
LeaveBalance      (workspaceId, userId, year, entitledDays Decimal(4,1) @default(12), adjustmentDays Decimal(4,1) @default(0), version)
                   @@id([workspaceId, userId, year])                -- tạo lười khi đọc lần đầu
Notification      (id, workspaceId, recipientId, type, refId, actorId?, readAt?, createdAt)
                   @@index([recipientId, readAt, createdAt])
HrAuditLog        (id, workspaceId, actorId, action, targetUserId?, refId?, before Json?, after Json?, createdAt)
                   -- như TaskAuditLog: chỉ thêm; action: GRANT/REVOKE, SCHEDULE_SET, HOLIDAY_SET/DELETE,
                   --   EVENT_ADJUST/VOID, LEAVE_DECIDE/REVOKE, BALANCE_ADJUST, EXPORT
```
Mọi FK kèm `workspaceId` (composite như project) để không trỏ chéo tenant. `grant-app.sql` đã cấp DML cho mọi bảng — không cần script mới.

## 4. Quy tắc tính công (`summarizeDay`, hàm thuần, Stryker ≥ 90 %)
- Lượt hợp lệ = chưa bị hủy. `firstIn` = IN sớm nhất, `lastOut` = OUT muộn nhất sau `firstIn`.
- Web: IN chỉ 1 lần/ngày (lần 2 ⇒ 409 `already_checked_in`, lặp request trùng `Idempotency-Key` ⇒ trả kết quả cũ); OUT cần đã IN, bấm OUT lại ⇒ lượt mới, lấy lượt muộn nhất.
- Giờ làm = phần giao của `[firstIn, lastOut]` với `[start, end]` trừ phần giao với giờ nghỉ trưa (đơn vị phút). Ngoài giờ chỉ hiển thị thô, không tính OT.
- Muộn = `firstIn − start` nếu `> graceMin`; về sớm = `end − lastOut` nếu > 0. Nghỉ nửa ngày AM ⇒ mốc bắt đầu = `breakEnd`; PM ⇒ mốc kết thúc = `breakStart`.
- Trạng thái ngày: `HOLIDAY`, `OFF` (không phải ngày làm), `ON_LEAVE`, `PRESENT` (+ cờ `late`/`early`), `MISSING_OUT` (đã qua giờ kết thúc mà chưa OUT), `ABSENT` (ngày làm đã qua, không IN, không nghỉ), `PENDING` (hôm nay chưa tới giờ / tương lai).
- Bảng ví dụ bắt buộc trong test: đúng giờ, muộn 1 phút với grace 0/5, IN trong giờ trưa, OUT trước trưa, chỉ có IN, nghỉ nửa ngày + đi làm nửa còn lại, ngày lễ trùng thứ 7, đổi lịch giữa tháng.

## 5. API (`/api/v1/workspaces/:wsId/…`, contracts Zod + đăng ký OpenAPI A2)
| Route | Quyền | Ghi chú |
|---|---|---|
| `GET attendance/me/today` · `POST attendance/check-in` · `POST attendance/check-out` | `attendance:self` | hạn mức 10/phút/user; header `Idempotency-Key` |
| `GET attendance/me?month=YYYY-MM` | `attendance:self` | bảng công tháng của mình |
| `GET attendance/today` · `GET attendance?month=` · `GET attendance/export.csv?month=` | `hr:manage` | CSV: UTF-8 BOM (Excel), chống CSV injection (`= + - @` đầu ô ⇒ thêm `'`), hạn mức, audit EXPORT |
| `POST attendance/events` (ADJUSTMENT) · `POST attendance/events/:id/void` | `hr:manage` | bắt buộc lý do; thông báo cho nhân viên |
| `GET/POST attendance/schedules` · `GET/PUT/DELETE attendance/holidays/:date` | đọc: thành viên · ghi: `hr:manage` | lịch mới chỉ hiệu lực từ hôm nay trở đi |
| `POST leave-requests` · `GET leave-requests?mine=1` · `POST leave-requests/:id/cancel` | `leave:self` | hủy: của mình, PENDING hoặc APPROVED chưa tới ngày bắt đầu |
| `GET leave-requests?status=` · `POST leave-requests/:id/approve` · `…/reject` · `…/revoke` | `hr:manage` | gửi `expectedVersion`; không tự duyệt (trừ OWNER) |
| `GET leave-balances/me?year=` · `GET leave-balances?year=` · `PATCH leave-balances/:userId/:year` | self · `hr:manage` | |
| `PUT members/:userId/grants` | `hr:grant` (OWNER) | |
| `GET /api/v1/me/notifications?cursor=` · `GET …/unread-count` · `POST …/:id/read` · `POST …/read-all` | đăng nhập | chỉ của mình; chỉ workspace còn là thành viên |

Id của tài nguyên workspace khác / không tồn tại ⇒ **404** như hiện tại (không 403 lộ tồn tại).

## 6. Web
- Trang chủ workspace `/w/[wsId]`: thẻ **Chấm công** (giờ server hiện tại, trạng thái hôm nay, nút Vào/Ra). Header: nút gọn khi đang ở route có `wsId` (`useParams`), và **chuông thông báo** (số chưa đọc, danh sách, đánh dấu đã đọc).
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
- Riêng tư: IP/UA là dữ liệu cá nhân — chỉ HR xem, ghi vào threat-model; thời hạn lưu trữ quyết định khi deploy.

## 9. Chia việc (sau khi duyệt; nhánh riêng, cổng như mọi việc)
| Vé | Ai | Nội dung | Phụ thuộc |
|---|---|---|---|
| T-037 | B | ADR-119/120: grants + `effectivePermissions` + parity, `Workspace.timezone`, `HrAuditLog`, quyền mới trong ma trận, route grants, migration 3 (gồm toàn bộ bảng §3 để các vé sau không đụng nhau) | — (làm trước, ~½ ngày) |
| T-038 | A | Module `attendance`: lịch/ngày lễ, check-in/out, `summarizeDay`, bảng công, điều chỉnh/hủy, xuất CSV; cổng `WorkCalendarPort` cho leave | T-037 |
| T-039 | D | Module `leave`: đơn, khóa chồng ngày, duyệt/từ chối/hủy/thu hồi, số dư; dùng `WorkCalendarPort` | T-037 (+ hợp đồng port của T-038) |
| T-040 | B | Module `notifications` + `notification:new` + `member:grants-changed`; leave/attendance gọi qua port | T-037 |
| T-041 | E | Web §6 (bắt đầu từ contracts + mock, nối API khi từng vé xong) | T-037 |
| T-042 | F | test-spec-hr, SEC/CC, E2E, Stryker cho `summarizeDay` + đếm ngày nghỉ | song song |

Ước tính: 3–5 ngày làm việc của cả đội, tùy tải máy.
