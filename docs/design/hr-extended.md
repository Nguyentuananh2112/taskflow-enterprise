# Mốc 5 — HR mở rộng (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất v3 — theo Mốc 3.5 "Cấp công ty"** (Tech Lead, 2026-10-17; D soạn theo `company-level.md` v2.1 §8). ADR-128…131 chỉ ghi vào `DECISIONS.md` sau khi người dùng duyệt; rủi ro R32–R35 vào `threat-model.md` §6 (B). Vé T-054…T-059. Chưa ai code trước khi duyệt. **Làm SAU Mốc 3.5** (`feat/company-level` vào `main`).
> Căn cứ: `company-level.md` v2.1 (ADR-133…140 — một công ty, `company_members`, nhiệm kỳ bằng ngày, `ICompanyAccess`, `ICompanyTenurePort`, bảng thứ tự khóa toàn cục ADR-136, vào làm/nghỉ việc/kích hoạt ADR-137), `attendance-leave.md` (luật Mốc 3 giữ nguyên, phạm vi công ty), `data-retention.md` (R27), `payroll.md` (v3.2 theo `company-level.md` §8), `schema.prisma`. Dữ liệu ví dụ trong tài liệu là bịa.

**Tổng quan Mốc 5 (4 phần):** (1) hồ sơ nhân viên — ADR-128; (2) đơn bổ sung giờ — ADR-129; (3) xuất Excel — ADR-130; (4) chính sách phép — ADR-131. Mọi thứ nằm trong trang **Nhân sự** (`/hr`) cấp công ty, quyền `hr:manage` (HR + Admin ngầm có); nhân viên (`role = EMPLOYEE`) chỉ thấy dữ liệu của mình. **Admin không phải nhân viên** (company-level ADR-134): không hồ sơ "của tôi", không phép, không đơn bổ sung.

**v3 — đổi phạm vi sang công ty** (v2.1 @ e4f46d8, nhánh `tl/m5-hr-design`)
- **ADR-132 cũ (vào làm / nghỉ việc / kích hoạt / nhận lại) chuyển sang Mốc 3.5** (`company-level.md` ADR-137, vé T-062) — Mốc 5 chỉ còn tham chiếu (§2 cuối). **T-060 xóa.** Bỏ hẳn `PATCH hr/employees/:userId {role}` (MEMBER↔PM): HR không đổi vai trò dự án — vai trò dự án thuộc workspace (OWNER/PM).
- Bỏ `workspaceId` khỏi mọi bảng / route / khóa / cache key của Mốc 5: `EmployeeProfile` PK `user_id`; đơn bổ sung `(user, work_date, kind)`; `LeavePolicy` PK `year`; khóa `taskflow:leave-policy` (bậc 1 của bảng khóa ADR-136); route `/api/v1/hr/…`, `/api/v1/attendance/…`, `/api/v1/leave/…`; web `/hr`, `/my-profile`, cache `['company', …]`.
- "OWNER" ⇒ "Admin" ở mọi chỗ; **luật self tuyệt đối** với HR/Kế toán (không còn ngoại lệ "OWNER tự xử lý có lý do" — Admin không có dữ liệu nhân viên của chính mình).
- "Người gửi còn là nhân viên" = `ICompanyAccess.assertActiveEmployee` / `isEmployee` (company-level ADR-135) thay `OWNER/PM/MEMBER` của workspace.
- Phép năm theo **nhiệm kỳ** (D H3 của Mốc 3.5, TL chốt): `carried` chỉ khi làm liên tục qua 31/12 → 01/01; năm đầu **đủ base**; nhận lại cùng năm **không cấp lại** (ADR-131).
- Migration đánh lại theo `company-level.md` §8: **5** `company_level` (T-061) · **6** hồ sơ (T-054) · **7** payroll + `payroll_settings` (T-048) · **8** đơn bổ sung (T-055) · **9** chính sách phép (T-057).
- Mã test không trùng dải Mốc 3.5 (SEC-HR-30…39, 56…70 · CC-HR-16…19 · CLK-HR-05…09 · E2E-HR-14…19 · CO-*): Mốc 5 giữ **SEC-HR-40…55** (bỏ SEC-HR-44), **CC-HR-20…25**, **CLK-HR-10…14**, **E2E-HR-20…25**; bỏ EL-*, SEC-HR-56…65, CC-HR-26…27, CLK-HR-15…16, E2E-HR-26…27 (đã sang Mốc 3.5).

**v2.1 — người dùng 17/10** (v2 @ caac31e): đủ phép năm đầu (bỏ tỷ lệ); thâm niên tính tới 31/12/Y; cửa sổ đơn bổ sung = tháng này + tháng trước.

**v2 — phản biện B/D/F** (v1 @ 6355d53): D — chụp `carried` ở đường ghi + job 01/01, `remainingAtYearEnd` chỉ APPROVED, khóa chính sách shared/exclusive, migration chỉ NULL cho năm ≥ năm hiện tại, `negativeBalances` khi đổi `hireDate`, báo cáo trong một transaction REPEATABLE READ READ ONLY, số truy vấn/lô + index, công thức nửa ngày nguyên, hạn cộng dồn bằng hàm ngày thuần, Stryker + property test. B — đổi nghĩa cột cùng PR code đọc cột, FK `created_event_id` NO ACTION, thông báo đơn bổ sung vào `HR_AUDIENCE_TYPES`, thứ tự route, tự ghi .xlsx trên `fflate`, lý do ở `after.note`, escape LIKE, body strict, 429. F — `quotePrefix`, 422 trước header + `socket.destroy()`, hạn mức chung CSV, audit khi stream bắt đầu, khóa chung `attendance:punch:<user>`, `Idempotency-Key`, `REQUESTER_NOT_EMPLOYEE`, harness `nextVnDateAnchor`.

## 0. Quyết định

| Điểm | Ai chốt | Chốt |
|---|---|---|
| 4 tính năng: hồ sơ nhân viên, đơn bổ sung giờ, xuất Excel, chính sách phép | Người dùng 17/10 | Chỉ HR/Admin (`hr:manage`); nhân viên chỉ thấy dữ liệu của mình |
| Phạm vi | Người dùng 17/10 (Mốc 3.5) | **Cấp công ty**, không theo workspace; Admin không phải nhân viên |
| Hồ sơ: ngày vào công ty, phòng ban, chức vụ, SĐT công việc | Người dùng 17/10 | HR thêm/sửa; nhân viên xem hồ sơ của mình (chỉ đọc) |
| Đơn bổ sung giờ: ngày, IN/OUT, giờ, lý do; HR duyệt/từ chối | Người dùng 17/10 | Duyệt ⇒ tạo lượt ADJUSTMENT như HR sửa tay |
| Xuất Excel: bảng công tháng cả công ty + báo cáo nghỉ phép | Người dùng 17/10 | Server tính, web chỉ tải |
| Chính sách phép: mặc định 12, +1 ngày/5 năm, cộng dồn có hạn | Người dùng 17/10 | Cấu hình **cho công ty**, theo năm |
| `hireDate` một nguồn = `EmployeeProfile` (lương + phép) | TL (A S4) | **EmployeeProfile ship TRƯỚC payroll**; nhiệm kỳ chấm công/lương là `company_members.start_date` + departures (khác `hireDate`) |
| Hồ sơ **không** phiên bản | TL | `hireDate` là sự kiện; phiếu lương đã chụp `hireDate` — ADR-128 |
| Không CCCD, địa chỉ nhà, ngày sinh, SĐT cá nhân | TL | Tối thiểu hóa dữ liệu — ADR-128 |
| Đơn bổ sung chỉ cho ngày **thiếu** lượt (không "thay thế") | TL | Giờ sai = HR hủy + thêm tay — ADR-129 |
| Xuất **.xlsx thật**, tự ghi trên `fflate` | TL (B) | Rủi ro `;` Excel vi-VN + BOM; ít phụ thuộc — ADR-130 |
| Phép năm **tính khi đọc**; phép chuyển sang **chụp ở đường ghi** | TL (D) | ADR-131 |
| Cấu hình không thấp hơn luật | TL | ≥ 12 ngày (BLLĐ 2019 Đ.113), bước thâm niên ≤ 5 năm, cộng ≥ 1 ngày (Đ.114) |
| Migration đổi nghĩa cột đi **cùng PR** code đọc cột | TL (B) | `leave_balances` đổi trong migration 9 của T-057 |
| Phép năm đầu của người vào giữa năm | Người dùng 17/10 | **Đủ** phép năm (không tỷ lệ) — có lợi hơn mức tối thiểu Đ.113 k.2 nên hợp lệ |
| Mốc thâm niên phép | Người dùng 17/10 | Đủ 5 năm trong năm Y (tính tới 31/12/Y) ⇒ +1 ngày ngay năm Y |
| Cửa sổ đơn bổ sung giờ | Người dùng 17/10 | Tháng này + tháng trước |
| Vào làm / nghỉ việc / kích hoạt / nhận lại | Người dùng 17/10 | Ở **Mốc 3.5** (`company-level.md` ADR-137, T-062) — Mốc 5 (T-054) chỉ **mở rộng** `POST hr/employees` bằng trường hồ sơ tùy chọn |

## 1. Phạm vi v1

**Có:** hồ sơ nhân viên (4 trường) + "Hồ sơ của tôi"; trường hồ sơ **tùy chọn** mở rộng form/route "Thêm nhân viên" / "Nhận lại" của Mốc 3.5 (T-054, T-058a); đơn bổ sung giờ (gửi/hủy/duyệt/từ chối, thông báo); 2 báo cáo .xlsx; chính sách phép theo năm, phép thâm niên tự tính, cộng dồn có hạn; phân rã số phép cho nhân viên và HR.

