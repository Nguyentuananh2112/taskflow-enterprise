# Đặc tả test — Chấm công & Nghỉ phép (Mốc 3, T-042)

> Tác giả: Engineer F (QA) · Trạng thái: **BẢN NHÁP**. Thiết kế còn chờ người dùng duyệt (`docs/design/attendance-leave.md`, nhánh `tl/m3-design` @ 0fda595). Chưa viết test code. Mã ca giữ nguyên khi thiết kế được duyệt; nếu ADR đổi thì sửa ca, không đánh số lại.
> Căn cứ: attendance-leave.md §0–§10 (ADR-119…123 đề xuất, bảng chuyển trạng thái §9, thứ tự lỗi §5, góp ý A/B/D/E), mẫu `test-spec-task.md`, `security.md` (SEC-*), ADR-020 (404 chung), ADR-080 (parity).
> Mỗi ca ghi một **tầng**. Ca có mặt ở nhiều tầng thì ghi tầng thấp nhất bắt được lỗi.

## 0. Quy ước

### 0.1. Tầng test

| Mã | Tầng | Công cụ / phạm vi |
|---|---|---|
| **U** | Unit domain | Vitest, hàm thuần (`summarizeDay`, đếm ngày nghỉ, `effectivePermissions`, máy trạng thái đơn), không I/O |
| **A** | Unit application | Use case với repo in-memory + `FakeUnitOfWork` + `FakeClock` + spy port (`WorkCalendarPort`, `ApprovedLeavePort` fake) |
| **I** | Integration | Postgres thật (`test:integration`), repo Prisma: unique index một phần, advisory lock, `ON CONFLICT`, FK `Restrict` |
| **C** | Concurrency | Như I, N request song song, kết nối riêng; mỗi ca lặp **×20** (như CC-* hiện có) |
| **S** | Bảo mật hộp đen | `test:security` — `main.ts` thật, dữ liệu dựng chỉ qua API công khai (harness `apps/api/test/security`), `secCase` + reporter skip-budget |
| **H** | HTTP in-process | `test/http/*.test.ts` (supertest): envelope, header, CSV, thứ tự middleware |
| **E** | E2E | Playwright, build prod, API thật, chromium + mobile (`@main`) + Firefox trên CI |
| **M** | Mutation | Stryker (command runner), nhóm mới `attendance-domain`, `leave-domain` — ngưỡng **≥ 90 %** cho `summarizeDay` + đếm ngày nghỉ (§4 thiết kế) |

### 0.2. Fixture chuẩn

| Tên | Mô tả |
|---|---|
| `W1` | Workspace chính, lịch `S0` |
| `Olivia` | OWNER của W1 (có `hr:manage` + `hr:grant` theo role, không lưu grant tường minh) |
| `Hana` | MEMBER của W1, grant `HR_MANAGE` |
| `Pam` | PM của W1 (không grant) |
| `Mia`, `Max` | MEMBER của W1 |
| `Vic` | VIEWER của W1 |
| `Rex` | Từng là MEMBER của W1, **đã rời** (membership xóa), còn dữ liệu công + đơn trong W1 |
| `Otto` | OWNER của W2 (workspace khác), có dữ liệu riêng trong W2 |
| `S0` | **Lịch mặc định hằng số của domain attendance** (A sở hữu) — dùng khi workspace CHƯA có dòng `work_schedules` nào (migration 3 không seed, không trigger — TL/B): `Asia/Ho_Chi_Minh`, T2–T7, `start 480` (08:00), `end 1050` (17:30), `break 720–810` (12:00–13:30), `grace 0` ⇒ 480 phút làm/ngày. Dòng chỉ xuất hiện khi HR lưu lịch (`created_by_id` NOT NULL) |
| `clock` | `FakeClock` = `2026-11-17T03:00:00Z` (thứ Ba 10:00 giờ VN); tiến tay khi cần |
| Ngày mẫu | 2026-11-16 thứ Hai · 11-14 thứ Bảy · 11-15 Chủ Nhật · 2026-03-29 / 10-25 Chủ Nhật đổi giờ ở `Europe/Berlin` |

Ký hiệu giờ trong bảng = **giờ địa phương theo múi giờ của lịch**; test dựng `occurredAt` UTC tương ứng (VN = UTC+7).

### 0.2b. Mã lỗi nghiệp vụ (D chốt, TL sửa lại — dùng ĐÚNG chuỗi này trong test)

- **422** ⇒ `BUSINESS_RULE_VIOLATION`, `details.rule` viết HOA: `NOT_CHECKED_IN`, `IDEMPOTENCY_KEY_REUSED`, `HOLIDAY_IN_PAST`, `SCHEDULE_IN_PAST`, `REASON_REQUIRED`, `NO_WORKING_DAYS`, `INSUFFICIENT_BALANCE`, `LEAVE_SPANS_YEARS`, `GRANT_NOT_ALLOWED`.
- **409** ⇒ `RESOURCE_CONFLICT`, `details.reason` viết thường: `already_checked_in`, `already_voided`, `invalid_transition`, `overlapping_leave`, `requester_not_member`.
- `REASON_REQUIRED` (TL chốt): chỉ khi lý do TÙY CHỌN trong schema nhưng bắt buộc theo ngữ cảnh (OWNER tự xử lý ở route có lý do tùy chọn — LV-10 approve/`decisionNote`, LB-05 PATCH balance; ngày lễ quá khứ của OWNER — AT-18). KHÔNG áp cho AT-13: `AdjustAttendanceBody.reason` luôn bắt buộc ⇒ thiếu là 400 (A chỉ ra). Route mà lý do luôn bắt buộc (void, revoke, ADJUSTMENT) ⇒ body thiếu/rỗng là **400** Zod.
- `PATCH leave-balances` được phép cả khi làm `remaining − pending` < 0; đơn PENDING vượt số dư bị **approve** trả 422 `INSUFFICIENT_BALANCE` (TL chốt (a), khớp Q4).
- Xung đột phiên bản giữ `VERSION_CONFLICT` (như task). Test kiểm cả `code` lẫn `details`, không chỉ status.

