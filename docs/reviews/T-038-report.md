# T-038 — Chấm công (attendance) — báo cáo Engineer A

Nhánh `feat/T-038-attendance`. Bản này viết lúc chờ T-040 vào main; mục "Lệnh đã chạy" sẽ bổ sung khi báo DONE.

## Đã làm (theo phạm vi ticket)

- Domain thuần: `summarizeDay` (thứ tự trạng thái NOT_EMPLOYED > HOLIDAY > OFF > ON_LEAVE > PRESENT/MISSING_OUT > ABSENT > PENDING, chặn muộn/sớm trong ca, giờ chốt ngày công 06:00), `workDateFor`, `employedOn` (nhiệm kỳ → ngày, theo múi giờ lịch), lịch theo phiên bản + `DEFAULT_SCHEDULE` (không seed).
- Check-in / check-out: giờ server, Idempotency-Key theo user (lặp cùng loại ⇒ 200, khác loại ⇒ 422 `IDEMPOTENCY_KEY_REUSED`), unique IN web/ngày (409), OUT sau 00:00 gắn ngày của IN còn mở, `NOT_CHECKED_IN`, cắt UA ≤ 256.
- Nhân viên: `me/today`, `me?month=`, `me/events` (kèm IP/UA — NĐ 13 Đ.14).
- HR: hôm nay + bảng tháng cả công ty (nhiệm kỳ ∪ người có lượt, gắn `left`, cursor ≤ 50, tổng 0,5 ngày), ADJUSTMENT / void (luật self qua `HrAccess.authorizeWrite`, audit, thông báo), xuất CSV.
- Lịch + ngày lễ: phiên bản từ hôm nay trở đi (`SCHEDULE_IN_PAST`), ngày lễ đã qua chỉ OWNER + lý do (`HOLIDAY_IN_PAST` / `REASON_REQUIRED`), DELETE idempotent, kiểm múi giờ AT-19.
- Adapter cho leave: `AttendanceWorkCalendar` (`IWorkCalendarPort.workingDays`).
- Route (16) gắn middleware theo từng route, OpenAPI A2, composition root (memory + Prisma).

## Quyết định / phát hiện trong lúc làm

- `NOT_EMPLOYED` + bảng `workspace_member_departures` (TL chốt; adapter nhiệm kỳ do B làm ở T-037b).
- AT-19: `Intl.supportedValuesOf('timeZone')` KHÔNG có `Asia/Ho_Chi_Minh` (Node 24 chỉ có `Asia/Saigon`) ⇒ kiểm bằng dạng tên IANA + `Intl.DateTimeFormat` (F sửa spec).
- Lý do của HR/OWNER (ADJUSTMENT, void, ngày lễ đã qua) KHÔNG vào audit ở khóa `reason` (writer của B chặn): lý do nằm ở `note` / `void_reason` của lượt chấm; lý do sửa ngày lễ đã qua ở `after.note` (TL duyệt).
- POST/PUT luôn cần `Content-Type: application/json` kể cả check-in không body (middleware 415 sẵn có — đã báo F, H).

## Review bảo mật (B, @cdd3096 — APPROVE)

| Mục | Mức | Xử lý |
|---|---|---|
| `noApprovedLeaves` / notifier tạm trên đường production | MEDIUM | Notifier: nối `attendanceNotifierFrom` của T-040 TRƯỚC khi xin merge (TL). Leave: TL chấp nhận khoảng giữa T-038 và T-039 — main chưa có module leave nên không thể có đơn đã duyệt; D nối `leave.approvedLeaves` ở T-039. |
| CSV: dấu toàn giác ＝ ＋ － ＠ và `\n` đầu ô | LOW | Đã sửa: `FORMULA_START` thêm U+FF1D/FF0B/FF0D/FF20 và `\n`, có test. |
| Export chỉ kiểm quyền lúc bắt đầu; bị thu grant giữa lúc stream thì file vẫn chạy hết | LOW | Chấp nhận: quyền hợp lệ lúc bắt đầu (đọc lại trong tx, FOR SHARE) + audit EXPORT ghi trước byte đầu. |
| Check-in/out không đọc lại membership trong transaction (chỉ kiểm ở route) — bị xóa đúng lúc đang chấm vẫn ghi được 1 lượt | LOW | Chấp nhận: không phải lệnh HR; lượt đó vẫn hiện cho HR (người đã rời có dữ liệu — R30). |

## Hạn chế v1 (ghi rõ)

- Hạn mức xuất CSV theo user (20/giờ), không theo cặp user + workspace — `RateLimitKey` chưa có khóa ws; chặt hơn yêu cầu.
- Nhiệm kỳ: đổi role sang/từ VIEWER không cắt nhiệm kỳ (B ghi ở T-037b).

## Kiểm thử

- Unit tầng A (attendance) 107, HTTP in-process 9 (`test/http/attendance.http.test.ts`), contracts 133.
- Runner LSP chạy lại tầng A trên Postgres: `check-in-out`, `attendance-events`, `work-calendar`, `hr-attendance.queries`, `attendance-export` (37/37 ở 4 runner đầu, exit 0; runner export chưa chạy trên Postgres).

## Lệnh đã chạy (exit code)

Bổ sung khi báo DONE (sau rebase lên main có T-040, integration 5 runner, verify của TL, security `SEC_RUN_PENDING=T-038` của F).