**Không:** phòng ban dạng bảng / sơ đồ tổ chức / quản lý trực tiếp duyệt; danh bạ đồng nghiệp; thay giờ đã chấm qua đơn; thanh toán phép chưa nghỉ khi nghỉ việc (Đ.113 k.3 — kế toán gõ dòng lương); nhập Excel; xuất PDF; báo cáo tùy biến cột; đổi vai trò dự án từ trang Nhân sự (thuộc workspace); vòng đời nhân viên (Mốc 3.5).

## 2. ADR đề xuất

**ADR-128 — Hồ sơ nhân viên tối giản, không phiên bản, nguồn duy nhất của `hireDate`.**
- `EmployeeProfile` 1 dòng / user (PK `user_id`): `hireDate?`, `department?`, `jobTitle?`, `workPhone?`. Không FK tới `company_members` (dòng đó bị xóa khi nghỉ việc — company-level ADR-133): người đã nghỉ giữ hồ sơ để tính phiếu lương cuối, HR vẫn sửa được.
- **Không lưu** CCCD/CMND, địa chỉ nhà, ngày sinh, SĐT/email cá nhân, giới tính, ảnh. Lý do: (1) không tính năng nào cần; (2) repo public (ADR-072) — fixture/test/ảnh chụp dễ lọt dữ liệu thật; (3) NĐ 13/2023 (tối thiểu hóa, đúng mục đích) — mỗi trường thêm là thêm nghĩa vụ thông báo + thời hạn lưu R27; CCCD/ngày sinh tăng thiệt hại khi lộ. Thêm trường phải qua ADR mới + cập nhật mẫu thông báo R27.
- Quyền: `hr:manage` (HR + Admin) đọc/sửa hồ sơ của **người từng có nhiệm kỳ EMPLOYEE** (đang làm, chờ kích hoạt, sắp nghỉ, đã nghỉ); nhân viên đọc hồ sơ của mình qua `profile:self` (ma trận **công ty**, chỉ EMPLOYEE — company-level ADR-134/135; Admin không có). Parity cập nhật.
- **Luật self (B-H1, tuyệt đối):** HR sửa hồ sơ chính mình ⇒ 403 — hồ sơ của HR do HR khác hoặc Admin sửa. Kế toán chỉ đọc `hireDate` qua payroll.
- **Không phiên bản.** Ngày vào công ty là một sự kiện: đổi giá trị luôn là **sửa lỗi**. Lịch sử ở `HrAuditLog PROFILE_SET`. Bất biến của quá khứ đã có ở chỗ cần: Payslip chụp `hireDate`/`seniorityYears` (ADR-125), đơn phép đã duyệt không bị đụng (ADR-131). Đổi `hireDate` đã có ⇒ **lý do bắt buộc** (422 `REASON_REQUIRED`); payroll tự phát hiện chênh lệch (§8).
- **Vào làm / nhận lại:** contracts của Mốc 3.5 (`POST hr/employees`, B đã chốt) **không** có trường hồ sơ. Khi làm Mốc 5, **T-054 mở rộng** body đó bằng các trường hồ sơ **tùy chọn** — `hireDate?`, `department?`, `jobTitle?`, `workPhone?`, `keepHireDate?` — ghi hồ sơ **cùng transaction** với thêm nhân viên (không gửi ⇒ như Mốc 3.5, HR nhập hồ sơ sau ở "Sửa hồ sơ"). `hireDate` theo contract hồ sơ (≥ 1950-01-01 ⇒ 400; ≤ hôm nay ⇒ 422 `HIRE_DATE_IN_FUTURE`). **Nhận lại** có hồ sơ cũ (còn trong hạn lưu D8): form điền sẵn, `keepHireDate: true` giữ `hireDate` cũ (thâm niên tính tiếp), `false` + `hireDate` mới thay; không gửi ⇒ giữ nguyên hồ sơ cũ. Audit `PROFILE_SET` có `after.rehire = true`.
- Contract (Zod `.strict()` — trường lạ như `userId`, `version`, `updatedById` ⇒ 400): `hireDate` `YYYY-MM-DD`, ≥ `1950-01-01` (400); sau hôm nay theo businessClock ⇒ 422 `HIRE_DATE_IN_FUTURE` (luật phụ thuộc "hôm nay" của server — cùng kiểu `START_DATE_OUT_OF_RANGE`; TL chốt 17/10); `department`/`jobTitle` trim, 1..100, không ký tự điều khiển; `workPhone` chuẩn hóa còn `+` và chữ số, 8..15 số; `null` = xóa.
- Mọi thay đổi: `HrAuditLog PROFILE_SET` (before/after **không có** `workPhone` — chỉ cờ `workPhoneChanged`; lý do ở `after.note`, không dùng khóa `reason` — để bước D7' của retention xóa được), thông báo `PROFILE_UPDATED` cho nhân viên. Optimistic lock `version`.
- Đổi `hireDate` làm đổi phép (thâm niên; năm trước ngày vào) ⇒ response trả `negativeBalances` tính bằng **cùng hàm thuần** với `PUT leave/policy` (T-054 khai trường, rỗng tới khi T-057 nối port phép). Lệnh này lấy khóa theo bảng ADR-136: `taskflow:leave-policy` (shared) → `taskflow:leave:<user>` → `authorizeCompanyWrite` (row).
- Port consumer-owned (ADR-043): `leave/application/ports/hire-date.port.ts`, `payroll/application/ports/hire-date.port.ts` — `hireDates({ userIds }): Map<userId, LocalDate|null>`; adapter trong module `hr-profile`.

**ADR-129 — Đơn bổ sung giờ là đơn có duyệt; duyệt = đúng đường ADJUSTMENT hiện có.**
- Máy trạng thái: `PENDING → APPROVED | REJECTED | CANCELLED`. Mọi chuyển khác ⇒ 409 `invalid_transition`.

| Từ → Đến | Ai | Điều kiện | Tác dụng · Thông báo · Audit |
|---|---|---|---|
| (mới) → PENDING | người gửi (`attendance:self`, nhân viên đang làm) | luật gửi bên dưới; `Idempotency-Key` bắt buộc | mọi `hr:manage` hiện tại + Admin **trừ người gửi** · `CORRECTION_SUBMIT` |
| PENDING → CANCELLED | người gửi | — | HR · `CORRECTION_CANCEL` |
| PENDING → APPROVED | `hr:manage`, **khác** người gửi (tuyệt đối) | kiểm LẠI luật gửi 1–5 trong khóa; người gửi vẫn là nhân viên (`ICompanyAccess.isEmployee`) — đã nghỉ / bị nâng Admin ⇒ 422 `REQUESTER_NOT_EMPLOYEE`; hết cửa sổ lúc duyệt ⇒ 422 — hai ca này chỉ còn từ chối được | tạo 1 lượt ADJUSTMENT · người gửi · `CORRECTION_DECIDE` + `EVENT_ADJUST` |
| PENDING → REJECTED | như trên | ghi chú tùy chọn | người gửi · `CORRECTION_DECIDE` |

- **Luật gửi** — hàm thuần ở `attendance/domain` (Stryker `attendance-domain`); ngày/giờ theo múi giờ lịch hiệu lực của công ty, `businessClock`:
  1. `date ≤ hôm nay`; `date ≥ max(ngày 1 tháng TRƯỚC, ngày đầu nhiệm kỳ hiện tại `start_date`, mốc retention)` — ngoài ⇒ 422 `CORRECTION_DATE_OUT_OF_RANGE` (mốc retention ⇒ `OUTSIDE_RETENTION` như T-047). Cũ hơn: báo HR sửa tay. Đã có lịch nghỉ việc: `date > offboard_last_day` không thể (luật 2 — ngày tương lai).
  2. Thời điểm xin ≤ bây giờ ⇒ không thì 422 `CORRECTION_IN_FUTURE` (gồm `nextDay`: OUT 05:59 hôm sau gửi lúc 05:58 ⇒ 422).
  3. **Không thay thế:** đã có IN hợp lệ ⇒ không xin IN; đã có OUT hợp lệ sau `firstIn` ⇒ không xin OUT ⇒ 422 `CORRECTION_EVENT_EXISTS`. "Giờ chấm sai" là khiếu nại: HR xem IP/UA rồi hủy + thêm tay.
  4. OUT xin phải sau `firstIn`; IN xin phải trước `lastOut` ⇒ 422 `CORRECTION_TIME_ORDER`. OUT sau nửa đêm: `nextDay = true`, giờ < 06:00 (giờ chốt ngày công A#7).
  5. Ngày có phép **cả ngày** đã duyệt ⇒ 422 `CORRECTION_DAY_ON_LEAVE`. Nửa ngày, lễ, ngày nghỉ: được gửi.
  6. Một PENDING / (user, ngày, loại) — partial unique ⇒ 409 `correction_pending_exists`. Lặp request cùng `Idempotency-Key` của chính mình ⇒ trả kết quả cũ (như check-in).
- **Khóa (bảng ADR-136):** mọi lệnh ghi lượt chấm của một người — chấm web, HR thêm/hủy tay, duyệt đơn bổ sung — lấy `taskflow:attendance:punch:<user>` (bậc 4) rồi mới tới dòng `company_members` (bậc 5: `authorizeCompanyWrite` của HR, `assertActiveEmployee` của người gửi) ⇒ duyệt IN ‖ HR thêm IN tay không ra 2 IN; duyệt OUT ‖ nhân viên bấm Ra tuần tự hóa (kiểm luật 3 thấy lượt kia ⇒ 422).
- **Duyệt:** một transaction: khóa `attendance:punch:<user>` → `authorizeCompanyWrite('hr:manage', targetUserId)` (đọc lại quyền FOR SHARE, B-H3; self ⇒ 403) → đọc đơn + kiểm lại luật 1–5 → gọi **cùng hàm nội bộ** với `AttendanceEventsUseCases.adjust` (A tách `#appendAdjustment(tx, …)`: cùng tính `occurredAt`, `assertInsideRetention`, audit `EVENT_ADJUST`; **không** gửi `ATTENDANCE_ADJUSTED`, thay bằng `CORRECTION_APPROVED`) → `UPDATE … SET status='APPROVED', created_event_id, decided_*, version+1 WHERE id AND status='PENDING' AND version = expectedVersion` (đếm 1). `note` của lượt = `"Đơn bổ sung giờ"` + id (không chép lý do nhân viên).
- **Idempotent:** lặp `approve` **cùng người duyệt + cùng `expectedVersion`** sau khi đã APPROVED ⇒ 200 trạng thái hiện tại, không lượt mới. HR **khác** duyệt lại ⇒ 409 `invalid_transition`. `created_event_id` UNIQUE chốt ở DB.
- Chấp nhận: duyệt IN ‖ duyệt đơn nghỉ cả ngày cùng ngày (khác khóa) có thể để lại lượt IN trên ngày nghỉ — **ON_LEAVE thắng lượt chấm** khi tính (ADR-121/126), không khóa chéo.
- **Nghỉ việc** (Mốc 3.5 ADR-137, bước hoàn tất): đơn bổ sung PENDING của người nghỉ ⇒ CANCELLED qua port do attendance sở hữu (`offboardCleanup` của attendance, cùng transaction hoàn tất, sau `attendance:punch:<user>`); màn lên lịch nghỉ cảnh báo HR "còn N đơn bổ sung chờ — duyệt trước ngày cuối".
- **Lương:** MISSING_OUT = 0 công tới khi có OUT (payroll §0). Form + thẻ cảnh báo nhắc "gửi trước ngày 5". Đơn duyệt sau khi bảng lương tháng đó PUBLISHED ⇒ payroll gắn "công đã thay đổi sau phát hành" (ADR-127, không cơ chế mới); bảng còn NHÁP ⇒ cảnh báo "Tính lại công" sẵn có.
- `reason` bắt buộc 1..500 (có thể nhắc sức khỏe) ⇒ như lý do nghỉ (B-H2): chỉ người gửi + HR; không vào thông báo, audit, log, file xuất. Body gửi đơn `.strict()` (không nhận `userId` ⇒ 400). Hạn mức gửi 20/giờ/user ⇒ 429.
- `CORRECTION_SUBMITTED`, `CORRECTION_CANCELLED` thêm vào `HR_AUDIENCE_TYPES` (`notifications/domain/notification.ts`) ⇒ chuông lọc theo quyền **hiện tại**; thu grant ⇒ thông báo này biến mất khỏi danh sách.

**ADR-130 — Xuất báo cáo .xlsx tự ghi tối thiểu trên `fflate`, phía server, không công thức.**
- Bác CSV: Excel vi-VN dùng `;` làm phân cách ⇒ CSV `,` mở thành một cột; thêm `sep=,` thì Excel **bỏ qua BOM** ⇒ vỡ dấu; xuất `;` thì LibreOffice/Google Sheets lệch. Endpoint CSV Mốc 3 **giữ nguyên** (đường dẫn công ty của Mốc 3.5); web chuyển sang nút Excel.
- Cách ghi — chọn (c): **tự ghi** OOXML tối thiểu (`[Content_Types].xml`, `_rels`, `xl/workbook.xml`, `xl/styles.xml`, `xl/worksheets/sheetN.xml`, `docProps/core.xml`) và nén bằng `fflate` (zip streaming, không phụ thuộc con). Chỉ ô `inlineStr`, số, ngày (số serial + style); **không** `sharedStrings`; code **không có nhánh nào sinh `<f>`**, không hyperlink. Sau port `ISpreadsheetWriter` ở `core/infrastructure` (depcruise: domain/application không import). Cổng T-055 (khi có mạng): so (a) ExcelJS, (b) `write-excel-file`, (c) fflate theo `pnpm audit`, người duy trì, cây phụ thuộc, khả năng stream; chọn khác (c) thì ghi lại trong báo cáo vé. **R35** chuỗi cung ứng thư viện xuất file.
- **Chống injection:** giá trị ghi **nguyên văn** (không thêm `'`), kiểu chuỗi; ô chữ bắt đầu bằng `=` `+` `-` `@` TAB CR mang style `quotePrefix="1"` (an toàn cả khi người dùng lưu lại thành CSV). Mọi chuỗi lọc ký tự cấm trong XML 1.0 (U+0000–U+001F trừ TAB/LF/CR, U+FFFE/U+FFFF, surrogate lẻ ⇒ thay U+FFFD). Chuỗi > 32 767 ký tự: ngoài phạm vi (mọi trường ≤ 500).
- Tổng do server tính (`totalsOf`, số dư phép) và ghi giá trị số.
- **Phạm vi:** **cả công ty** — mọi người có nhiệm kỳ EMPLOYEE giao kỳ báo cáo (đang làm, sắp nghỉ, đã nghỉ trong kỳ — nhãn "đã nghỉ"); Admin không có dòng trừ những ngày thuộc nhiệm kỳ EMPLOYEE cũ (company-level ADR-134).
- **Nhất quán + tải:** mỗi báo cáo chạy trong **một transaction `REPEATABLE READ READ ONLY`** với `SET LOCAL statement_timeout = '30s'`, đọc theo lô 50 nhân viên với số truy vấn cố định mỗi lô (sự kiện, phép, lịch, nhiệm kỳ `ICompanyTenurePort` — không N+1), ghi dòng rồi `flush` vào response (backpressure). Index đơn nghỉ `(status, start_date, id)` đã có ở migration 5 (company-level ADR-136); báo cáo phép dùng `splitHalfDays` dùng chung với kiểm số dư, cắt theo nhiệm kỳ khi đếm.
- **Kích thước:** đếm số người / số dòng đơn **trước** khi gửi header: > 1 000 người hoặc > 20 000 dòng đơn ⇒ 422 `EXPORT_TOO_LARGE` (không byte xlsx nào). Lỗi **sau** khi đã gửi 200 ⇒ `res.socket.destroy()` (không `end()`) để `fetch` của web reject, không lưu zip cụt.
- Header: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="bang-cong-2026-10.xlsx"` / `"nghi-phep-2026.xlsx"` (dựng từ tham số đã validate — không tên người/công ty), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Access-Control-Expose-Headers: Content-Disposition`. `docProps`: `creator = "TaskFlow"`; không `lastModifiedBy`, `Company`, `Manager` (không ghi `docProps/app.xml`); không sheet ẩn, không `definedNames`, không macro.
- **Hạn mức:** dùng **chung bucket** với CSV hiện có — 20/giờ/user — cộng tối đa **2 export đồng thời cho cả công ty** ⇒ 429 (một transaction dài giữ một kết nối pool).
- **Audit `EXPORT`** chỉ khi stream bắt đầu thành công (sau mọi kiểm tra, trước byte đầu): `after = { report: 'ATTENDANCE_MONTH'|'LEAVE_YEAR', period, from?, to?, rows, format: 'xlsx' }`. 429/400/422 không audit (422 chỉ log). Lỗi giữa stream: audit đã ghi.
- Không xuất: IP/UA, lý do nghỉ, ghi chú quyết định, lý do đơn bổ sung, SĐT.

**ADR-131 — Chính sách phép theo năm; phép năm tính khi đọc; phép chuyển sang chụp ở đường ghi.**
- `LeavePolicy(year)` (PK `year`, một bộ cho cả công ty): `annualDays` (12, 12..30, bước 0,5), `seniorityStepYears` (5, 1..5), `seniorityBonusDays` (1, 1..5, bước 0,5), `carryOverEnabled` (tắt), `carryOverMaxDays` (0..30, bước 0,5), `carryOverExpiryMonth` (1..12, mặc định 3). Mặc định = **mức luật** (Đ.113 k.1: 12 ngày; Đ.114: đủ 5 năm làm việc cho một NSDLĐ ⇒ +1 ngày); không thấp hơn luật (CHECK + Zod). Năm chưa có dòng ⇒ dòng gần nhất trước đó, không có ⇒ mặc định.
- HR sửa chính sách **năm hiện tại và năm sau**; năm đã qua chỉ đọc (422 `POLICY_YEAR_LOCKED`). Sửa năm hiện tại: số phép tính lại khi đọc; đơn đã duyệt không bị đụng; response trả `negativeBalances`, web cảnh báo — không tự thu hồi. Audit `POLICY_SET` (lý do ở `after.note`).
- **Khóa (bảng ADR-136, bậc 1):** mọi lệnh ghi phép (submit, approve, cancel, revoke, PATCH balance, chụp `carried`, PUT hồ sơ khi đổi `hireDate`, `offboardCleanup` của Mốc 3.5) lấy `pg_advisory_xact_lock_shared('taskflow:leave-policy')` **trước** `taskflow:leave:<user>` (bậc 3); `PUT leave/policy` lấy bản **độc quyền** cùng khóa rồi mới `authorizeCompanyWrite` (row, bậc 5) ⇒ đơn được kiểm theo chính sách trước hoặc sau, không bao giờ lẫn. Không use case nào lấy ngược thứ tự.
- **Phép năm (hàm thuần `entitlementOf`, số nguyên nửa ngày, Stryker ≥ 90 % + property test):**
  - `base = annualDays + seniorityBonusDays × floor(years / seniorityStepYears)`; `years` = số năm tròn từ `hireDate` **tính tới 31/12/Y** (hàm chuỗi ngày thuần dùng chung với thâm niên lương — package thuần ADR-125).
  - Năm Y **không giao** nhiệm kỳ EMPLOYEE nào ⇒ `entitled = 0`; ngày bắt đầu hiệu lực = `max(hireDate, start_date của nhiệm kỳ giao Y)` — sau 31/12/Y ⇒ 0.
  - Vào làm trong năm Y ⇒ **đủ `base`, không tỷ lệ** (người dùng chốt 17/10; có lợi hơn mức tối thiểu "theo tỷ lệ tháng" của Đ.113 k.2 nên hợp lệ). Ví dụ bịa: vào 20/07/2026 ⇒ 12 ngày cho 2026; `years` = 0 ⇒ không thâm niên.
  - **Nhận lại** (company-level ADR-136, D H2/H3): nhiệm kỳ trước **không** giao năm Y ⇒ đủ `base` năm Y như người mới (thâm niên theo `hireDate` cũ nếu HR giữ — ADR-128); nhiệm kỳ trước **cùng** năm Y ⇒ **không cấp lại**: tiếp tục số dư năm Y — đơn bắt đầu trước `start_date` hiện tại không tính, `adjustmentDays` năm Y đã reset về 0 lúc nhận lại (audit `BALANCE_ADJUST`).
  - Không `hireDate` ⇒ `annualDays` + cờ "Thiếu ngày vào công ty".
  - Đếm "đã dùng"/"đang chờ": chỉ đơn của nhiệm kỳ hiện tại (`belongsToTenure`), mỗi đơn đếm phần trong nhiệm kỳ (`countTenureHalfDays` — đơn APPROVED vắt qua `lastDay` chỉ trừ phần ≤ `lastDay`).
- **Giữ nghĩa cột cũ:** `adjustmentDays` giữ nguyên. `entitledDays` thành **nullable, NULL = theo chính sách**; khác NULL = ghi đè cố định. Migration 9 (D-H4): `UPDATE … SET entitled_days = NULL WHERE entitled_days = 12 AND year >= <năm hiện tại>` — năm hiện tại tính bằng giờ thật lúc deploy theo `Asia/Ho_Chi_Minh` (SQL không đọc được `businessClock`); **năm cũ giữ 12 làm ghi đè** (số liệu năm đã qua không đổi). Migration in số dòng khác 12. Tạo lười dòng mới không đặt giá trị ⇒ NULL (DROP DEFAULT). Không API nào ghi đè ở v1. *(Mốc 3.5 tạo lại `leave_balances` rỗng — migration này chủ yếu là DROP DEFAULT / DROP NOT NULL; câu UPDATE vẫn giữ cho DB nào đã có dòng.)*
- **Phép chuyển sang (D-H1, H2; Mốc 3.5 H3):** cột `carriedOverDays` (NULL = chưa chụp) trên `LeaveBalance(user, Y)`.
  - Giá trị: `carried(Y) = (continuous(user, Y−1→Y) && carryOverEnabled(Y−1)) ? min(carryOverMaxDays(Y−1), max(0, remainingAtYearEnd(Y−1))) : 0`, trong đó `continuous` = có **một** nhiệm kỳ EMPLOYEE chứa cả 31/12/(Y−1) lẫn 01/01/Y (`ICompanyTenurePort`; nghỉ việc hoặc nâng Admin ở giữa ⇒ không chuyển — phép còn lại thanh toán theo Đ.113 k.3, ngoài phạm vi); `remainingAtYearEnd` chỉ đếm đơn **APPROVED** của nhiệm kỳ đó (không trừ PENDING). Không chuyển tiếp lần 2.
  - **Chụp ở đường ghi:** submit / approve / PATCH balance / PUT policy chạm năm Y khi Y đã bắt đầu ⇒ trong khóa `taskflow:leave:<user>`: `INSERT … ON CONFLICT DO NOTHING` rồi `UPDATE … SET carried_over_days = $v WHERE carried_over_days IS NULL`. **Job 01/01** (giờ lịch công ty, theo lô, idempotent, cùng thứ tự khóa, mẫu T-033) chụp cho mọi nhân viên đang làm còn NULL.
  - **GET** gặp NULL ⇒ tính tạm bằng cùng hàm thuần, **không ghi**, DTO `carriedFinal: false`.
  - Tính lại `carried(Y)` trong cùng khóa khi Y−1 đổi sau khi đã chụp: HR PATCH `adjustmentDays` Y−1; **duyệt muộn** một đơn Y−1 (PENDING từ tháng 12 duyệt trong tháng 1).
- **Kiểm số dư (thay công thức ADR-122, trong khóa, cả gửi lẫn duyệt):** `B = entitled + adjustment`, `C = carried`, `E` = ngày cuối tháng `carryOverExpiryMonth` năm Y (hàm ngày thuần — tháng 2 ⇒ 28/29 theo năm nhuận, D-L3). Chia nửa ngày ANNUAL (APPROVED + PENDING khác + đơn đang xét, của nhiệm kỳ hiện tại, bằng `splitHalfDays`) thành `uEarly` (≤ E), `uLate` (> E). Hợp lệ ⇔ `max(0, uEarly − C) + uLate ≤ B`. Còn lại = `B − max(0, uEarly − C) − uLate + (hôm nay ≤ E ? max(0, C − uEarly) : 0)`.
- Giữ "đơn không vắt qua 2 năm" (`LEAVE_SPANS_YEARS`) và `AFTER_LAST_DAY` của Mốc 3.5.
- **Chuyển tiếp Mốc 3 → 5:** Mốc 3 §9 dặn HR tự trừ `adjustmentDays` theo tỷ lệ cho người vào giữa năm; nay chính sách là **đủ phép** ⇒ khi HR nhập `hireDate` trong năm hiện tại cho người có `adjustmentDays < 0`, response `warnings: ['ADJUSTMENT_DAYS_REVIEW']`, form nhắc "Trước đây phép năm đầu bị trừ theo tỷ lệ — nay công ty cho đủ, kiểm tra lại điều chỉnh X ngày". (Chưa production — Mốc 3.5 xóa dữ liệu phép cũ, nên cảnh báo chủ yếu cho dữ liệu nhập lại sau đó.)

**(Bỏ) ADR-132 — Vào làm / nghỉ việc.** Chuyển sang `company-level.md` **ADR-137** (T-062): thêm nhân viên + tài khoản chờ kích hoạt + link 7 ngày, kích hoạt, cho nghỉ việc có lịch + job hoàn tất (gồm `offboardCleanup` đơn nghỉ của leave và đơn bổ sung của attendance), hủy lịch, nhận lại, danh sách nhân viên theo trạng thái. Đổi vai trò dự án MEMBER↔PM từ trang Nhân sự **bỏ hẳn**. Mốc 5 chỉ: (a) **mở rộng** body `POST hr/employees` bằng trường hồ sơ tùy chọn + `keepHireDate?` (T-054 — ngoài phạm vi Mốc 3.5); (b) cột phòng ban/chức vụ/ngày vào ở danh sách `/hr/employees` (T-058a).

## 3. Dữ liệu — migration 6, 8, 9 (5 = `company_level`, 7 = payroll)

Đánh số theo `company-level.md` §8: **5** `company_level` (T-061) · **6** `hr_employee_profile` (T-054) · **7** payroll + `payroll_settings` (T-048) · **8** `hr_attendance_corrections` (T-055) · **9** `hr_leave_policy` (T-057, gồm đổi nghĩa `leave_balances` — cùng PR với code đọc NULL). Timestamp thư mục migration đặt **ngay trước khi merge** (TL kiểm). Nguyên tắc: migration đổi nghĩa cột đi cùng code đọc cột. CHECK bằng SQL tay như migration 3/4. FK user → `users Restrict`. **Không** cột `workspace_id` / `company_id` (company-level ADR-133). `grant-app.sql` cấp DML cho mọi bảng sau mỗi `db:deploy` — không cần script quyền mới; không sequence (UUIDv7 từ app); app role không có DDL.

```
// ---- 6 (T-054)
model EmployeeProfile {
  userId      String    @id @map("user_id") @db.Uuid   → users Restrict
  hireDate    DateTime? @map("hire_date") @db.Date
  department  String?   @db.VarChar(100)
  jobTitle    String?   @map("job_title") @db.VarChar(100)
  workPhone   String?   @map("work_phone") @db.VarChar(16)   // đã chuẩn hóa: +? và chữ số
  version     Int       @default(1)
  updatedById String    @map("updated_by_id") @db.Uuid   → users Restrict
  createdAt, updatedAt
  @@index([updatedById])
  @@map("employee_profiles")
}
-- CHECK hire_date >= '1950-01-01'  (cận trên ở contract — CHECK không dùng now())
-- CHECK department IS NULL OR btrim(department) <> ''   (tương tự job_title)
-- CHECK work_phone IS NULL OR work_phone ~ '^\+?[0-9]{8,15}$'
enum NotificationType + PROFILE_UPDATED

// ---- 8 (T-055) — chỉ bảng/enum mới
enum CorrectionStatus { PENDING APPROVED REJECTED CANCELLED }
model AttendanceCorrectionRequest {
  id, userId → users Restrict, workDate @db.Date, kind AttendanceKind,
  minuteOfDay Int @map("minute_of_day"), nextDay Boolean @default(false) @map("next_day"),
  reason VarChar(500)?, status CorrectionStatus @default(PENDING),
  idempotencyKey VarChar(64), decidedById?, decidedAt? Timestamptz(3), decisionNote? VarChar(500),
  createdEventId? @unique @db.Uuid  → attendance_events.id ON DELETE NO ACTION,
  version Int @default(1), createdAt, updatedAt
  @@unique([userId, workDate, kind], map: "attendance_corrections_pending_key", where: raw("status = 'PENDING'"))
  @@unique([userId, idempotencyKey])
  @@index([status, createdAt, id])  @@index([userId, workDate])  @@index([decidedById])
  @@map("attendance_correction_requests")
}
-- NO ACTION (không Restrict): kiểm cuối câu lệnh ⇒ retention xóa đơn + lượt chấm trong một lượt không vỡ (B-HIGH-2)
-- CHECK minute_of_day BETWEEN 0 AND 1439
-- CHECK NOT next_day OR (kind = 'OUT' AND minute_of_day < 360)
-- CHECK reason IS NOT NULL OR status <> 'PENDING';  CHECK reason IS NULL OR btrim(reason) <> ''   (NULL sau retention §7)
-- CHECK (status IN ('APPROVED','REJECTED')) = (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)
-- CHECK (status = 'APPROVED') = (created_event_id IS NOT NULL)
enum NotificationType + CORRECTION_SUBMITTED CORRECTION_APPROVED CORRECTION_REJECTED CORRECTION_CANCELLED

// ---- 9 (T-057)
model LeavePolicy {
  year Int @id, annualDays Decimal(4,1) @default(12), seniorityStepYears Int @default(5),
  seniorityBonusDays Decimal(3,1) @default(1), carryOverEnabled Boolean @default(false),
  carryOverMaxDays Decimal(4,1) @default(0), carryOverExpiryMonth Int @default(3),
  version Int @default(1), updatedById → users Restrict, updatedAt
  @@index([updatedById])  @@map("leave_policies")
}
-- CHECK year BETWEEN 2000 AND 2100; annual_days BETWEEN 12 AND 30; seniority_step_years BETWEEN 1 AND 5
-- CHECK seniority_bonus_days BETWEEN 1 AND 5; carry_over_max_days BETWEEN 0 AND 30; carry_over_expiry_month BETWEEN 1 AND 12
-- CHECK bội số 0,5: (x * 2) = trunc(x * 2) cho mọi cột Decimal
LeaveBalance (PK user_id, year — Mốc 3.5)
              entitled_days: DROP DEFAULT, DROP NOT NULL (NULL = theo chính sách)
              + carried_over_days Decimal(4,1)?   -- NULL = chưa chụp
-- UPDATE leave_balances SET entitled_days = NULL
--   WHERE entitled_days = 12 AND year >= EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh');
-- CHECK entitled_days IS NULL OR entitled_days >= 0; CHECK carried_over_days IS NULL OR carried_over_days >= 0 (+ bội 0,5)
-- Index đơn nghỉ (status, start_date, id) đã có từ migration 5 — không tạo lại.

HrAuditLog.action + PROFILE_SET CORRECTION_SUBMIT CORRECTION_CANCEL CORRECTION_DECIDE POLICY_SET
                   (EXPORT có sẵn; EMPLOYEE_* và ACTIVATION_LINK_ISSUED thuộc migration 5; ≤ 32 ký tự; chốt ở contracts)
```

## 4. API (`/api/v1/…`, contracts Zod `.strict()` + OpenAPI)

Thứ tự lỗi như `company-level.md` ADR-135: 401 (chưa đăng nhập / không còn thuộc công ty ⇒ `SESSION_REVOKED`) → 403 quyền (`permit` trước validate ⇒ body sai vẫn 403) → 400 → 404 tài nguyên con → 422/409. Lệnh ghi `hr:manage` qua `authorizeCompanyWrite` theo bảng khóa ADR-136. Router khai báo `employee-profiles/me` và `employee-profiles/departments` **trước** `employee-profiles/:userId` (B-MEDIUM-2, có test HTTP).

| Method · Path | Quyền | Ghi chú · Lỗi riêng |
|---|---|---|
| `GET hr/employee-profiles?cursor&q` | `hr:manage` | người từng có nhiệm kỳ EMPLOYEE (nhãn đang làm / sắp nghỉ / đã nghỉ), `seniority`, cờ `missingHireDate`; limit 50; `q` ≤ 100 ký tự (dài hơn ⇒ 400), `ILIKE` có escape `%` `_` `\` |
| `GET hr/employee-profiles/me` | `profile:self` | hồ sơ của mình (gồm `workPhone`); Admin ⇒ 403 (không có `profile:self`) |
| `GET hr/employee-profiles/departments` | `hr:manage` | gợi ý phòng ban/chức vụ đã dùng **trong công ty** |
| `GET hr/employee-profiles/:userId` | `hr:manage` | chưa từng có nhiệm kỳ EMPLOYEE ⇒ 404 `user`; chưa có hồ sơ ⇒ 200 trường null |
| `PUT hr/employee-profiles/:userId` | `hr:manage` | `{hireDate?, department?, jobTitle?, workPhone?, expectedVersion, reason?}` (`expectedVersion = 0` khi tạo); self ⇒ 403; `hireDate` sau hôm nay ⇒ 422 `HIRE_DATE_IN_FUTURE`; đổi `hireDate` đã có thiếu lý do ⇒ 422 `REASON_REQUIRED`; 409 `VERSION_CONFLICT`; response `{ profile, negativeBalances: [{year, remainingDays}], warnings }` |
| `POST hr/employees` (route của Mốc 3.5) | `hr:manage` | T-054 **mở rộng** body (tùy chọn): `hireDate?`, `department?`, `jobTitle?`, `workPhone?`, `keepHireDate?` — ghi hồ sơ cùng transaction; không gửi ⇒ hành vi Mốc 3.5 |
| `POST attendance/corrections` | `attendance:self` | header `Idempotency-Key`; `{date, kind, time "HH:mm", nextDay?, reason}` ⇒ 201; 422 `CORRECTION_DATE_OUT_OF_RANGE` · `OUTSIDE_RETENTION` · `CORRECTION_IN_FUTURE` · `CORRECTION_EVENT_EXISTS` · `CORRECTION_TIME_ORDER` · `CORRECTION_DAY_ON_LEAVE`; 409 `correction_pending_exists`; 429 (20/giờ) |
| `GET attendance/corrections?mine=1&cursor` · `POST attendance/corrections/:id/cancel` | `attendance:self` | đơn người khác ⇒ 404; 409 `invalid_transition` |
| `GET attendance/corrections?status=&cursor` | `hr:manage` | kèm `firstIn`, `lastOut`, trạng thái ngày |
| `POST attendance/corrections/:id/approve` · `…/reject` | `hr:manage` | `{expectedVersion, note?}`; self ⇒ 403 (tuyệt đối); approve: 422 như luật gửi + `REQUESTER_NOT_EMPLOYEE`; 409 `invalid_transition` · `VERSION_CONFLICT`; trả `{ request, event, day }` |
| `GET attendance/export.xlsx?month=YYYY-MM` | `hr:manage` | ADR-130; `month` sai mẫu ⇒ 400; tháng chưa bắt đầu ⇒ 422 `PERIOD_NOT_STARTED`; 422 `EXPORT_TOO_LARGE`; 429 |
| `GET leave/export.xlsx?year=YYYY&from&to` | `hr:manage` | `from/to` trong `year` (mặc định cả năm), `from > to` hoặc vắt năm ⇒ 400 |
| `GET leave/policy?year=` · `PUT leave/policy/:year` | `hr:manage` | `PUT {…fields, expectedVersion, reason?}`; năm ∉ {nay, sau} ⇒ 422 `POLICY_YEAR_LOCKED`; dưới mức luật ⇒ 400; trả `{ policy, negativeBalances: [{userId, user, remainingDays}] }` |
| `GET leave/balances/me?year=` · `GET leave/balances?year=` | `leave:self` · `hr:manage` | **thêm** phân rã `base`, `seniorityBonus`, `seniorityYears`, `entitled`, `adjustment`, `carriedOver`, `carriedFinal`, `carriedExpiresOn`, `carriedUsable`, `used`, `pending`, `remaining`; giữ trường cũ |

## 5. Web (E) — 360 px trước, nhãn tiếng Việt, người dùng không rành IT

- **`/hr`** (Mốc 3.5: Hôm nay · Bảng công tháng · Đơn nghỉ · Lịch & ngày lễ · Số phép · Nhân viên `/hr/employees`) thêm **"Bổ sung giờ"** (sau "Đơn nghỉ", kèm số chờ: "Bổ sung giờ (3)") — 7 tab, xuống dòng ở 360 (T-046), không dịch bố cục. Chính sách phép: nút "Cài chính sách phép" trong tab "Số phép".
- **Nhân viên (HR, `/hr/employees` của Mốc 3.5):** Mốc 5 thêm phòng ban · chức vụ · "Vào công ty 03/2019 — 7 năm 7 tháng" vào thẻ/bảng; thiếu ngày vào ⇒ nhãn "Thiếu ngày vào công ty — cần cho lương và phép thâm niên" (chữ + biểu tượng); menu thẻ thêm "Sửa hồ sơ". Thẻ của chính HR: "Sửa hồ sơ" ẩn, dòng "HR khác hoặc Admin sửa".
- **Thêm nhân viên / Nhận lại** (form của Mốc 3.5, T-058a mở rộng): thêm Ngày vào công ty, Phòng ban, Chức vụ, SĐT công việc (đều không bắt buộc); nhận lại: điền sẵn hồ sơ cũ + chọn "Giữ ngày vào cũ (dd/mm/yyyy) / Ngày vào mới".
- **Sửa hồ sơ (HR):** Form dọc: "Ngày vào công ty" (`<input type="date">`), "Phòng ban", "Chức vụ" (gợi ý), "Số điện thoại công việc" (`inputMode="tel"`, "không nhập số cá nhân"). Đổi ngày vào đã có ⇒ ô "Lý do sửa" bắt buộc; response có người âm phép ⇒ hiện danh sách. 409 ⇒ giữ dữ liệu + "Tải bản mới".
- **Hồ sơ của tôi:** mục "Hồ sơ nhân sự" ở menu header công ty ⇒ `/my-profile`: 4 dòng chỉ đọc + thâm niên + "Thông tin sai? Báo bộ phận nhân sự". Admin: ẩn.
- **Đơn bổ sung giờ (nhân viên):** trong hộp chi tiết ngày của `/attendance` (T-046) — MISSING_OUT ⇒ **"Xin bổ sung giờ ra"**; ABSENT / có OUT không IN ⇒ **"Xin bổ sung giờ vào"**; đã có đơn chờ ⇒ "Đã gửi đơn — chờ duyệt" + "Hủy đơn". Thẻ cảnh báo MISSING_OUT (payroll T-050) cũng có nút. Form (sheet toàn màn ở 360): ngày + loại cố định, giờ (`<input type="time">`), ô "Ra sau nửa đêm" khi giờ < 06:00, "Lý do" (gợi ý "Quên bấm Ra khi về", "không cần ghi bệnh"), nhắc "Gửi trước ngày 5 để kịp tính lương". Web sinh `Idempotency-Key` mỗi lần mở form; 409 `correction_pending_exists` hiển thị "Đã gửi". `/attendance` thêm "Đơn bổ sung giờ của tôi".
- **Tab "Bổ sung giờ" (HR):** thẻ: tên · ngày · "Xin giờ ra 17:45" · giờ hiện có · lý do · [Duyệt] [Từ chối]. Đơn của chính HR: nút mờ "Người khác duyệt". 422 hết cửa sổ / không còn là nhân viên ⇒ "Chỉ có thể từ chối" + nút Duyệt mờ.
- **Xuất Excel:** "Tải Excel" ở tab Bảng công tháng (thay CSV); "Tải báo cáo nghỉ phép" ở tab Số phép (năm, từ, đến). `fetch` Bearer → Blob; tên file đọc từ `Content-Disposition`; đang tạo ⇒ nút khóa "Đang tạo file…"; `fetch` reject ⇒ "Không tạo được file, thử lại" (không lưu file); 429/422 ⇒ câu dễ hiểu.
- **Chính sách phép:** form theo năm (Năm nay / Năm sau): "Số ngày phép năm" (tối thiểu 12 — "theo Bộ luật Lao động"), "Cứ mỗi … năm làm việc được thêm … ngày", công tắc "Cho chuyển phép chưa dùng sang năm sau" ⇒ "Tối đa … ngày", "Dùng trước hết tháng …". Ví dụ sống: "Nhân viên vào 01/03/2019 có 13 ngày phép năm 2026; người vào giữa năm nay có đủ 12 ngày". Lưu ⇒ xác nhận; có người âm phép ⇒ danh sách.
- **Số phép (nhân viên `/leave` + HR):** "Phép năm 12 + thâm niên 1 = 13 · Điều chỉnh −1 · Phép năm trước chuyển sang 2 (dùng trước 31/03) · Đã dùng 4 · Đang chờ 1 · **Còn 9**"; `carriedFinal: false` ⇒ "(tạm tính)".
- Mọi màn: `<table>` thật ở desktop, a11y, sáng/tối, giờ theo múi giờ lịch công ty, không dữ liệu cá nhân trong URL/title/localStorage; cache `['company', 'hr', …]` xóa khi mất `hr:manage` (`company:access-changed`).

## 6. Bảo mật (B) — ca SEC cho F (dải SEC-HR-40…55, bỏ 44)

| Mã | Ca | Mong đợi |
|---|---|---|
| SEC-HR-40 | Nhân viên thường `GET/PUT hr/employee-profiles/:other`, `approve` đơn bổ sung, `PUT leave/policy` với body sai | 403 (không 400) |
| SEC-HR-41 | `hr/employee-profiles/me`: đúng người, có `workPhone` của mình; Admin ⇒ 403; người đã nghỉ (sau `access_until`) ⇒ 401 `SESSION_REVOKED` | đúng |
| SEC-HR-42 | HR sửa hồ sơ chính mình; Admin sửa hồ sơ HR | 403; 200 |
| SEC-HR-43 | `GET`/`PUT hr/employee-profiles/:userId` với user chưa từng có nhiệm kỳ EMPLOYEE (gồm Admin chưa từng là nhân viên) | 404 `user` |
| SEC-HR-44 | *(bỏ — một công ty, không còn "cùng user ở 2 ws")* | — |
| SEC-HR-45 | Mass assignment `PUT` hồ sơ (`userId`, `version`, `updatedById`); `POST attendance/corrections` có `userId` | 400 strict |
| SEC-HR-46 | `q` = `%`, `_`, `\` khớp chữ thường (không trả cả danh sách); `q` 1 000 ký tự | đúng; 400 |
| SEC-HR-47 | Audit `PROFILE_SET` không có `workPhone`, không khóa `reason`; thông báo không có giá trị hồ sơ | đúng |
| SEC-HR-48 | IDOR: nhân viên hủy/xem đơn bổ sung của người khác; nhân viên gọi danh sách HR | 404; 403 |
| SEC-HR-49 | HR tự duyệt đơn bổ sung của mình; thu `HR_MANAGE` giữa lúc mở và duyệt | 403; 403 không lượt |
| SEC-HR-50 | Thu grant ⇒ thông báo `CORRECTION_SUBMITTED/CANCELLED` biến mất khỏi chuông; người gửi là HR không nhận thông báo đơn của chính mình | đúng |
| SEC-HR-51 | Lý do đơn bổ sung không có trong thông báo, audit, log, `note` lượt chấm, file xuất; gửi đơn lần 21/giờ | đúng; 429 |
| SEC-HR-52 | Export: nhân viên thường ⇒ 403; tham số `2026-13`, `2026-1`, `../x`, `%0d%0a`, 10 KB ⇒ 400; header content-type, tên file khớp `^bang-cong-\d{4}-\d{2}\.xlsx$`, `no-store`, `nosniff`, `Access-Control-Expose-Headers` | đúng |
| SEC-HR-53 | Payload `=HYPERLINK("http://x","y")`, `+1`, `-1+1`, `@SUM(A1)`, `\t=1`, `\r=1`, `=cmd\|' /C calc'!A0`, `http://…`, U+0001, emoji: không `<f>`, không hyperlink, giá trị nguyên văn không `'`, có `quotePrefix`; ký tự cấm XML bị thay; file mở được | đúng |
| SEC-HR-54 | File không có IP/UA, lý do, ghi chú, SĐT; không `docProps/app.xml`, không `lastModifiedBy`/`Company`/`Manager`, không sheet ẩn/`definedNames`; 21 lần/giờ (chung CSV) và export thứ 3 đồng thời trong công ty ⇒ 429, không audit | đúng |
| SEC-HR-55 | `PUT leave/policy/<năm đã qua>`; dưới luật (11 ngày, bước 6 năm); `leave/balances/me` chỉ của mình; Admin gọi `leave/balances/me` | 422 `POLICY_YEAR_LOCKED`; 400; đúng; 403 |

Vào làm / nghỉ việc / kích hoạt: SEC-HR-56…70 ở `company-level.md` §5.

Threat-model §6 (B): **R32** hồ sơ nhân viên là dữ liệu cá nhân (4 trường, R27) · **R33** đơn bổ sung có thể khai gian — HR duyệt, đối chiếu IP/UA các lượt khác; chấp nhận như R25 · **R34** file .xlsx đã tải ra ngoài tầm kiểm soát (mở rộng R28) · **R35** chuỗi cung ứng thư viện xuất file (fflate; cổng T-055). R36 (HR thêm người / nâng PM) thu hẹp và chuyển sang Mốc 3.5.

## 7. Lưu trữ (R27 — `data-retention.md`, B cập nhật)

| # | Dữ liệu | Thời hạn (theo phương án R27 được chốt, mặc định B) |
|---|---|---|
| D8 | `employee_profiles` | xóa khi người đó **không còn dòng `company_members`** (đã nghỉ) **và** không còn `company_member_departures` nào có `last_day ≥ mốc D5` (2 năm). Bước D8 chạy **trước** D5 (D5 xóa departure làm mất căn cứ). Nhận lại ⇒ có dòng `company_members` ⇒ giữ. Payslip giữ ảnh chụp `hireDate` theo thời hạn lương (payroll §3) |
| D9 | `attendance_correction_requests` | dòng xóa cùng D2 theo `work_date` (2 năm), **trước** lượt chấm cùng ngày trong cùng lượt job (`created_event_id` NO ACTION); `reason` + `decision_note` → NULL sau 13 tháng kể từ `work_date` (như D3), trừ PENDING |
| D7 | audit `PROFILE_SET`, `CORRECTION_*`, `POLICY_SET`, `EXPORT` | 5 năm; bước D7' (bỏ `after.note` theo mốc D3) áp cả các action mới |
| D15 | bảng lương (`payroll_settings`, `salary_profiles`, `payroll_runs`, `payslips`, `payslip_lines`) + audit `PAYROLL_*` (payroll.md §3, T-048) | **ngoài mọi bước D1–D9 / D7 / D7'** (RD-11): giữ **10 năm** kể từ kỳ lương (`data-retention.md` D15 — chứng từ kế toán). Kể cả `after.note` của audit lương (lý do sửa công / điều chỉnh) — TL chốt 18/10: lý do đó vốn có trên phiếu (`overrideReason`, `revisionReason` — nhân viên xem được) nên giữ theo phiếu; biện pháp giảm là dòng nhắc trong form "Nhân viên sẽ thấy lý do này — không ghi chẩn đoán/bệnh". Ranh giới kỹ thuật: tiền tố action `PAYROLL_` (`action NOT LIKE 'PAYROLL\_%'` ở D7 / D7') |
| — | `leave_policies` | không phải dữ liệu cá nhân; sống cùng công ty |
| — | `leave_balances.carried_over_days` | theo D4 |

(D10 token kích hoạt, D11 tài khoản chờ kích hoạt: `company-level.md`.) Mẫu thông báo xử lý dữ liệu (§5 R27) thêm: hồ sơ nhân sự (4 trường; mục đích lương, phép thâm niên, liên hệ công việc) và đơn bổ sung giờ (không cần ghi bệnh).

## 8. Tác động lên Mốc 4 (`payroll.md` v3.2 — TL sửa trước khi B bắt đầu T-048)

Đã gộp ở `company-level.md` §8 (payroll v3.2): `CompanyGrant.PAYROLL_MANAGE`, Admin không có phiếu lương, bỏ `ws`, **một nguồn `hireDate` = `EmployeeProfile`**, route công ty, nhiệm kỳ `ICompanyTenurePort`, migration 7. Chi tiết `hireDate` (giữ từ v2.1):

1. §0 "Phụ cấp thâm niên": `SalaryProfile.hireDate` (kế toán nhập) ⇒ **`EmployeeProfile.hireDate` (HR nhập)**; vẫn không dùng ngày vào nhiệm kỳ (`start_date`).
2. §1 + §4 bước 1: hồ sơ lương chỉ còn level + lương cơ bản.
3. ADR-124: luật self của payroll bỏ `hireDate` (chuyển sang ADR-128).
4. ADR-125, gạch "Nháp tháng M lấy hireDate của phiên bản hồ sơ hiệu lực cho M…" thay bằng: *nháp đọc `hireDate` qua `payroll/application/ports/hire-date.port.ts` lúc tạo / "Tính lại công" — giá trị hiện hành là giá trị hiệu lực tại ngày cuối kỳ (hồ sơ không phiên bản); `years` vẫn tính tới ngày cuối kỳ; HR đổi `hireDate` khi NHÁP ⇒ việc còn lại "Ngày vào công ty đã đổi — tính lại"; sau PUBLISHED ⇒ cờ "hồ sơ đã thay đổi sau phát hành" (so `Payslip.hireDate` với giá trị hiện hành), kế toán quyết bản điều chỉnh*. Biên `hireDate` chuyển sang contract hồ sơ.
5. Giữ nguyên: ảnh chụp `hireDate`/`seniorityYears`/`seniorityPerYear`/`seniorityAllowance` trên Payslip; thiếu `hireDate` hoặc `hireDate` sau ngày cuối kỳ ⇒ cờ chặn phát hành.
6. §3: `SalaryProfile` bỏ `hireDate` và câu "phiên bản mới điền sẵn hireDate".
7. §5.2: `/payroll/profiles` hiện "Ngày vào công ty" **chỉ đọc** + "HR sửa ở Nhân sự → Nhân viên"; việc còn lại "thiếu ngày vào công ty" link tới `/hr/employees` nếu có `hr:manage`, không thì "Báo HR bổ sung".
8. §6: audit `hireDate` là `PROFILE_SET`.
9. §7 SN: bỏ "sửa tại chỗ bị chặn khi đã có phiếu PUBLISHED" và "nháp lấy hireDate của phiên bản hiệu lực"; thêm "đổi hireDate khi nháp ⇒ cảnh báo tính lại", "đổi sau PUBLISHED ⇒ cờ hồ sơ đổi, phiếu không đổi".
10. §8: T-048, T-049 **phụ thuộc T-054**; T-049 bỏ phần contract/sửa `hireDate`.
11. Khuyến nghị: CSV bảng lương dùng lại `ISpreadsheetWriter` (T-055) ⇒ đóng rủi ro `;` vi-VN của §5.2.

Mốc 3 (`attendance-leave.md`, đã bị Mốc 3.5 thay phạm vi): §1 "Không: đơn điều chỉnh công do nhân viên tự gửi" ⇒ ADR-129; ADR-122 công thức số dư + §9 "không cộng dồn", "người vào giữa năm HR tự chỉnh" ⇒ ADR-131 (đủ phép năm đầu).

## 9. Test (F viết `docs/design/test-spec-hr-extended.md`; tầng như `test-spec-hr.md` §0.1)

Harness: dùng harness công ty của Mốc 3.5 (ADR-140 — `admin:bootstrap`, `Actors.createUser`, đồng hồ neo) + `nextVnDateAnchor('MM-DD', 'HH:mm:ss')` (ngày cố định kế tiếp ở tương lai — đầu tháng, 31/12, hạn E); số dư Y−1 dựng bằng `PATCH leave/balances/:userId/:year` Y−1 (±1 năm). Đọc .xlsx trong test bằng unzip `node:zlib` + parse XML tối thiểu (không thêm thư viện; độc lập với `fflate` của bộ ghi — `test-spec-hr-extended.md` §1.2). File ca: theo bảng kiểm kê `test-spec-hr-extended.md` §11.

- **EP** hồ sơ (A/I/H): EP-01 tạo `expectedVersion 0`, lặp ⇒ 409; EP-02 biên `hireDate` 1949-12-31/1950-01-01/hôm nay/ngày mai; EP-03 chuẩn hóa SĐT, 7 và 16 số ⇒ 400; EP-04 đổi `hireDate` đã có thiếu lý do ⇒ 422; EP-05 người đã nghỉ vẫn sửa được; người chưa từng là nhân viên / Admin chưa từng là nhân viên ⇒ 404; EP-06 audit + thông báo đủ; EP-07 port `hireDates` null khi chưa có hồ sơ; EP-08 (H) `/me`, `/departments` không bị `/:userId` bắt; EP-09 đổi `hireDate` ⇒ `negativeBalances` khớp hàm của `PUT leave/policy`; EP-10 (I) D8: nghỉ 729 ngày giữ, 731 ngày xóa, nhận lại giữ, D8 chạy trước D5; EP-11 `POST hr/employees` mở rộng: có trường hồ sơ ⇒ hồ sơ + nhân viên trong **một** transaction (lỗi ở bước hồ sơ ⇒ không còn gì); không có ⇒ như Mốc 3.5, không tạo hồ sơ; nhận lại `keepHireDate` true/false/không gửi.
- **CR** đơn bổ sung (U luật gửi — Stryker `attendance-domain` ≥ 90 %; A máy trạng thái; I): CR-01..06 mỗi luật 1–6 (luật 1 gồm biên `start_date` của nhiệm kỳ hiện tại); CR-07 bảng chuyển trạng thái đủ ô; CR-08 duyệt tạo đúng 1 ADJUSTMENT, `occurredAt` giống `adjust` cùng tham số; CR-09 duyệt khi đã có lượt cùng loại ⇒ 422; CR-10 replay cùng người + cùng `expectedVersion` ⇒ 200 không lượt mới; HR khác ⇒ 409; CR-11 người gửi nghỉ việc / bị nâng Admin ⇒ 422 `REQUESTER_NOT_EMPLOYEE`, reject vẫn được; CR-12 MISSING_OUT → duyệt → PRESENT, `payrollDaysOf` 0 → 2; CR-13 `Idempotency-Key` replay; CR-14 (I) hoàn tất nghỉ việc ⇒ đơn bổ sung PENDING ⇒ CANCELLED; retention xóa đơn trước lượt chấm.
- **XL** xuất (H/I): XL-01 tên sheet ("Tổng hợp", "Theo ngày", "Giờ vào – ra"; "Số phép", "Đơn đã duyệt"); XL-02 tổng = `totalsOf`/số dư API; XL-03 kiểu số/ngày; XL-04 người đã nghỉ trong kỳ có nhãn, ngày ngoài nhiệm kỳ không tính, ngày ngoài retention "Ngoài thời hạn lưu", Admin không có dòng (trừ nhiệm kỳ EMPLOYEE cũ); XL-05 1 000 × 31: RSS tăng < 100 MB, < 30 s — **chỉ nightly/CI**, không vào cổng local (ADR-107); 1 001 ⇒ 422 trước header, không audit; XL-06 port giả ném lỗi ở lô 2 ⇒ socket bị hủy, `fetch` reject; XL-07 snapshot nhất quán: ghi song song trong lúc xuất không làm lệch tổng; XL-08 kiểm thủ công 1 lần trên Excel vi-VN + LibreOffice (dữ liệu bịa).
- **LP** chính sách & số dư (U Stryker `leave-domain` ≥ 90 % + property test: `entitled ∈ {0, base}`, `base` không giảm theo năm, kiểm số dư không bao giờ cho `remaining < 0`): LP-01 mặc định / kế thừa dòng gần nhất; LP-02 thâm niên tới 31/12/Y (4 năm 364 ngày, 5 năm đúng 31/12 ⇒ +1 ngay năm Y, 29/02); LP-03 **đủ phép năm đầu**: vào 01/01, 20/07, 31/12 của Y ⇒ `base` (12), không tỷ lệ; năm sau đó vẫn `base`; ngày hiệu lực = `max(hireDate, start_date)`; LP-04 không `hireDate`; năm không giao nhiệm kỳ ⇒ 0; LP-05 ghi đè khác NULL thắng; migration: năm hiện tại 12 ⇒ NULL, năm cũ 12 giữ, 14 giữ; (I) tạo lười ⇒ NULL; LP-06 `carried` (tắt ⇒ 0, trần, âm ⇒ 0, không chuyển tiếp lần 2, PENDING Y−1 không trừ); **LP-06b** không liên tục (nghỉ 20/12, nhận lại 05/01; nâng Admin 31/12) ⇒ `carried = 0`; LP-07 `uEarly/uLate` biên E/E+1, E tháng 2 năm nhuận/không nhuận; LP-08 sau E phần chưa dùng mất; LP-09 PATCH Y−1 ⇒ `carried` Y tính lại; LP-09b duyệt muộn đơn Y−1 ⇒ `carried` Y tính lại; LP-10 sửa chính sách năm nay ⇒ `negativeBalances`, đơn đã duyệt không đổi; LP-11 `LEAVE_SPANS_YEARS`; LP-12 GET khi NULL ⇒ `carriedFinal:false`, không ghi; job 01/01 idempotent; **LP-13** nhận lại: nhiệm kỳ trước năm khác ⇒ đủ `base`; cùng năm ⇒ không cấp lại, đơn trước `start_date` không trừ (cùng LB-REHIRE của Mốc 3.5).
- **CC** (×20): CC-HR-20 approve ‖ cancel ‖ reject đơn bổ sung ⇒ 1 thắng, không lượt khi reject/cancel thắng; CC-HR-21 2 HR approve; approve IN ‖ HR thêm IN tay; approve OUT ‖ bấm Ra ⇒ không 2 IN, không 500; CC-HR-22 2 submit cùng (user, ngày, loại) ⇒ 1 PENDING; CC-HR-23 PUT hồ sơ ‖ PUT ⇒ 1 409; CC-HR-24 **2 lệnh ghi đầu năm song song** (submit ‖ PATCH Y−1 ‖ job) ⇒ `carried` một giá trị; CC-HR-25 **PUT policy hạ ‖ approve** ⇒ đơn không vượt cả hai chính sách.
- **CLK** (đồng hồ neo): CLK-HR-10 cửa sổ ngày 1 tháng (tháng trước được, 2 tháng trước 422; gửi 30, duyệt sau khi hết cửa sổ ⇒ 422, reject được); CLK-HR-11 `nextDay` 05:58 ⇒ 422, 06:00 ⇒ hợp lệ; CLK-HR-12 hạn E 23:59:30 → E+1 phần chuyển sang biến mất; CLK-HR-13 31/12 23:59:30 → 01/01: GET `carriedFinal:false` trước job, job chụp; CLK-HR-14 export tháng chưa bắt đầu ⇒ 422, tháng hiện tại ⇒ 200.
- **SEC** SEC-HR-40…55 trừ 44 (§6).
- **E2E**: E2E-HR-20 MISSING_OUT → "Xin bổ sung giờ ra" → HR chuông + "Bổ sung giờ (1)" → Duyệt → nhân viên thấy chuông, ô ngày "Có mặt"; E2E-HR-21 HR sửa hồ sơ ở 360 px, nhân viên xem `/my-profile`; E2E-HR-22 tải 2 file Excel (tên file từ header, content-type, ô tổng); E2E-HR-23 bật cộng dồn → phân rã hiện "chuyển sang"; E2E-HR-24 axe + responsive 360/768/1280 cho tab mới, form đơn, `/my-profile`; `/hr` 7 tab ở 360 không dịch > 8 px (cách đo E2E-HR-14); E2E-HR-25 XSS ở phòng ban/chức vụ/lý do đơn. E2E-HR-14…19 (Mốc 3.5) vẫn xanh.

## 10. Chia việc (sau khi duyệt) và thứ tự với Mốc 4

| Vé | Ai | Nội dung | Phụ thuộc |
|---|---|---|---|
| T-054 | B | ADR-128: migration 6, module `hr-profile` (API §4, thứ tự route, luật self tuyệt đối, audit, `PROFILE_UPDATED`), `profile:self` vào ma trận công ty + parity, **mở rộng** body `POST hr/employees` của Mốc 3.5 bằng trường hồ sơ tùy chọn + `keepHireDate?` (cùng transaction; contract cũ không đổi nghĩa), adapter `hireDates`, trường `negativeBalances` (rỗng tới T-057), retention D8 | Mốc 3.5 trên `main` **(đầu tiên, ~1 ngày; merge TRƯỚC T-048)** |
| — | TL | DECISIONS ADR-128…131 sau duyệt (ADR-132 cũ ghi "chuyển sang ADR-137") | sau duyệt |
| T-048…T-051 | B/A/E/F | Mốc 4 như payroll.md v3.2 (migration 7) | T-054 |
| T-055 | B | Migration 8 (đơn bổ sung + enum), `ISpreadsheetWriter` trên fflate + cổng so 3 phương án + khung route export (header, 422 trước header, `socket.destroy`, limiter chung CSV + 2 đồng thời/công ty, audit khi stream bắt đầu, REPEATABLE READ READ ONLY), `HR_AUDIENCE_TYPES`, retention D9 + D7', threat-model R32–R35, data-retention | T-054 |
| T-056 | A | ADR-129: luật gửi (domain thuần), use case gửi/hủy/duyệt/từ chối, `#appendAdjustment` dùng chung, khóa `attendance:punch:<user>` cho cả `adjust`/void, `Idempotency-Key`, hủy đơn bổ sung PENDING trong `offboardCleanup` của attendance (port của T-062); báo cáo `attendance/export.xlsx` | T-055 |
| T-057 | D | ADR-131: migration 9 (`leave_policies`, đổi nghĩa `leave_balances`) **cùng PR** code đọc NULL; `entitlementOf` theo nhiệm kỳ, khóa policy shared/exclusive (bậc 1), chụp `carried` ở đường ghi + job 01/01 + điều kiện liên tục, kiểm số dư mới, phân rã DTO, `negativeBalances` (hàm thuần chung, nối vào PUT hồ sơ), `ADJUSTMENT_DAYS_REVIEW`; báo cáo `leave/export.xlsx` | T-054, T-055 |
| T-058a/b/c | E | (a) cột hồ sơ ở `/hr/employees` + sửa hồ sơ + 4 trường trong form thêm/nhận lại + `/my-profile`; (b) đơn bổ sung (chi tiết ngày, thẻ MISSING_OUT, form, danh sách, tab HR); (c) chính sách phép + phân rã + 2 nút Excel | a: T-054 · b: T-056 · c: T-057; bắt đầu từ contracts + mock |
| T-059 | F | `test-spec-hr-extended` §9 (EP, CR, XL, LP, SEC-HR-40…55, CC-HR-20…25, CLK-HR-10…14, E2E-HR-20…25), `nextVnDateAnchor`, Stryker `leave-domain` + `attendance-domain` ≥ 90 %, kiểm .xlsx trên Excel vi-VN + LibreOffice | song song; E2E sau từng vé web |

Thứ tự: **Mốc 3.5 → T-054 → T-048 → (T-049 ‖ T-055) → (T-056 ‖ T-057) → web T-050 ‖ T-058**; T-058a ngay sau T-054. Số migration theo thứ tự này; đổi thứ tự thì TL đánh lại số + timestamp lúc merge.

**Ước tính:** Mốc 5 ≈ 4,5–5 ngày làm việc của cả đội (v2.1: 6–6,5; −T-060 ~2 ngày của B, −T-058d ~1 ngày của E — đã sang Mốc 3.5). T-054 ~1 ngày; T-055 ~1,5; A, D ~2 ngày mỗi người song song; đường găng là B (T-054 → T-048 → T-055) và web E ~3 ngày, cộng dồn với web payroll T-050 nếu cùng người. Tùy tải máy (ADR-107).

## 11. Đã chốt (người dùng 17/10)

1. **Phép năm đầu:** người vào giữa năm được **đủ** phép năm (12 ngày; thâm niên chỉ có khi nhận lại người cũ và giữ `hireDate` cũ), không tính tỷ lệ — ADR-131, LP-03.
2. **Thâm niên phép:** tính tới **31/12/Y** — đủ 5 năm trong năm Y ⇒ +1 ngày ngay năm Y — ADR-131, LP-02.
3. **Cửa sổ đơn bổ sung giờ:** tháng này + tháng trước — ADR-129 luật 1, CLK-HR-10.
4. **Cấp công ty** (Mốc 3.5): Admin không phải nhân viên — không hồ sơ "của tôi", không phép, không đơn bổ sung; vào làm/nghỉ việc ở Mốc 3.5.

Không có câu hỏi mới cho người dùng. R27 Q2/Q4/Q5 vẫn mở như trước (trước deploy).

## 12. Cập nhật khi triển khai (TL, 18/10 — gộp `main` 007c82a6)

- ADR-128: ghi chú (a)–(e) của B ở T-054; `hireDate` tương lai ⇒ 422 `HIRE_DATE_IN_FUTURE`, cận dưới 1950 ⇒ 400.
- ADR-130: ô ngày = số serial Excel + định dạng dd/mm/yyyy; audit `EXPORT` ghi {report, period, from?, to?, rows (tổng dòng dữ liệu mọi sheet), format}; tên sheet số dư "Số dư YYYY".
- ADR-131: số truy vấn của trang số dư cố định ≤ 12/trang (T-057d); job chụp `carried` có jitter 5 s.