### 0.3. Thứ tự kiểm tra (thiết kế §5 + §9, dùng cho mọi ca S)

1. Không phải thành viên workspace ⇒ **404** `workspace` (body giống hệt ws không tồn tại — ADR-020).
2. Thành viên gọi route `hr:manage` thiếu quyền ⇒ **403**. `permit` chạy TRƯỚC validate, nên body/query sai cũng ra 403, không phải 400 (B-M4).
3. Validate body/query ⇒ 400.
4. Tài nguyên con (`userId` chưa từng có dữ liệu trong ws, id đơn/lượt chấm của ws khác hoặc không tồn tại, đơn của người khác với nhân viên thường) ⇒ **404**.
5. Luật nghiệp vụ ⇒ 422 / 409 (mã cụ thể theo §9).

---

## 1. `summarizeDay` (tầng U, M ≥ 90 %)

Chữ ký: `summarizeDay({ date, events, schedule, holiday, leave, now, employed })` (`employed` = ngày nằm trong một nhiệm kỳ — `joinedAt` của membership/departures của B T-037b; tên tham số do A chốt) ⇒ `{ status, firstIn, lastOut, workedMin, lateMin, earlyMin, flags: { late, early, absentHalf, inProgress } }`. Mặc định `schedule = S0`, `leave = null`, `holiday = null`, `now` = sau ngày đang xét (ngày đã qua) trừ khi ghi khác.

| ID | Ngày / bối cảnh | Lượt chấm (giờ địa phương) | Kỳ vọng |
|---|---|---|---|
| SD-01 | T2 16/11, đúng giờ | IN 07:55 · OUT 17:35 | `PRESENT`, worked **480**, late 0, early 0 |
| SD-02 | T2, `grace 0` | IN 08:01 · OUT 17:30 | `PRESENT` + `late`, lateMin **1**, worked 479 |
| SD-03 | T2, `grace 5` | IN 08:05 · OUT 17:30 | không cờ `late`, **lateMin 0** (không vượt grace ⇒ 0 — chốt 3a6c7fe), worked 475 |
| SD-04 | T2, `grace 5` | IN 08:06 · OUT 17:30 | `late`, lateMin **6** (đo từ `start`, không trừ grace) |
| SD-05 | IN trong giờ trưa | IN 12:30 · OUT 17:30 | worked **240** (chỉ 13:30–17:30), lateMin 270 |
| SD-06 | OUT trước trưa | IN 08:00 · OUT 11:00 | worked 180, `early`, earlyMin **390** |
| SD-07 | chỉ IN, ngày đã qua | IN 08:00 | `MISSING_OUT`, `lastOut = null`, worked 0 |
| SD-08 | chỉ IN, hôm nay, `now` 15:00 (trước `end`) | IN 08:00 | `PRESENT` + `inProgress = true`, KHÔNG cờ `early`, **worked 0** (chưa OUT ⇒ 0 — chốt 3a6c7fe) (Q1) |
| SD-09 | chỉ IN, hôm nay, `now` 17:31 | IN 08:00 | `MISSING_OUT` |
| SD-10 | OUT 2 lần | IN 08:00 · OUT 12:00 · OUT 17:40 | `lastOut` = 17:40, worked 480, không `early` |
| SD-11 | ra sau 00:00 (A#7) | IN 08:00 (16/11) · OUT 00:30 (17/11) | OUT 00:30 < 06:00 (giờ chốt ngày công) ngày kế tiếp ⇒ gắn **16/11**; 16/11 worked 480; 17/11 không có lượt mồ côi |
| SD-11b | ra sau 00:00, sáng hôm sau lại vào (Q8) | IN 08:00 (16/11) · OUT 00:30 (17/11) · IN 08:00 (17/11) · OUT 17:30 (17/11) | OUT 00:30 gắn 16/11; IN 08:00 mở ngày 17/11 ⇒ cả hai ngày `PRESENT`, mỗi ngày worked 480 |
| SD-12 | OUT mồ côi | IN 08:00 (15/11, không OUT) · OUT 01:00 (17/11) | IN mở là của 15/11, mốc chốt là 16/11 06:00 ⇒ OUT 17/11 01:00 đã quá ⇒ **mồ côi**, thuộc ngày hiện tại 17/11, hiển thị thô; 15/11 `MISSING_OUT`; 17/11 không `PRESENT` từ lượt đó |
| SD-12b | biên giờ chốt: 05:59 | IN 08:00 (16/11) · OUT 05:59 (17/11) | OUT gắn **16/11** (05:59 < 06:00); 16/11 `PRESENT`, worked 480 |
| SD-12c | biên giờ chốt: 06:00 | IN 08:00 (16/11) · OUT 06:00 (17/11) | OUT **không** gắn (06:00 không `<` 06:00) ⇒ mồ côi thuộc 17/11; 16/11 `MISSING_OUT`, worked 0 |
| SD-12d | giờ chốt theo múi giờ của lịch, không theo UTC | lịch `Asia/Ho_Chi_Minh`; IN 08:00 (16/11) · OUT 16/11 23:30Z (= 17/11 **06:30** VN) | OUT **mồ côi**, thuộc 17/11 (đã qua 06:00 giờ VN). Nếu code so theo UTC sẽ gắn nhầm 16/11 (23:30Z < 06:00Z hôm sau) ⇒ ca này phân biệt hai cách (ví dụ cũ 22:59Z không phân biệt — rà độ phủ của F) |
| SD-12e | IN đã đóng rồi lại có OUT sau 00:00 (A) | IN 08:00 · OUT 17:30 (16/11) · OUT 00:30 (17/11) | không còn IN mở ⇒ OUT 00:30 **mồ côi**, thuộc 17/11; 16/11 `lastOut` vẫn 17:30 |
| SD-13 | nghỉ AM + đi làm PM | leave `AM` · IN 13:25 · OUT 17:30 | `PRESENT`, mốc bắt đầu = `breakEnd` 13:30 ⇒ không `late`, worked 240 |
| SD-14 | nghỉ AM + vào muộn, `grace 5` | leave `AM` · IN 13:36 · OUT 17:30 | `late`, lateMin **6** (so với 13:30) |
| SD-15 | nghỉ PM + làm AM | leave `PM` · IN 08:00 · OUT 12:00 | mốc kết thúc = `breakStart` 12:00 ⇒ không `early`, worked 240 |
| SD-16 | nghỉ nửa ngày, vắng nửa kia | leave `AM`, không lượt nào, ngày đã qua | `ABSENT` + `absentHalf` (đếm 0,5 vắng) |
| SD-17 | nghỉ cả ngày | leave `FULL` | `ON_LEAVE`, worked 0 |
| SD-18 | nghỉ cả ngày nhưng vẫn chấm | leave `FULL` · IN 08:00 · OUT 17:30 | `ON_LEAVE` (ưu tiên A#6), giờ thô vẫn trả |
| SD-19 | ngày lễ trùng thứ 7 | `holiday` 14/11 (T7, ngày làm) | `HOLIDAY` |
| SD-20 | ngày lễ + có chấm | `holiday` 14/11 · IN 08:00 · OUT 12:00 | `HOLIDAY` + giờ thô, không tính OT |
| SD-21 | ngày lễ + nghỉ cả ngày | `holiday` + leave `FULL` | `HOLIDAY` (`HOLIDAY` > `ON_LEAVE`) |
| SD-22 | Chủ nhật (OFF) có chấm | 15/11 · IN 09:00 · OUT 11:00 | `OFF` + giờ thô |
| SD-23 | ngày làm đã qua, không gì | — | `ABSENT` |
| SD-24 | tương lai | — (date > hôm nay) | `PENDING` |
| SD-25 | hôm nay, `now` 07:30, chưa IN | — | `PENDING` |
| SD-26 | hôm nay, `now` 17:31, chưa IN | — | `ABSENT` ngay sau `end`, theo `now` truyền vào (Q2) |
| SD-26b | hôm nay, `now` đúng 17:30 (= `end`), chưa IN | — | `PENDING` (biên: chỉ `ABSENT` khi `now > end`) |
| SD-27 | lượt bị hủy bỏ qua | IN 07:50 (`voidedAt`) · IN 08:10 · OUT 17:30 | `firstIn` = 08:10, `late`, lateMin 10 |
| SD-28 | chỉ OUT (không IN) | OUT 17:30 | `ABSENT` + giờ thô, OUT mồ côi (Q3) |
| SD-29 | đổi lịch giữa tháng | S1 hiệu lực 16/11: `start 510` (08:30). IN 08:20 ngày 13/11 và ngày 16/11 | 13/11 (S0): `late` 20 · 16/11 (S1): không `late` |
| SD-30 | DST mùa xuân, `Europe/Berlin`, lịch làm cả CN | 29/03/2026 · IN 07:55 · OUT 17:35 (CEST) | worked **480**, không `late` (sai offset sẽ ra lệch 60) |
| SD-31 | DST mùa thu, `Europe/Berlin` | 25/10/2026 · IN 07:55 · OUT 17:35 (CET) | worked 480, không `early` |
| SD-32 | `workDate` theo múi giờ lịch, không theo UTC | `occurredAt` = 16/11 18:30Z (= 17/11 01:30 VN) | `workDate` = **17/11** (VN), không phải 16/11 |
| SD-33 | `firstIn` sau `lastOut` | OUT 07:00 · IN 08:00 | `lastOut` chỉ tính OUT **sau** `firstIn` ⇒ `MISSING_OUT` |
| SD-34 | ưu tiên OFF > ON_LEAVE | CN + leave FULL | `OFF` (đơn không tính CN là ngày nghỉ — §2) |
| SD-35 | vào sau giờ kết thúc (A, chặn trong ca) | IN 18:00 · OUT 19:00 | `late`, **lateMin 570** (`min(IN, end) − start`), worked 0 |
| SD-36 | IN và OUT đều trước giờ bắt đầu (A) | IN 00:30 · OUT 01:00 | `early`, **earlyMin 570** (`end − max(OUT, start)`), worked 0 — không phải 990 |
| SD-37 | trước khi gia nhập (`NOT_EMPLOYED`, TL) | nhiệm kỳ từ `joinedAt` 18/11; ngày 16/11 (T2), không lượt nào | **`NOT_EMPLOYED`** (ưu tiên cao nhất), tính 0 ở mọi tổng |
| SD-38 | chính ngày gia nhập | `joinedAt` 18/11 10:00; ngày 18/11 đã qua, không lượt nào | tính **bình thường** ⇒ `ABSENT` (không phải `NOT_EMPLOYED`) |
| SD-39 | sau khi rời | nhiệm kỳ 01/11 → `leftAt` 20/11 (`workspace_member_departures`); ngày 23/11, không lượt nào | `NOT_EMPLOYED`; ngày 20/11 (ngày rời) **xem Q9** |
| SD-40 | rời rồi vào lại | nhiệm kỳ 01/11–10/11 và từ 20/11 | 15/11 `NOT_EMPLOYED`; 20/11 tính bình thường; 05/11 tính bình thường |
| SD-41 | có lượt chấm ngoài nhiệm kỳ | trước `joinedAt`: IN 08:00 · OUT 17:30 ngày 16/11 | tính **như thường** ⇒ `PRESENT`, worked 480 (dữ liệu thật thắng nhiệm kỳ) |
| SD-42 | ngoài nhiệm kỳ, chỉ có lượt đã hủy | ngày 16/11 trước `joinedAt`: IN 08:00 (`voidedAt`) | `NOT_EMPLOYED` (lượt đã hủy không tính là "có lượt chấm") |
| SD-43 | ưu tiên cao nhất | ngoài nhiệm kỳ + `holiday` / + `OFF` (CN) / + leave FULL, không lượt nào | `NOT_EMPLOYED` (trên cả `HOLIDAY` > `OFF` > `ON_LEAVE`) |

**Chặn muộn/sớm trong ca** (A, T-038): `lateMin = min(IN, end) − start` khi `late`; `earlyMin = end − max(OUT, start)` khi `early` — mọi dòng SD-01..34 không đổi kết quả.

**Đặc tính chung (U; A kiểm trên 500 ngày ngẫu nhiên có seed — repo không có fast-check):** `0 ≤ workedMin ≤ 480`; `workedMin + lateMin + earlyMin ≤ end − start` (**570**, không phải 480 — `lateMin`/`earlyMin` đo bằng giờ đồng hồ nên có thể chứa giờ nghỉ trưa: SD-05 = 240 + 270 = 510; sửa theo A); `lateMin`, `earlyMin` không vượt độ dài ca nhờ chặn trong ca (SD-35/36); kết quả không phụ thuộc thứ tự mảng `events`.

## 2. Đếm ngày nghỉ (tầng U, M ≥ 90 %)

Domain đếm bằng **số nguyên nửa ngày** (×2), chỉ đổi sang thập phân ở DTO (D-M6). `days` không lưu, tính khi đọc (D-H3a).

| ID | Đơn | Lịch / lễ | Kỳ vọng (nửa ngày) |
|---|---|---|---|
| LD-01 | T2 16/11 FULL | S0 | 2 (= 1,0 ngày) |
| LD-02 | T2 AM | S0 | 1 (= 0,5) |
| LD-03 | 16/11 → 21/11 (T2–T7) | S0 | 12 (6 ngày) |
| LD-04 | 14/11 → 16/11 (T7–T2) | S0 | 4 (CN không tính) |
| LD-05 | như LD-03 | lễ 18/11 | 10 |
| LD-06 | 15/11 (CN) FULL | S0 | 0 ⇒ submit 422 `BUSINESS_RULE_VIOLATION` (`rule: NO_WORKING_DAYS`) |
| LD-07 | `dayPart` AM với start ≠ end | — | 400 (Zod) / `ValidationError` |
| LD-08 | 30/12/2026 → 02/01/2027 | — | 422 `BUSINESS_RULE_VIOLATION` (`rule: LEAVE_SPANS_YEARS`, v1) |
| LD-09 | đơn APPROVED 18/11; HR thêm lễ 18/11 sau đó | — | đọc lại ⇒ số ngày giảm 2 (tính khi đọc — D-L4) |
| LD-10 | đổi lịch giữa khoảng đơn | S1 từ 18/11 bỏ thứ 7 | ngày trước 18/11 theo S0, từ 18/11 theo S1 |

## 3. Máy trạng thái đơn nghỉ (tầng A, theo bảng §9)

| ID | Từ → Đến | Actor | Bối cảnh | Kỳ vọng |
|---|---|---|---|---|
| LV-01 | (mới) → PENDING | Mia | ANNUAL 2 ngày, đủ số dư | 201, PENDING, thông báo LEAVE_SUBMITTED tới HR (Olivia, Hana), audit LEAVE_SUBMIT (không chứa `reason`) |
| LV-02 | (mới) | Mia | chồng ngày với đơn PENDING/APPROVED của Mia | 409 `RESOURCE_CONFLICT` (`reason: overlapping_leave`) |
| LV-03 | (mới) | Mia | AM 16/11 khi đã có PM 16/11 | 201 (AM + PM hợp lệ — D-M2) |
| LV-04 | (mới) | Mia | AM 16/11 khi đã có FULL 16/11 | 409 `RESOURCE_CONFLICT` (`reason: overlapping_leave`) |
| LV-05 | (mới) | Mia | chồng với đơn CANCELLED/REJECTED/REVOKED | 201 (đơn chết không chặn) |
| LV-06 | (mới) | Mia | ANNUAL vượt `còn − đang chờ` | 422 `BUSINESS_RULE_VIOLATION` (`rule: INSUFFICIENT_BALANCE`) |
| LV-07 | (mới) | Vic | bất kỳ | 403 (`leave:self` không có ở VIEWER) |
| LV-08 | PENDING → APPROVED | Hana | đơn của Mia, đủ số dư | 200, `version+1`, `decidedBy = Hana`, thông báo LEAVE_APPROVED tới Mia, audit LEAVE_DECIDE |
| LV-09 | PENDING → APPROVED | Hana | đơn của **chính Hana** | **403** (B-H1, không tự xử lý) |
| LV-10 | PENDING → APPROVED | Olivia | đơn của chính Olivia | 200 + bắt buộc lý do + HrAuditLog (R26) |
| LV-11 | PENDING → APPROVED | Hana | `expectedVersion` cũ | 409 `version_conflict` |
| LV-12 | PENDING → APPROVED | Hana | số dư đã giảm sau khi gửi (đơn khác được duyệt) | 422 `BUSINESS_RULE_VIOLATION` (`rule: INSUFFICIENT_BALANCE`) (kiểm LẠI trong khóa — D-H2) |
| LV-13 | PENDING → APPROVED | Hana | Mia đã rời ws | 409 `RESOURCE_CONFLICT` (`reason: requester_not_member`); REJECT vẫn được (D-M4) |
| LV-14 | PENDING → REJECTED | Hana | có `decisionNote` | 200, trả giữ chỗ số dư, thông báo LEAVE_REJECTED |
| LV-15 | PENDING → CANCELLED | Mia | đơn của mình | 200, thông báo LEAVE_CANCELLED tới HR |
| LV-16 | PENDING → CANCELLED | Max | đơn của Mia | **404** (không lộ id đơn — §5) |
| LV-17 | APPROVED → CANCELLED | Mia | `startDate` > hôm nay | 200, trả số dư |
| LV-18 | APPROVED → CANCELLED | Mia | `startDate` ≤ hôm nay (hôm nay theo múi giờ lịch — D-M5) | 409 `RESOURCE_CONFLICT` (`reason: invalid_transition`) |
| LV-19 | APPROVED → REVOKED | Hana | `startDate` > hôm nay, có lý do | 200, thông báo LEAVE_REVOKED tới Mia, audit LEAVE_REVOKE |
| LV-20 | APPROVED → REVOKED | Hana | thiếu lý do / rỗng | **400** (Zod — lý do luôn bắt buộc ở route revoke; TL chốt) |
| LV-21 | APPROVED → REVOKED | Hana | đã bắt đầu | 409 `RESOURCE_CONFLICT` (`reason: invalid_transition`) |
| LV-22 | REJECTED/CANCELLED/REVOKED → bất kỳ | ai cũng vậy | — | 409 `RESOURCE_CONFLICT` (`reason: invalid_transition`) (ma trận đủ 5×5 trạng thái, giống TE-M01..16) |
| LV-23 | APPROVED → APPROVED | Hana | duyệt lại | 409 `RESOURCE_CONFLICT` (`reason: invalid_transition`) |
| LV-24 | — | — | bảng chuyển của domain | **parity** với hằng trong `packages/contracts` (ADR-080) |
| LV-25 | stale-actor (B-H3) | Hana | Hana bị thu grant sau khi mở form, trước khi bấm duyệt | 403 (đọc lại membership + grants SAU khóa) |

## 4. Số dư phép (tầng A + I)

| ID | Ca | Kỳ vọng |
|---|---|---|
| LB-01 | đọc số dư năm chưa có bản ghi | tạo lười `entitled 12, adjustment 0` (`INSERT … ON CONFLICT DO NOTHING`), trả `remaining 12` |
| LB-02 | `remaining = entitled + adjustment − used(APPROVED ANNUAL) − pending_khác` | công thức loại **chính đơn đang xét** khỏi `pending_khác` (D, b24cde2) |
| LB-03 | đơn SICK / UNPAID / OTHER / PERSONAL_PAID | không trừ phép năm |
| LB-04 | `PATCH leave-balances/Mia/2026` bởi Hana | 200, audit BALANCE_ADJUST |
| LB-05 | `PATCH …/Hana/2026` bởi Hana | **403** (tự chỉnh — B-H1) |
| LB-06 | `PATCH …/<userId chưa từng có dữ liệu>/2026` | 404 |
| LB-07 | `year` ngoài ±1 năm | 400/422 |
| LB-08 | `adjustment` làm `remaining` âm khi có đơn APPROVED | cho phép, hiển thị `remaining` âm; đơn ANNUAL mới ⇒ 422 `BUSINESS_RULE_VIOLATION` (`rule: INSUFFICIENT_BALANCE`) (Q4) |
| LB-09 | biểu diễn: 0,5 ngày ↔ 1 nửa ngày, `Decimal(4,1)` ở DB | không lệch làm tròn (đọc lại đúng 10,5) |

## 5. Chấm công: lệnh và luật (tầng A + I)

| ID | Ca | Kỳ vọng |
|---|---|---|
| AT-01 | Mia check-in lần đầu trong ngày | **201**, body = thẻ hôm nay (`AttendanceTodayDto`); `source WEB`, `occurredAt` = giờ server (client không gửi giờ), lưu IP + UA (≤ 256) |
| AT-02 | check-in lần 2 cùng ngày, key khác | 409 `RESOURCE_CONFLICT` (`reason: already_checked_in`) |
| AT-03 | lặp check-in, cùng `Idempotency-Key` | **200** (lượt mới là 201), body = thẻ hôm nay, **không thêm dòng**, `firstIn` không đổi (body không có id lượt chấm — chốt A/E) |
| AT-04 | cùng key nhưng `kind` khác (IN rồi OUT) | 422 `BUSINESS_RULE_VIOLATION` (`rule: IDEMPOTENCY_KEY_REUSED`) |
| AT-05 | key của Mia dùng lại bởi Max | không va (key gắn theo user — A#1); Max được 201 |
| AT-06 | replay key sau khi Mia bị xóa khỏi ws | 404 (vẫn kiểm membership TRƯỚC replay — B-M6) |
| AT-07 | check-out chưa IN | 422 `BUSINESS_RULE_VIOLATION` (`rule: NOT_CHECKED_IN`) (Q5) |
| AT-08 | check-out 2 lần | 201 cả hai (key khác nhau), `lastOut` = lượt sau |
| AT-09 | `Idempotency-Key` không phải UUID | 400 |
| AT-10 | Vic check-in | 403 |
| AT-11 | hạn mức 10/phút/user | lần 11 ⇒ 429 (hết hạn mức, có `Retry-After`) |
| AT-12 | Hana `POST attendance/events` (ADJUSTMENT) cho Mia — body `AdjustAttendanceBody` strict `{ userId, kind, date, time "HH:mm", nextDay?, reason }` (giờ theo LỊCH của `date`, không `occurredAt` ⇒ gửi kèm 400) | 201 + `AttendanceEventChangeDto { event, day }` (id ở `event.id`), `source ADJUSTMENT`, `createdBy Hana`, thông báo ATTENDANCE_ADJUSTED tới Mia, audit EVENT_ADJUST |
| AT-13 | Hana ADJUSTMENT cho chính mình | 403 (B-H1); Olivia cho chính mình ⇒ 201 + HrAuditLog (lý do luôn có vì `reason` bắt buộc trong body — thiếu là **400** Zod, không phải 422) |
| AT-13b | `GET attendance/events?userId=Mia&date=` (Hana) | 200, `{ events: AttendanceEventDto[] }` theo `workDate`, gồm lượt đã hủy, sắp theo `occurredAt`, có IP/UA; `me/events` cùng DTO nhưng chỉ của mình (f8ddb7b) |
| AT-14 | void lượt chấm (`VoidAttendanceBody { reason }` ⇒ 200 `{ event, day }`), thiếu lý do / rỗng | **400** (Zod — lý do luôn bắt buộc ở route void; TL chốt); có lý do ⇒ 200, `voidedAt/By/Reason`, dòng không bị xóa (log bất biến) |
| AT-14b | void lại lượt đã void | 409 `RESOURCE_CONFLICT` (`reason: already_voided`) |
| AT-15 | void lượt của ws khác | 404 |
| AT-16 | sau void IN WEB, check-in lại cùng ngày | 201 (unique index một phần loại `voidedAt IS NOT NULL`) |
| AT-17 | lịch mới `effectiveFrom` < hôm nay | 422 `BUSINESS_RULE_VIOLATION` (`rule: SCHEDULE_IN_PAST`); = hôm nay ⇒ 201 |
| AT-17b | workspace mới, chưa ai lưu lịch | (I) 0 dòng `work_schedules`; `me/today` và tính công dùng `S0` (hằng số domain); DB không tự sinh dòng khi đọc |
| AT-17c | HR lưu lịch đầu tiên (`effectiveFrom` = hôm nay) | 201, đúng 1 dòng, `created_by_id` = HR; ngày trước đó vẫn tính theo `S0` (SD-29) |
| AT-18 | ngày lễ ngày quá khứ, Hana | 422 `BUSINESS_RULE_VIOLATION` (`rule: HOLIDAY_IN_PAST`); Olivia thiếu lý do ⇒ 422 `BUSINESS_RULE_VIOLATION` (`rule: REASON_REQUIRED`); Olivia + lý do ⇒ 200 + HrAuditLog (A#4) |
| AT-19 | `timezone` không hợp lệ (`Mars/Base`) | 400 (`Intl.supportedValuesOf('timeZone')`) |
| AT-20 | HR xem công của Rex (đã rời) | 200, gắn "đã rời" (R30); `userId` chưa từng có dữ liệu ⇒ 404 |
| AT-21 | `GET attendance/me/today` | đủ trường §5 — `AttendanceTodayDto` (`@taskflow/contracts/attendance`, chốt A/E cho T-041a): `serverNow, timezone, date, isWorkday, isHoliday, holidayName, schedule, status, late, early, absentHalf, inProgress, firstIn, lastOut, leave` — contract test với Zod |
| AT-22 | tổng tháng (me / HR month) có ngày `NOT_EMPLOYED` | ngày `NOT_EMPLOYED` tính **0** ở mọi tổng: không vào ngày công, ngày vắng (`ABSENT`), ngày muộn/sớm, giờ làm; người vào giữa tháng không bị đếm vắng các ngày trước `joinedAt` |
| AT-23 | CSV xuất tháng có người vào giữa tháng / đã rời | ô trạng thái ngày ngoài nhiệm kỳ = `NOT_EMPLOYED`, cột số = 0; tổng cuối dòng khớp AT-22; ngày gia nhập hiện bình thường |

## 6. Grants (`hr:manage`, ADR-119)

| ID | Tầng | Ca | Kỳ vọng |
|---|---|---|---|
| GR-01 | U | `effectivePermissions(role, grants)` = `ROLE_PERMISSIONS[role] ∪ GRANT_PERMISSIONS[grants]` | đúng cho 4 role × {[], [HR_MANAGE]} |
| GR-02 | U | `GRANT_PERMISSIONS[HR_MANAGE]` | **KHÔNG** chứa `hr:grant`, `member:*`, `workspace:*`, `project:*` (B-M1) |
| GR-03 | U | parity bản domain ↔ bản Zod trong contracts | bằng nhau (ADR-080) |
| GR-04 | A | Olivia cấp HR cho Mia | 200, audit GRANT, event `member:grants-changed { workspaceId, grants }` tới `user:Mia`, thông báo HR_GRANTED |
| GR-05 | A | Hana (có HR) cấp HR cho Max | 403 (`hr:grant` chỉ OWNER) |
| GR-06 | A | Pam cấp HR | 403 |
| GR-07 | A | cấp cho Vic | 422 `BUSINESS_RULE_VIOLATION` (`rule: GRANT_NOT_ALLOWED`) |
| GR-08 | A | cấp cho OWNER | 422 `BUSINESS_RULE_VIOLATION` (`rule: GRANT_NOT_ALLOWED`) (OWNER không lưu grant — B-M2) |
| GR-09 | A | hạ Hana xuống VIEWER | grants bị xóa trong cùng transaction; response + audit cho thấy grants còn lại = [] |
| GR-10 | A | hạ Hana từ MEMBER xuống… (đổi role khác VIEWER) | grants giữ nguyên, response + audit hiện grants |
| GR-11 | I | `loadMembership` đọc `grants` | không thêm query (đếm query hoặc spy), không cache |

---

## 7. Bảo mật hộp đen — `SEC-HR-*` (tầng S, `test:security`)

Đặt trong file mới `apps/api/test/security/hr.sec.ts`. Ca chưa có route thì khai báo trong `harness/pending.ts` (`DECLARED_PENDING` kèm ticket T-037…T-040), không `it.skip` trần. Reporter skip-budget làm run đỏ nếu thiếu khai báo.

| ID | Ca | Kỳ vọng |
|---|---|---|
| SEC-HR-01 | Otto (W2) gọi mọi route `attendance/*`, `leave-*` của W1 | 404, body giống hệt ws không tồn tại |
| SEC-HR-02 | Mia gọi route `hr:manage` (`GET attendance?month=`, `export.csv`, `approve`, `PATCH leave-balances`…) | 403; body sai cũng 403, không 400 (B-M4) |
| SEC-HR-03 | Mia gửi `?userId=Max` tới route `me` (`attendance/me`, `leave-requests?mine=1`, `leave-balances/me`) | tham số bị bỏ qua hoặc 400 strict, luôn chỉ trả dữ liệu của Mia (route nhân viên không nhận `userId` — Q6) |
| SEC-HR-04 | IDOR: Hana W1 approve/void id đơn/lượt chấm của W2 | 404 |
| SEC-HR-05 | Max hủy đơn của Mia | 404 (không lộ id tồn tại) |
| SEC-HR-06 | Vic check-in / gửi đơn | 403 |
| SEC-HR-07 | Hana tự duyệt đơn / tự adjust / tự PATCH balance | 403 cả ba (B-H1) |
| SEC-HR-08 | Pam `PUT members/:id/grants` | 403 |
| SEC-HR-09 | Olivia thu grant của Hana; Hana dùng CÙNG access token gọi `approve` ngay sau | 403 ngay request kế tiếp (không đợi token hết hạn — B-H3) |
| SEC-HR-10 | Hana bị thu grant giữa lúc mở và bấm duyệt (race thực, ×20) | không lần nào duyệt thành công sau khi grant đã thu |
| SEC-HR-11 | CSV injection: họ tên / tên ws / ghi chú chấm công bắt đầu bằng `=`, `+`, `-`, `@`, `\t`, `\r` | ô CHỮ có tiền tố `'`, mọi ô bọc `"`, `"` nhân đôi; ô số/ngày do server sinh giữ nguyên (B-L3) |
| SEC-HR-12 | CSV: header | `Content-Disposition` dựng từ `month` đã validate (`month=../../x` ⇒ 400), `Cache-Control: no-store`, UTF-8 BOM, KHÔNG có cột IP/UA, KHÔNG có `reason` đơn nghỉ |
| SEC-HR-13 | CSV: hạn mức theo user + ws | quá ⇒ 429; mỗi lần xuất ⇒ audit EXPORT (tháng + số dòng) |
| SEC-HR-14 | IP/UA: Mia xem lượt chấm của mình | `me/events` có IP/UA (NĐ 13 Đ.14); HR thấy cùng lượt qua `attendance/events?userId=&date=`; Max không xem được của Mia |
| SEC-HR-15 | `reason` đơn nghỉ | chỉ người gửi + `hr:manage` đọc; không xuất hiện trong thông báo, `HrAuditLog.before/after`, log process (quét log API như SEC-33) |
| SEC-HR-16 | `HrAuditLog` | chỉ OWNER đọc; Hana ⇒ 403 (B-L1) |
| SEC-HR-17 | notifications: `POST /me/notifications/:id/read` với id của người khác | 404 (`recipientId = me` trong WHERE — B-M3) |
| SEC-HR-18 | notifications sau khi bị xóa khỏi ws | danh sách không còn thông báo của ws đó |
| SEC-HR-19 | thông báo "dành cho HR" sau khi bị thu grant | không còn trong danh sách (lọc theo quyền hiện tại — B-H3) |
| SEC-HR-20 | payload `notification:new` / `member:grants-changed` | chỉ id + loại / grants, không `reason`/ghi chú; chỉ tới `user:{id}` (socket của người khác không nhận — dùng helper socket của A) |
| SEC-HR-21 | CORS preflight có `Idempotency-Key` từ origin hợp lệ | `Access-Control-Allow-Headers` chứa `Idempotency-Key` (E); origin lạ ⇒ không |
| SEC-HR-22 | client gửi `occurredAt` / `source` / `workDate` trong body check-in | 400 (strict) hoặc bị bỏ qua — giờ luôn là giờ server |
| SEC-HR-23 | `X-Forwarded-For` giả khi `TRUST_PROXY_HOPS=0` | IP lưu = IP socket, không phải giá trị giả |
| SEC-HR-24 | `userAgent` 10 KB | bị cắt ≤ 256, không 500 |
| SEC-HR-25 | `PATCH leave-balances/:userId/:year` với `userId` của W2 | 404 |
| SEC-HR-26 | idempotency replay của user khác (key giống hệt) | người thứ hai nhận **201** (lượt mới của chính họ), không phải 200 replay; `firstIn` của mỗi người độc lập (AT-05) |
| SEC-HR-28 | Max gọi `attendance/me/events?date=&userId=Mia` | chỉ trả lượt của Max (tham số bị bỏ qua hoặc 400) — route mới f8ddb7b |
| SEC-HR-29 | Mia (thành viên thường) gọi `attendance/events?userId=Max&date=` (lượt thô có IP/UA) | 403; HR với `userId` chưa từng có dữ liệu ⇒ 404 |
| SEC-HR-27 | route grants: cấp/thu `HR_MANAGE` cho OWNER | 422 `BUSINESS_RULE_VIOLATION` (`rule: GRANT_NOT_ALLOWED`) (OWNER không có grant tường minh) |

## 8. Đồng thời — `CC-HR-*` (tầng C, ×20 mỗi ca)

| ID | Ca | Kỳ vọng |
|---|---|---|
| CC-HR-01 | 2 check-in song song của Mia (key khác) | đúng 1 × 201, 1 × 409 `RESOURCE_CONFLICT` (`reason: already_checked_in`); DB đúng 1 IN WEB chưa hủy (unique index một phần) |
| CC-HR-02 | 2 check-in song song, CÙNG `Idempotency-Key` | một 201 + một 200 (replay), cùng `firstIn`; DB 1 dòng |
| CC-HR-03 | approve ‖ cancel cùng đơn | đúng 1 thắng; bên thua 409; trạng thái cuối nhất quán với bên thắng; số dư đúng |
| CC-HR-04 | 2 đơn ANNUAL song song, tổng vượt số dư | 1 × 201, 1 × 422 `BUSINESS_RULE_VIOLATION` (`rule: INSUFFICIENT_BALANCE`) (khóa advisory) |
| CC-HR-05 | 2 đơn chồng ngày song song | 1 × 201, 1 × 409 `RESOURCE_CONFLICT` (`reason: overlapping_leave`) |
| CC-HR-06 | 2 đơn AM ‖ PM cùng ngày | cả hai 201 (D-L3) |
| CC-HR-07 | submit ANNUAL ‖ `PATCH balance` giảm | tuần tự hóa dưới cùng khóa, chứng minh bằng thứ tự audit: [`BALANCE_ADJUST`] trước ⇒ submit 422 `INSUFFICIENT_BALANCE` + 0 dòng; [`LEAVE_SUBMIT`, `BALANCE_ADJUST`] ⇒ submit 201 và PATCH **vẫn 200** dù `remaining − pending` < 0 (TL chốt (a)); số dư cuối khớp thứ tự |
| CC-HR-08 | approve ‖ HR giảm số dư | thứ tự audit [`LEAVE_DECIDE`, `BALANCE_ADJUST`] ⇒ APPROVED (PATCH 200, số dư có thể âm — Q4); [`BALANCE_ADJUST`] trước ⇒ approve **bắt buộc** 422 `INSUFFICIENT_BALANCE`, đơn vẫn PENDING; số dư cuối khớp thứ tự |
| CC-HR-09 | 2 HR approve ‖ reject cùng đơn | 1 thắng, 1 409 |
| CC-HR-10 | revoke ‖ người gửi cancel (APPROVED, chưa bắt đầu) | 1 thắng; số dư trả đúng 1 lần |
| CC-HR-11 | thu grant ‖ HR approve (= SEC-HR-10 ở tầng C) | không approve nào commit sau commit thu grant |
| CC-HR-12 | tạo lười `LeaveBalance` song song (2 request đọc lần đầu) | đúng 1 dòng, không 500 (`ON CONFLICT DO NOTHING`) |
| CC-HR-13 | thêm ngày lễ ‖ approve đơn chứa ngày đó | số ngày đọc lại nhất quán với lịch sau cùng (tính khi đọc) |
| CC-HR-14 | đổi role Hana → VIEWER ‖ cấp grant cho Hana | không bao giờ VIEWER còn grant |
| CC-HR-15 | xóa thành viên bị rollback không để lại departure (B, T-037b) | (I) lỗi sau khi ghi `workspace_member_departures` nhưng trước commit (fake lỗi trong transaction) ⇒ 0 dòng departure, membership còn; lệnh xóa bị từ chối (LAST_OWNER 422) ⇒ 0 departure; (C) 2 lệnh xóa cùng thành viên song song ×20 ⇒ đúng 1 × 200 và đúng 1 dòng departure |

## 9. E2E — `E2E-HR-*` (tầng E)

| ID | Luồng | Kỳ vọng |
|---|---|---|
| E2E-HR-01 `@main` | Mia mở `/w/:ws/projects` ⇒ thẻ Chấm công ⇒ Vào ⇒ Ra | giờ hiển thị theo `serverNow` + múi giờ lịch (không theo máy — đổi `timezoneId` của context vẫn đúng); trạng thái đổi |
| E2E-HR-02 `@main` | Mia gửi đơn ⇒ Hana (context khác) thấy chuông +1 realtime < 2 s ⇒ duyệt ⇒ Mia thấy chuông + lịch tháng hiện "Nghỉ phép" | không reload; offline rồi online vẫn đúng (bảng bền — ADR-123) |
| E2E-HR-03 | Olivia bật "Quản lý nhân sự" cho Mia | tab của Mia hiện mục HR ngay (`member:grants-changed`), không reload |
| E2E-HR-04 | Vic | không thấy UI chấm công/nghỉ; gọi API ⇒ 403 |
| E2E-HR-05 | banner nhắc chưa chấm vào | hiện trong ngày làm việc; KHÔNG tự chấm khi đăng nhập |
| E2E-HR-06 | HR xuất CSV | tải qua `fetch` + Blob (Bearer), tên file theo tháng, mở được, có BOM |
| E2E-HR-07 | a11y | lịch tháng là `<table>` có tiêu đề hàng/cột, trạng thái có chữ + biểu tượng (axe serious/critical = 0, sáng + tối) |
| E2E-HR-08 | XSS (mở rộng SEC-49) | `reason`, `decisionNote`, ghi chú ADJUSTMENT, tên ngày lễ chứa payload ⇒ hiển thị text ở danh sách đơn, chuông, lịch, `/hr` |
| E2E-HR-09 | responsive 360 → 1440, Firefox | luồng `@main` xanh |

## 10. Mutation

Nhóm Stryker mới (thêm script `mutation:<nhóm>`, workflow hằng tuần tự nhận):

- `attendance-domain`: `summarizeDay`, quy đổi `workDate`, quy tắc ra sau 00:00 — ngưỡng ≥ 90 %.
- `leave-domain`: đếm ngày nghỉ, máy trạng thái, số dư (nửa ngày nguyên) — ngưỡng ≥ 90 %.
- `attendance-application`, `leave-application`, `notifications-application`: theo dõi, chưa đặt ngưỡng chặn.

Repo Prisma vẫn loại khỏi mutation (chỉ integration phủ — F3).

## 11. Câu hỏi mở — ĐÃ CHỐT (TL, 2026-10-16)

| # | Câu hỏi | Chốt (TL) |
|---|---|---|
| Q1 | Hôm nay đã IN, chưa tới `end`, chưa OUT ⇒ trạng thái gì? (danh sách §4 không có "đang làm") | **ĐÃ CHỐT (TL):** `PRESENT` + cờ `inProgress = true` khi `now < end` và chưa OUT (web hiện "đang làm"); KHÔNG cờ `early`; thành `MISSING_OUT` khi `now > end` (SD-08, SD-09) |
| Q2 | Ngày làm hôm nay, đã qua `end`, chưa IN ⇒ `ABSENT` ngay hay chờ hết ngày? | **ĐÃ CHỐT (TL):** `ABSENT` ngay sau `end`, tính theo `now` truyền vào nên test tất định (SD-26, SD-26b) |
| Q3 | Chỉ có OUT, không có IN | **ĐÃ CHỐT (TL):** `ABSENT` + giờ thô (OUT mồ côi) (SD-28) |
| Q4 | HR giảm `adjustment` làm `remaining` âm khi đã có đơn APPROVED | **ĐÃ CHỐT (TL):** cho phép (dữ liệu thật), hiển thị âm, chặn đơn ANNUAL mới (LB-08) |
| Q5 | Mã lỗi check-out khi chưa IN | **ĐÃ CHỐT (TL):** 422 `BUSINESS_RULE_VIOLATION` (`rule: NOT_CHECKED_IN`) (AT-07) |
| Q6 | Route nhân viên có nhận `userId` không, hay luôn là `me`? | **ĐÃ CHỐT (TL):** chỉ `me`, không tham số `userId` — giảm bề mặt IDOR (SEC-HR-03) |
| Q7 | `grace` áp cho về sớm không? | **ĐÃ CHỐT (TL):** không, `grace` chỉ áp cho muộn (SD-06) |
| Q8 | Ra sau 00:00 khi ngày hôm sau là ngày làm và người đó lại IN lúc 08:00 | **ĐÃ CHỐT (TL):** OUT 00:30 gắn ngày trước; IN 08:00 mở ngày mới (SD-11b). Cập nhật 3a6c7fe: thay "16 h" bằng giờ chốt ngày công **06:00** (giờ của lịch) — biên SD-12b/12c/12d |
| Q9 | Ngày của `leftAt` (chính ngày rời, không có lượt chấm) | **CHỜ TL**: đề xuất của F — tính bình thường (đối xứng với ngày gia nhập); `NOT_EMPLOYED` từ ngày kế tiếp (SD-39) |
