# Đặc tả test — Mốc 5 "HR mở rộng" (T-059)

> **Căn cứ:** `docs/design/hr-extended.md` v3 (main `c578622`, ADR-128…131, §4 API, §6 SEC, §9 test), `test-spec-company.md` (Mốc 3.5, harness ADR-140), `test-spec-hr.md` (Mốc 3).
> **Chủ:** F (QA độc lập).
> **Trạng thái:** đặc tả + harness (`nextVnDateAnchor`, bộ đọc .xlsx). Chưa có ca S/C/K/E — viết khi từng vé vào `feat/m5-hr` (TL báo).
> **Nhánh:** `test/T-059-*` từ `feat/m5-hr`, merge vào `feat/m5-hr`.
>
> Dữ liệu ví dụ là bịa. Mã lỗi theo `test-spec-hr.md` §0.2b:
> - 409 `RESOURCE_CONFLICT` + `details.reason` viết thường;
> - 422 `BUSINESS_RULE_VIOLATION` + `details.rule` viết HOA.
>
> Ca kiểm cả `code` lẫn `details`, không chỉ status.

## 0. Quy ước

### 0.1 Tầng

Như `test-spec-company.md` §0.1: **U** hàm thuần · **A** use case + fake · **I** Postgres thật · **H** HTTP in-process (supertest) · **S** hộp đen bảo mật (mỗi file một process API + DB) · **C** đua hộp đen ×20 · **K** đồng hồ neo (process riêng) · **E** Playwright · **M** Stryker.

**Ai viết** (bài học Mốc 3.5 — ca hộp đen do người **không** viết module viết, F duyệt cuối):

| Tầng | Người viết | Duyệt |
|---|---|---|
| U / A / I / H | tác giả vé (B T-054/T-055, A T-056, D T-057) | F kiểm phủ theo bảng mã ca + Stryker |
| S / C / K | **F** (không là tác giả module nào của Mốc 5) | người không viết module đó — cột "Duyệt" ở §9 |
| E | **H** (TL 18/10 — giảm tải F) | **F soát cuối**, E (selector), TL |
| M | F, chỉ khi TL báo "máy rảnh" | — |

### 0.2 Bối cảnh chuẩn

Như `test-spec-company.md` §0.2: **Ada** Admin (bootstrap) · **Hana** nhân viên + `HR_MANAGE` · **Hugo** nhân viên + `HR_MANAGE` (HR thứ hai — duyệt đơn của Hana, ca self) · **Kay** nhân viên + `PAYROLL_MANAGE` · **Mia**, **Max** nhân viên · **Quinn** đã nghỉ. Mọi ca tự tạo người (`actors.createUser`), tên có hậu tố duy nhất.

### 0.3 Thứ tự lỗi (ADR-135, hr-extended §4)

1. 401 / 401 `SESSION_REVOKED`;
2. 403 — `permit` chạy TRƯỚC validate (body sai vẫn 403); luật self tuyệt đối (HR tự sửa hồ sơ / tự duyệt đơn) cũng là 403;
3. 400 (Zod `.strict()` — trường lạ ⇒ 400);
4. 404 tài nguyên con (`user` chưa từng có nhiệm kỳ EMPLOYEE; đơn của người khác với nhân viên thường);
5. 422 / 409.

### 0.4 Cách ly (ADR-140)

Như `test-spec-company.md` §0.4, thêm:

- **Chính sách phép là của cả công ty** (`LeavePolicy` PK `year`) ⇒ ca `PUT leave/policy` ở file riêng `hr-leave-policy.sec.ts` (DB riêng mỗi file). **E2E cấm** sửa chính sách năm hiện tại; E2E-HR-23 chỉ sửa **năm sau** và khôi phục ở `afterAll`.
- **Export đọc cả công ty** ⇒ ca khẳng định dòng của người do chính ca tạo (tìm theo tên), không khẳng định tổng số dòng; ca giới hạn kích thước dùng env test-only (§1.3).
- **Hạn mức export chung CSV** (20/giờ/user + 2 đồng thời/công ty) ⇒ ca 429 ở file riêng (`hr-export-limits.sec.ts`), người gọi mới mỗi ca.
- **Thông báo:** delta lọc `refId` (id đơn bổ sung / user hồ sơ).

## 1. Harness

### 1.1 Đồng hồ theo ngày — `harness/clock.ts` (đã có, 55 ca `*.test.ts`)

- `nextVnDateAnchor(day, 'HH:mm:ss', { tz?, from? })` — lần đầu tiên `day` xuất hiện từ hôm nay + 2 (theo `tz`, mặc định VN):
  - `'MM-DD'` (`'12-31'`; `'02-29'` ⇒ năm nhuận kế tiếp);
  - `'*-DD'` (`'*-01'` = đầu tháng kế tiếp);
  - `'MM-L'` / `'*-L'` = ngày cuối tháng (hạn E của cộng dồn: `'03-L'`, `'02-L'` theo năm nhuận).
- `localToIso(date, hms, tz)` — giờ địa phương ⇒ ISO; giờ rơi vào khe đổi giờ ⇒ ném lỗi.
- `dateInTz(iso, tz)`, `daysInMonth(y, m)`.
- **Năm Y−1** (LP-06…09, CLK-HR-12/13): dựng bằng `api.restart` với mốc **trong Y−1** rồi mốc **trong Y** (chính sách Y−1 chỉ sửa được khi Y−1 là "năm nay" — `POLICY_YEAR_LOCKED`). Mọi mốc phải ≥ hôm nay + 2 ⇒ chọn Y theo `nextVnDateAnchor('03-L', …)` năm sau, mốc đầu `${Y−1}-12-15`; nếu mốc đầu < hôm nay + 2 thì lùi sang năm kế tiếp. Số dư Y−1 dựng bằng `PATCH leave/balances/:userId/:year`.

### 1.2 Đọc .xlsx — `harness/xlsx.ts` (đã có)

Bộ đọc **độc lập** với bộ ghi của API: unzip bằng `node:zlib` (central directory, data descriptor, ZIP64) + parse XML tối thiểu. Lệch so với hr-extended §9 ("đọc bằng `fflate`"): `fflate` chưa có trong lockfile (B thêm ở T-055), và đọc bằng chính thư viện của bộ ghi sẽ che lỗi của nó. Không thêm thư viện.

| Hàm | Dùng cho |
|---|---|
| `download(api, token, path)` | GET nhị phân, trả `{status, headers, body, json, aborted}`; `aborted` = server cắt giữa chừng (XL-06) |
| `expectXlsxHeaders(res, /^bang-cong-\d{4}-\d{2}\.xlsx$/)` | content-type, `Content-Disposition` `attachment; filename="…"`, `no-store`, `nosniff`, `Access-Control-Expose-Headers` |
| `readXlsx(buf)` | `names` (thứ tự entry), `sheets[]` (`name`, `state`, `rows`, `cell('A1')` ⇒ `{type, value, style: {numFmtId, formatCode, quotePrefix}, hasFormula}`), `core` (`docProps/core.xml`) |
| `parseXml` | ném lỗi khi XML hỏng, thẻ lệch, `&` trần, ký tự cấm XML 1.0 (kể cả `&#1;`), DTD/ENTITY ⇒ "file mở được" ở mức cấu trúc |
| `workbookViolations(wb)` / `expectSafeWorkbook(wb)` | bất biến ADR-130: không `<f>`, không hyperlink, không `sharedStrings`, chỉ `t="inlineStr"` / số, ô bắt đầu `= + - @ TAB CR` có `quotePrefix`, không thêm `'`, không `app.xml` / `lastModifiedBy` / `Company` / `Manager`, không sheet ẩn, `definedNames`, macro, `externalLinks`, quan hệ `External` |
| `isDateFormat`, `serialToIso` | XL-03 kiểu ngày (serial hệ 1900 + style ngày) |

**Mọi** ca tải file (S, K, E) gọi `expectSafeWorkbook` — không chỉ SEC-HR-53/54.

### 1.3 Env test-only cần từ tác giả (chỉ nhận khi `APP_ENV=test`, như ADR-141 của Mốc 6)

| Env | Ai (vé) | Vì sao |
|---|---|---|
| `EXPORT_MAX_EMPLOYEES`, `EXPORT_MAX_LEAVE_ROWS` | B (T-055) — **nhận 18/10** (số nguyên dương; mặc định 1 000 / 20 000) | XL-05 vế 422: dựng 1 001 người ở local quá nặng ⇒ hạ trần còn 3 / 5 |
| `EXPORT_BATCH_SIZE`, `EXPORT_BATCH_DELAY_MS` | B (T-055) — **nhận 18/10** (delay 0..5 000 ms, chèn GIỮA hai lô đọc, trong transaction REPEATABLE READ; mặc định 0) | giữ export "đang chạy" đủ lâu, hộp đen: export thứ 3 đồng thời ⇒ 429 (SEC-HR-54), ghi song song trong lúc xuất (XL-07) |
| `LEAVE_CARRYOVER_ON_START=1` (một lượt trước `/readyz`, log `maintenance.run_done {job: 'leave-carryover', durationMs}` như mọi job — `MaintenanceScheduler.runNow`; số người chụp `snapshotted` ở log tóm tắt riêng của job; lỗi ⇒ `maintenance.run_failed`), `LEAVE_CARRYOVER_INTERVAL_MS` (≥ 1000) — **D nhận 18/10** | D (T-057) | CLK-HR-13, CC-HR-24. Job `leave-carryover` **luôn đăng ký** (cả test): mỗi 1 giờ + jitter ≤ 5 phút, lượt đầu 5–10 s sau start, chụp năm hiện tại cho nhân viên đang làm còn NULL ⇒ ca S nào cần `carriedFinal:false` (LP-12) phải tạo người **sau** lượt đầu (chờ log `maintenance.run_done` job `leave-carryover`) |

Chưa có env ⇒ ca khai pending theo vé, không bỏ.

### 1.4 Helper khác (viết cùng ca)

- `HR` (harness/hr.ts) thêm route §4: `profiles`, `profile(userId)`, `myProfile`, `departments`, `corrections`, `correctionAction(id, 'cancel'|'approve'|'reject')`, `exportXlsx(month)`, `leaveExportXlsx(year, from?, to?)`, `policy(year)`, `balances(year)`.
- `submitCorrection(actors, who, {date, kind, time, nextDay?, reason}, key?)` — luôn kèm `Idempotency-Key` (mặc định UUID mới).
- `missingOutDay(actors, who, date)` — dựng ngày MISSING_OUT bằng HR `adjust` IN (không chờ đồng hồ).

## 2. EP — hồ sơ nhân viên (ADR-128)

| Mã | Tầng | Ca | Mong đợi |
|---|---|---|---|
| EP-01 | A + S | `PUT` lần đầu `expectedVersion 0` ⇒ tạo; gửi lại `expectedVersion 0` | 200 `version 1`; 409 `VERSION_CONFLICT` |
| EP-02 | A + S | `hireDate` 1949-12-31 / 1950-01-01 / hôm nay (businessClock) / ngày mai; sai mẫu, 30/02 | 400 / 200 / 200 / **422 `HIRE_DATE_IN_FUTURE`** (B T-054 — cận trên phụ thuộc giờ nghiệp vụ, như `START_DATE_OUT_OF_RANGE`) / 400 |
| EP-03 | U + S | `workPhone` `"+84 (90) 123-4567"` ⇒ lưu `+84901234567`; 7 số; 16 số; chữ cái | 200 chuẩn hóa; 400; 400; 400 |
| EP-04 | A + S | đổi `hireDate` **đã có** không `reason`; có `reason`; đặt `hireDate` lần đầu không `reason` | 422 `REASON_REQUIRED`; 200; 200 |
| EP-05 | S | Quinn (đã nghỉ) ⇒ HR `GET`/`PUT` được; user chưa từng là nhân viên / Ada (Admin chưa từng là nhân viên) | 200; 404 `user` (= SEC-HR-43) |
| EP-06 | A + S | audit `PROFILE_SET` (before/after, `workPhoneChanged`, lý do ở `after.note`) + đúng 1 thông báo `PROFILE_UPDATED` cho nhân viên (delta `refId`) | đúng |
| EP-07 | I | port `hireDates({userIds})`: chưa có hồ sơ ⇒ `null`; có ⇒ ngày; id lạ ⇒ không có khóa | đúng |
| EP-08 | H + S | `/me`, `/departments` khai báo trước `/:userId` (không bị bắt thành `userId = "me"`); vế S gộp vào SEC-HR-41 | đúng |
| EP-09 | A + S | đổi `hireDate` làm mất thâm niên của người đã dùng phép ⇒ `negativeBalances` = kết quả hàm thuần dùng chung với `PUT leave/policy` (so cùng dữ liệu cả hai đường) | khớp |
| EP-10 | I | retention D8: đã nghỉ 729 ngày giữ, 731 ngày xóa; nhận lại ⇒ giữ; D8 chạy **trước** D5 | đúng |
| EP-11 | A + I + S | `POST hr/employees` có trường hồ sơ ⇒ hồ sơ + nhân viên **một** transaction (lỗi ở bước hồ sơ — A: fake ném; S: `workPhone` 7 số ⇒ 400 trước khi tạo) ⇒ không còn user / membership; không trường hồ sơ ⇒ như Mốc 3.5, không hồ sơ; nhận lại `keepHireDate` true (giữ) / false + `hireDate` mới (thay) / không gửi (giữ nguyên), audit `after.rehire = true` | đúng |
| EP-12 | A + S | nhập `hireDate` năm nay cho người có `adjustmentDays < 0` ⇒ `warnings: ['ADJUSTMENT_DAYS_REVIEW']`; `adjustmentDays ≥ 0` ⇒ `warnings: []` | đúng |
| EP-13 | S | danh sách là `GET hr/employees` (B T-054 — không có `GET hr/employee-profiles?q`): cột phẳng `hireDate`, `department`, `jobTitle`, `missingHireDate`, `seniority` (năm / tháng), **không** `workPhone` | đúng |

## 3. CR — đơn bổ sung giờ (ADR-129)

Luật gửi là hàm thuần ở `attendance/domain` ⇒ U (Stryker `attendance-domain` ≥ 90 %); máy trạng thái A; khóa / unique I; hộp đen S.

| Mã | Tầng | Ca | Mong đợi |
|---|---|---|---|
| CR-01 | U + S | luật 1: hôm nay / ngày 1 tháng trước được; ngày cuối tháng **trước nữa** 422; trước `start_date` của nhiệm kỳ hiện tại (biên `start_date` / `start_date − 1`); ngoài retention | 201 / 422 `CORRECTION_DATE_OUT_OF_RANGE` / `OUTSIDE_RETENTION` |
| CR-02 | U + S | luật 2: giờ xin > bây giờ (cả `nextDay`) | 422 `CORRECTION_IN_FUTURE` |
| CR-03 | U + S | luật 3: đã có IN hợp lệ ⇒ xin IN; đã có OUT sau `firstIn` ⇒ xin OUT; IN đã **hủy** (void) ⇒ xin IN được | 422 `CORRECTION_EVENT_EXISTS` ×2; 201 |
| CR-04 | U + S | luật 4: OUT ≤ `firstIn`; IN ≥ `lastOut`; xin OUT khi chưa có IN ⇒ 422 `CORRECTION_TIME_ORDER`. Contract (A 18/10): `nextDay` chỉ hợp lệ khi `kind = OUT` và `time < "06:00"` ⇒ OUT 06:00 / 07:00 `nextDay` và IN `nextDay` ⇒ **400** `VALIDATION_ERROR` path `['nextDay']`; OUT 05:59 `nextDay` ⇒ 201 (gửi sau 05:59 hôm sau) | 422 / 400 / 201 |
| CR-05 | U + S | luật 5: phép cả ngày đã duyệt ⇒ 422 `CORRECTION_DAY_ON_LEAVE`; nửa ngày, ngày lễ, Chủ nhật ⇒ 201 | đúng |
| CR-06 | I + S | luật 6: PENDING cùng (user, ngày, loại) ⇒ 409 `correction_pending_exists`; khác loại cùng ngày ⇒ 201; sau CANCELLED/REJECTED gửi lại ⇒ 201 | đúng |
| CR-07 | A | bảng chuyển trạng thái đủ ô 4×4 × (người gửi / HR khác / HR = người gửi) — ô không có trong ADR-129 ⇒ 409 `invalid_transition` (hoặc 403 cho self) | đúng |
| CR-08 | A + S | duyệt tạo **đúng 1** ADJUSTMENT; `occurredAt` bằng `adjust` cùng (ngày, giờ, `nextDay`); `note` = "Đơn bổ sung giờ" + id, **không** chép lý do; audit `CORRECTION_DECIDE` + `EVENT_ADJUST`; thông báo `CORRECTION_APPROVED` (không `ATTENDANCE_ADJUSTED`) | đúng |
| CR-09 | A + S | gửi lúc chưa có lượt; HR thêm tay IN; duyệt đơn IN | 422 `CORRECTION_EVENT_EXISTS` (kiểm lại luật trong khóa) |
| CR-10 | A + S | duyệt lặp: cùng HR + cùng `expectedVersion` ⇒ 200 trạng thái hiện tại, không lượt mới; HR khác ⇒ 409 `invalid_transition`; `expectedVersion` cũ của HR khác khi còn PENDING ⇒ 409 `VERSION_CONFLICT` | đúng |
| CR-11 | A + S | người gửi nghỉ việc (hoàn tất) / bị nâng Admin rồi mới duyệt ⇒ 422 `REQUESTER_NOT_EMPLOYEE`; `reject` vẫn 200 | đúng |
| CR-12 | S | ngày MISSING_OUT ⇒ đơn OUT ⇒ duyệt ⇒ `attendance/me?month` ngày thành PRESENT; `payrollDaysOf` của ngày 0 ⇒ 2 (nửa ngày) | đúng |
| CR-13 | I + S | `Idempotency-Key` lặp cùng body ⇒ cùng đơn (201/200, 1 dòng); cùng key body khác ⇒ 422 `IDEMPOTENCY_KEY_REUSED`; thiếu header ⇒ 400 | đúng |
| CR-14 | I | hoàn tất nghỉ việc ⇒ đơn PENDING ⇒ CANCELLED (port `offboardCleanup` của attendance, cùng transaction); retention D9 xóa đơn **trước** lượt chấm (FK NO ACTION không vỡ); `reason` / `decision_note` ⇒ NULL sau 13 tháng trừ PENDING | đúng |
| CR-15 | S | nhân viên `GET attendance/corrections?mine=1` chỉ thấy đơn của mình; HR `GET …?status=PENDING` kèm `firstIn`, `lastOut`, trạng thái ngày | đúng |

## 4. XL — xuất .xlsx (ADR-130)

Mọi ca tải: `expectXlsxHeaders` + `readXlsx` + `expectSafeWorkbook`.

| Mã | Tầng | Ca | Mong đợi |
|---|---|---|---|
| XL-01 | S | `attendance/export.xlsx` có sheet "Tổng hợp", "Theo ngày", "Giờ vào – ra" (đúng thứ tự); `leave/export.xlsx` có "Số dư YYYY", "Đơn đã duyệt" (TL chấp nhận tên của D, 18/10) | đúng |
| XL-02 | S | dòng của Mia: tổng công = `totalsOf` qua `attendance?month`; số phép = `leave/balances?year` (`entitled`, `used`, `remaining`…) | khớp từng số |
| XL-03 | S | ô số là số (`t` vắng, `value` number), ô ngày là serial + style ngày (`isDateFormat`), ô chữ `inlineStr` — **TL chốt 18/10:** ngày là ngày thật (serial + numFmt dd/mm/yyyy); D thêm kiểu ngày vào writer, A và D dùng; ca khẳng định khi có | đúng |
| XL-04 | S | Quinn nghỉ giữa kỳ: có nhãn "đã nghỉ", ngày sau `lastDay` không tính; ngày ngoài retention "Ngoài thời hạn lưu"; Ada không có dòng; Admin từng là nhân viên ⇒ chỉ ngày thuộc nhiệm kỳ EMPLOYEE cũ | đúng |
| XL-05 | S (nightly/CI) + S (local) | **nightly** (`SEC_NIGHTLY=1`, không vào cổng local — ADR-107): 1 000 người × 31 ngày, RSS API tăng < 100 MB, < 30 s. **Local**: `EXPORT_MAX_EMPLOYEES=3` ⇒ người thứ 4 ⇒ 422 `EXPORT_TOO_LARGE`, **không header xlsx**, không audit `EXPORT`, có log; tương tự `EXPORT_MAX_LEAVE_ROWS` cho báo cáo phép | đúng |
| XL-06 | H (B) | port đọc giả ném lỗi ở lô 2 ⇒ `res.socket.destroy()`, client nhận kết nối bị cắt (`download().aborted`), không `end()`; audit `EXPORT` đã ghi | đúng |
| XL-07 | S | `EXPORT_BATCH_SIZE=1`, `EXPORT_BATCH_DELAY_MS=300`: trong lúc xuất, HR thêm/hủy lượt của người ở lô sau ⇒ tổng trong file = trạng thái lúc bắt đầu (REPEATABLE READ) | đúng |
| XL-08 | thủ công (F, 1 lần) | file bịa mở trên Excel vi-VN + LibreOffice: không cảnh báo sửa file, dấu tiếng Việt đúng, ngày dd/mm/yyyy, ô `=…` hiện nguyên văn, lưu lại thành CSV không thành công thức. Ghi kết quả + ảnh chụp (dữ liệu bịa) vào `docs/reviews/T-059-xlsx-manual.md` | đạt |
| XL-09 | S | `leave/export.xlsx?year&from&to`: `from > to` ⇒ 400; vắt năm ⇒ 400; mặc định cả năm; tên file `nghi-phep-YYYY.xlsx` | đúng |
| XL-10 | S | audit `EXPORT` đúng 1 dòng / lần tải thành công, `after = {report, period, from?, to?, rows, format: 'xlsx'}` — báo cáo phép `{report:'LEAVE_YEAR', period:'YYYY', from, to, rows, format:'xlsx'}` (TL chốt 18/10); 400/422/429 không audit | đúng |

## 5. LP — chính sách & số dư phép (ADR-131)

U: `entitlementOf`, `carried`, kiểm số dư, hạn E — Stryker `leave-domain` ≥ 90 % + **property test** (D, vòng lặp sinh dữ liệu có seed — không thêm thư viện): `entitled ∈ {0, base}`; `base` không giảm khi Y tăng; kiểm số dư hợp lệ ⇒ `remaining ≥ 0`; `carried ≤ carryOverMaxDays(Y−1)`; mọi số là bội 0,5.

| Mã | Tầng | Ca | Mong đợi |
|---|---|---|---|
| LP-01 | U + S | năm chưa có dòng ⇒ dòng gần nhất trước đó; không có dòng nào ⇒ mặc định luật (12 / 5 / 1 / tắt / 0 / 3) | đúng |
| LP-02 | U | thâm niên tới 31/12/Y: 4 năm 364 ngày ⇒ +0; đủ 5 năm đúng 31/12/Y ⇒ +1 ngay năm Y; `hireDate` 29/02 | đúng |
| LP-03 | U + S | **đủ phép năm đầu**: vào 01/01, 20/07, 31/12 của Y ⇒ `base` (12), không tỷ lệ; năm sau vẫn `base`; ngày hiệu lực = `max(hireDate, start_date)` | đúng |
| LP-04 | U + S | không `hireDate` ⇒ `annualDays` + cờ thiếu; năm Y không giao nhiệm kỳ ⇒ 0; hiệu lực sau 31/12/Y ⇒ 0 | đúng |
| LP-05 | U + I | `entitledDays` khác NULL thắng; migration 9: năm hiện tại 12 ⇒ NULL, năm cũ 12 giữ, 14 giữ, in số dòng khác 12; tạo lười ⇒ NULL | đúng |
| LP-06 | U + S | `carried`: tắt ⇒ 0; trần `carryOverMaxDays`; còn lại âm ⇒ 0; không chuyển tiếp lần 2; PENDING Y−1 không trừ | đúng |
| LP-06b | U + K | không liên tục: nghỉ 20/12 nhận lại 05/01; nâng Admin 31/12 ⇒ `carried = 0` | đúng |
| LP-07 | U + K | `uEarly`/`uLate` biên E / E+1; E tháng 2 năm nhuận / không nhuận | đúng |
| LP-08 | U + K | sau E phần chuyển sang chưa dùng mất (`carriedUsable = 0`, `remaining` giảm đúng) | đúng |
| LP-09 | A + S | PATCH `adjustmentDays` Y−1 sau khi đã chụp ⇒ `carried(Y)` tính lại | đúng |
| LP-09b | A + S | đơn Y−1 PENDING từ tháng 12, duyệt trong tháng 1 ⇒ `carried(Y)` tính lại | đúng |
| LP-10 | A + S | hạ chính sách năm nay ⇒ `negativeBalances` có người đã dùng nhiều; đơn đã duyệt không đổi trạng thái | đúng |
| LP-11 | S | đơn vắt 2 năm ⇒ 422 `LEAVE_SPANS_YEARS` (giữ Mốc 3) | đúng |
| LP-12 | A + S | GET khi `carried_over_days` NULL ⇒ tính tạm, `carriedFinal: false`, **không ghi** (GET lần 2 vẫn false); job chạy 2 lần (restart `LEAVE_CARRYOVER_ON_START=1` ×2) ⇒ giá trị không đổi, `snapshotted` (log tóm tắt của job) lần 2 = 0. Người tạo sau lượt đầu của job (§1.3) | đúng |
| LP-13 | U + S | nhận lại: nhiệm kỳ trước ở năm khác ⇒ đủ `base` năm Y; cùng năm Y ⇒ không cấp lại, đơn trước `start_date` hiện tại không trừ, `adjustmentDays` về 0 (audit `BALANCE_ADJUST`) | đúng |
| LP-14 | S | phân rã DTO `leave/balances/me`: `base`, `seniorityBonus`, `seniorityYears`, `entitled`, `adjustment`, `carriedOver`, `carriedFinal`, `carriedExpiresOn`, `carriedUsable`, `used`, `pending`, `remaining` + trường cũ; công thức "Còn" = §5 thiết kế | đúng |

## 6. SEC — hộp đen bảo mật (tầng S, hr-extended §6)

| Mã | Ca | Mong đợi | File |
|---|---|---|---|
| SEC-HR-40 | Mia: `GET`/`PUT hr/employee-profiles/:other` (body sai), `POST attendance/corrections/:id/approve` (body sai), `PUT leave/policy/:year` (body sai) | 403 (không 400) | profile / corrections / policy |
| SEC-HR-41 | `hr/employee-profiles/me`: đúng người, có `workPhone` của mình; Ada ⇒ 403; người đã nghỉ (hoàn tất trong request ⇒ phiên bị thu hồi) ⇒ 401 `UNAUTHORIZED` (khe trước job ⇒ `SESSION_REVOKED` — company-clock-0559) | đúng | profile |
| SEC-HR-42 | Hana sửa hồ sơ chính mình ⇒ 403; Ada sửa hồ sơ Hana ⇒ 200; Hugo sửa hồ sơ Hana ⇒ 200 | đúng | profile |
| SEC-HR-43 | `GET`/`PUT hr/employee-profiles/:userId` với user chưa từng là nhân viên, Ada, UUID ngẫu nhiên | 404 `user` (body giống nhau) | profile |
| SEC-HR-45 | mass assignment: `PUT` hồ sơ có `userId` / `version` / `updatedById`; `POST attendance/corrections` có `userId` / `status` | 400 strict | profile / corrections |
| SEC-HR-46 | `GET hr/employees?q=` = `%`, `_`, `\` khớp chữ thường (lọc `includes` trong bộ nhớ — không LIKE; chỉ người có ký tự đó trong tên / email, không cả danh sách); `q` 101 ký tự ⇒ 400 | đúng; 400 | profile |
| SEC-HR-47 | audit `PROFILE_SET` không có `workPhone` (cả before/after), không khóa `reason`; thông báo không có giá trị hồ sơ; log API không có SĐT | đúng | profile |
| SEC-HR-48 | IDOR: Max hủy / xem đơn của Mia ⇒ 404; Max gọi danh sách HR ⇒ 403 | đúng | corrections |
| SEC-HR-49 | Hana tự duyệt / từ chối đơn của mình ⇒ 403; Hugo mở đơn, bị thu `HR_MANAGE` rồi duyệt ⇒ 403, không lượt ADJUSTMENT | đúng | corrections |
| SEC-HR-50 | thu grant của Hugo ⇒ thông báo `CORRECTION_SUBMITTED` / `CANCELLED` biến mất khỏi chuông Hugo; Hana gửi đơn ⇒ Hana không nhận thông báo đơn của chính mình, Hugo + Ada nhận | đúng | corrections |
| SEC-HR-51 | lý do đơn (chuỗi đánh dấu duy nhất) không có trong thông báo, audit, log API, `note` lượt chấm, file xuất; gửi đơn lần 21 trong giờ ⇒ 429 | đúng | corrections |
| SEC-HR-52 | Mia gọi 2 export ⇒ 403; `month` = `2026-13`, `2026-1`, `../x`, `%0d%0a`, 10 KB ⇒ 400; header (`expectXlsxHeaders`), tên file `^bang-cong-\d{4}-\d{2}\.xlsx$` / `^nghi-phep-\d{4}\.xlsx$` không chứa tên người / công ty | đúng | export |
| SEC-HR-53 | phòng ban / chức vụ / tên = `=HYPERLINK("http://x","y")`, `+1`, `-1+1`, `@SUM(A1)`, `\t=1`, `\r=1`, `=cmd\|' /C calc'!A0`, `http://…`, U+0001, emoji ⇒ không `<f>`, không hyperlink, giá trị nguyên văn không `'`, có `quotePrefix`; U+0001 ⇒ U+FFFD; `readXlsx` đọc được | đúng | export |
| SEC-HR-54 | file không có IP/UA, lý do nghỉ, ghi chú quyết định, lý do đơn bổ sung, SĐT (chuỗi đánh dấu, tìm trong mọi entry đã giải nén); không `docProps/app.xml`, `lastModifiedBy`, `Company`, `Manager`, sheet ẩn, `definedNames`; `creator = "TaskFlow"`; lần 21 trong giờ (gộp CSV + xlsx) ⇒ 429; export thứ 3 đồng thời trong công ty (`EXPORT_BATCH_DELAY_MS`) ⇒ 429; 429 không audit | đúng | export / export-limits |
| SEC-HR-55 | `PUT leave/policy/<năm qua>` ⇒ 422 `POLICY_YEAR_LOCKED`; năm sau + 1 ⇒ 422; dưới luật (`annualDays` 11, `seniorityStepYears` 6, `seniorityBonusDays` 0,5, bước 0,25) ⇒ 400; `leave/balances/me` chỉ của mình; Ada gọi `leave/balances/me` ⇒ 403 | đúng | policy |

(SEC-HR-44 bỏ — một công ty. SEC-HR-56…70 ở `test-spec-company.md`.)

## 7. CC — đua (tầng C, ×20, gom vòng đỏ, `SEC_HR_RACE_RUNS`)

| Mã | Ca | Mong đợi |
|---|---|---|
| CC-HR-20 | approve (Hugo) ‖ cancel (người gửi) ‖ reject (Ada) cùng đơn | đúng 1 thắng (200), còn lại 409; reject/cancel thắng ⇒ không lượt ADJUSTMENT; approve thắng ⇒ đúng 1 lượt |
| CC-HR-21 | (a) Hugo approve ‖ Ada approve; (b) approve đơn IN ‖ HR `adjust` IN tay; (c) approve đơn OUT ‖ nhân viên bấm Ra | không bao giờ 2 IN / 2 OUT hợp lệ, không 500; (a) bên thua 409; (b) bên thua 422 `CORRECTION_EVENT_EXISTS` (approve) hoặc lỗi trùng IN của `adjust`; (c) — A 18/10 — approve thắng ⇒ bấm Ra **vẫn 201** (OUT lặp hợp lệ, `lastOut` = OUT muộn nhất); bấm Ra thắng ⇒ approve 422 `CORRECTION_EVENT_EXISTS`, đơn còn PENDING, reject được. Bất biến mọi vòng: ADJUSTMENT ≤ 1, không 2 IN hợp lệ, không 500 |
| CC-HR-22 | 2 submit cùng (user, ngày, loại), **khác** `Idempotency-Key` | đúng 1 PENDING (201), bên kia 409 `correction_pending_exists` |
| CC-HR-22b | 2 submit cùng `Idempotency-Key` cùng body | cùng 1 đơn, 1 dòng DB (kiểm qua `?mine=1`) |
| CC-HR-23 | Hugo `PUT` hồ sơ ‖ Ada `PUT` hồ sơ, cùng `expectedVersion` | đúng 1 × 200, 1 × 409 `VERSION_CONFLICT`; audit 1 dòng |
| CC-HR-24 | đầu năm Y (mốc 01/01 sau 00:00, trước job): submit Y ‖ PATCH Y−1 ‖ GET ‖ job (`LEAVE_CARRYOVER_INTERVAL_MS=1000`) | `carried(Y)` cuối cùng một giá trị = hàm thuần trên dữ liệu cuối; không 500 |
| CC-HR-25 | `PUT leave/policy` hạ `annualDays` ‖ approve đơn dùng gần hết phép | đơn không vượt **cả hai** chính sách: approve thắng ⇒ có trong `negativeBalances` của PUT; PUT thắng ⇒ approve 422 `INSUFFICIENT_BALANCE` nếu vượt |

CC-HR-24 / 25 cần chính sách riêng ⇒ file `hr-extended-races-policy.sec.ts` (K, mốc đầu năm); CC-HR-20…23 ở `hr-extended-races.sec.ts`.

## 8. CLK — đồng hồ neo (tầng K, mỗi file một process / mốc)

| Mã | Mốc | Ca | Mong đợi |
|---|---|---|---|
| CLK-HR-10 | `'*-L'` 23:59:30 (cuối tháng M) | nhân viên `startDate` −31 (vào ngày cuối tháng M−1 hoặc sớm hơn); gửi đơn cho ngày trong M−1 ⇒ 201; chờ server qua 00:00 ⇒ duyệt ⇒ 422 `CORRECTION_DATE_OUT_OF_RANGE`, reject ⇒ 200; gửi đơn mới cho cùng ngày ⇒ 422 | đúng |
| CLK-HR-11 | thứ Tư 05:58:30 (`nextVnAnchor`) | đơn OUT `nextDay` 05:59 cho hôm qua (thứ Ba MISSING_OUT) ⇒ 422 `CORRECTION_IN_FUTURE`; chờ ≥ 06:00:00 ⇒ gửi lại (key mới) ⇒ 201 | đúng |
| CLK-HR-12 | `'03-L'` 23:59:30 năm Y (dựng Y−1 qua restart §1.1) | `carriedUsable > 0` trước 00:00; sau 00:00 (E+1) ⇒ `carriedUsable = 0`, `remaining` giảm đúng phần chưa dùng; đơn ANNUAL ngày E+1 dùng phần chuyển sang ⇒ 422 `INSUFFICIENT_BALANCE` nếu vượt `B` | đúng |
| CLK-HR-13 | `'12-31'` 23:59:30 | sau 00:00, trước job: GET Y ⇒ `carriedFinal: false` (GET lặp không ghi); interval mặc định (1 giờ — lượt đầu 5–10 s sau start rơi vào 23:59:3x, chụp năm Y−1, không chạm Y); restart `LEAVE_CARRYOVER_ON_START=1` ⇒ `carriedFinal: true`, cùng giá trị | đúng |
| CLK-HR-14 | `'*-L'` 23:59:30 | export tháng M+1 ⇒ 422 `PERIOD_NOT_STARTED`; sau 00:00 cùng tham số ⇒ 200 (tháng hiện tại) | đúng |

CLK-HR-10 và 14 cùng mốc ⇒ chung file `hr-extended-clock-month.sec.ts`.

## 9. E2E — `E2E-HR-*` (tầng E, `workers: 1`, `@main` cho 21 + 24)

Selector theo E (T-058a/b, TL chuyển 17/10). Mỗi ca tự tạo người qua API; thông báo theo delta.

| Mã | Ca | Selector chính |
|---|---|---|
| E2E-HR-20 | MISSING_OUT (HR `adjust` IN qua API) ⇒ nhân viên mở ngày ⇒ "Xin bổ sung giờ ra" ⇒ "Giờ ra", "Lý do" ⇒ "Gửi đơn" ⇒ toast "Đã gửi đơn — chờ bộ phận nhân sự duyệt" (ô trong hộp ngày: "Đã gửi đơn (…) — chờ duyệt"); HR: chuông có thông báo mới, tab "Bổ sung giờ (1)" (đếm theo delta — §0.4 không số tuyệt đối: kiểm `listitem "{tên} — {ngày}"`) ⇒ "Duyệt đơn bổ sung giờ của {tên}" ⇒ dialog "Duyệt"; nhân viên: chuông + ô ngày "Đi làm", hết "Quên chấm ra". Vế phụ: checkbox "Ra sau nửa đêm (sáng hôm sau)" (chỉ hiện khi giờ ra < 06:00); "Hủy đơn"; "Từ chối đơn bổ sung giờ của {tên}" ⇒ "Từ chối" | nút "Xin bổ sung giờ ra"/"…vào"; form "Xin bổ sung giờ ra"; ô "Giờ ra"/"Giờ vào", "Lý do"; nút "Gửi đơn", "Hủy đơn"; tab "Bổ sung giờ (N)" |
| E2E-HR-21 | HR ở 360 px: `/hr/employees` ⇒ "Sửa hồ sơ của {tên}" ⇒ dialog "Sửa hồ sơ — {tên}" ⇒ "Ngày vào công ty", "Phòng ban", "Chức vụ", "Số điện thoại công việc" ⇒ "Lưu"; sửa ngày vào đã có ⇒ "Lý do sửa ngày vào công ty" bắt buộc; 409 (sửa song song qua API) ⇒ "Tải bản mới" giữ dữ liệu; nhân viên: menu "Hồ sơ của tôi" (ngay sau "Nghỉ phép") ⇒ `/my-profile` h1 "Hồ sơ của tôi", 4 dòng chỉ đọc; Admin: không có mục menu. Thêm nhân viên có trường hồ sơ; nhận lại radio "Giữ ngày vào cũ (…)" / "Ngày vào mới"; nút Hủy/Thêm/Nhận lại nằm trong thân hộp | như cột Ca |
| E2E-HR-22 | tải 2 file Excel: "Tải Excel" (Bảng công tháng), "Tải báo cáo nghỉ phép" (Số phép) ⇒ `download.suggestedFilename()` khớp header; đọc file bằng `readXlsx` (import harness API vào e2e support) ⇒ `expectSafeWorkbook`, ô tổng của người do ca tạo; nút khóa "Đang tạo file…" khi đang tạo; route giả 429 ⇒ câu dễ hiểu, không file | selector E gửi ở T-058c |
| E2E-HR-23 | "Cài chính sách phép" ⇒ **năm sau** ⇒ bật "Cho chuyển phép chưa dùng sang năm sau", "Tối đa … ngày" ⇒ "Lưu" ⇒ "Xác nhận lưu" ⇒ phân rã số phép năm sau hiện "chuyển sang"; khôi phục ở `afterAll` (§0.4) | T-058c |
| E2E-HR-24 | axe + responsive 360/768/1280: tab "Bổ sung giờ", form đơn, `/my-profile`, hộp "Sửa hồ sơ", form chính sách; `/hr` 7 tab ở 360 không dịch > 8 px (cách đo E2E-HR-14) | — |
| E2E-HR-25 | XSS ở phòng ban / chức vụ / lý do đơn (`<img src=x onerror=…>`, `javascript:`) ⇒ hiện văn bản, không chạy script (cùng bộ bẫy `xss.e2e.ts`) | — |

E2E-HR-14…19 (Mốc 3.5) vẫn xanh; menu nhân viên có thêm "Hồ sơ của tôi" ⇒ ca kiểm thứ tự menu cập nhật cùng T-058a.

## 10. Stryker (tầng M — chỉ khi TL báo "máy rảnh")

- `leave-domain` ≥ 90 %: `entitlementOf`, `carried`, kiểm số dư mới (`uEarly`/`uLate`/E), hàm ngày thuần (hạn E, năm tròn tới 31/12/Y), `negativeBalances`. Sau T-057.
- `attendance-domain` ≥ 90 %: luật gửi đơn bổ sung 1–6, `occurredAt` của ADJUSTMENT. Sau T-056.
- Nhóm mới `hr-profile-domain` (chuẩn hóa SĐT, contract ngày) nếu B đặt logic ở `domain/` — chưa có ngưỡng, chạy để báo cáo.
- Mutant sống ⇒ `docs/reviews/F3-mutation-report.md` theo chủ (leave: D, attendance: A, hr-profile: B).

## 11. Kiểm kê theo file (cập nhật khi viết ca — mỗi mã ca đúng một file)

| File | Ca | Pending theo vé | Duyệt |
|---|---|---|---|
| `test/security/harness/clock.ts` + `clock.test.ts` | `nextVnDateAnchor`, `localToIso`, `dateInTz`, `daysInMonth` | — (đã có) | TL |
| `test/security/harness/xlsx.ts` + `xlsx.test.ts` | bộ đọc .xlsx §1.2 | — (đã có) | B |
| `test/security/hr-profile.sec.ts` | SEC-HR-40, 41, 42, 43, 45, 46, 47 · EP-01…06, 11, 13 (vế S) — **15/15 xanh** trên `feat/m5-hr` 7ed6681 | T-054 | A |
| `test/security/hr-corrections.sec.ts` | SEC-HR-40c, 45c (vế đơn của 40 / 45 — mã có hậu tố để mỗi mã đúng một file), 48…51 · CR-01…06, 08…11, 13, 14 (vế S), 15 — **đã viết** (pending `T-056` tới khi vé vào `feat/m5-hr`) | T-055 + T-056 | D |
| `test/security/hr-export.sec.ts` | SEC-HR-52, 53, 54 (vế nội dung) · XL-01…04, 05 (local), 07, 09, 10 | T-055 + T-056 (bảng công), T-057 (phép) | B |
| `test/security/hr-export-limits.sec.ts` | SEC-HR-54 (429 giờ + đồng thời) | T-055 | B |
| `test/security/hr-export-load.nightly.sec.ts` | XL-05 (nightly) | T-055 + T-056 | B |
| `test/security/hr-leave-policy.sec.ts` | SEC-HR-40 (policy), 55 · LP-01, 03, 04, 06, 09, 09b, 10, 11, 12, 13, 14 (vế S) | T-057 | A |
| `test/security/hr-extended-races.sec.ts` | CC-HR-20, 21, 22, 22b, 23 | T-054 (23), T-056 (20…22b) | D (20…22b), A (23) |
| `test/security/hr-extended-races-policy.sec.ts` | CC-HR-24, 25 | T-057 | A |
| `test/security/hr-extended-clock-month.sec.ts` | CLK-HR-10, 14 | T-056 | D |
| `test/security/hr-extended-clock-nextday.sec.ts` | CLK-HR-11 | T-056 | D |
| `test/security/hr-extended-clock-expiry.sec.ts` | CLK-HR-12 · LP-06b, 07, 08 (vế K) | T-057 | A |
| `test/security/hr-extended-clock-newyear.sec.ts` | CLK-HR-13 | T-057 | A |
| `e2e/specs/hr-extended.e2e.ts` | E2E-HR-20…25 | T-058a / b / c | H viết · F soát cuối · E (selector) |
| `docs/reviews/T-059-xlsx-manual.md` | XL-08 | T-055…T-057 | TL |
| (tác giả) `*.test.ts`, `test/integration/**`, `test/http/**` | U/A/I/H của EP, CR, XL-06, LP | vé tương ứng | F |

Kiểm kê tự động khi ca có code: `grep -o "SEC-HR-[0-9]*\|CC-HR-[0-9]*b\?\|CLK-HR-[0-9]*\|E2E-HR-[0-9]*"` theo file khớp bảng này (như Mốc 3.5).

## 12. Câu hỏi mở (chờ tác giả trả lời — không chặn harness)

1. ~~B (T-055): 4 env export~~ — **chốt (B 18/10):** nhận đúng 4 tên; đặt khi `APP_ENV ≠ test` ⇒ API từ chối khởi động, thông báo nêu tên env (như ADR-141). XL-06 B viết tầng H, dùng `readXlsx` + `expectSafeWorkbook`.
2. ~~D (T-057): job 01/01~~ — **chốt (D 18/10):** job interval `leave-carryover` (1 giờ, luôn đăng ký) + `LEAVE_CARRYOVER_ON_START` / `LEAVE_CARRYOVER_INTERVAL_MS` test-only. Đã sửa §1.3, LP-12, CC-HR-24, CLK-HR-13.
3. ~~A (T-056): `nextDay` ≥ 06:00~~ — **chốt (A 18/10):** 400 Zod (`refine`, path `nextDay`), IN `nextDay` cũng 400; CHECK DB là chốt cuối. Đã sửa CR-04.
4. ~~A (T-056): bấm Ra sau OUT đã duyệt~~ — **chốt (A 18/10):** 201 (luật `decidePunch` Mốc 3 chỉ cần IN còn hiệu lực). Đã sửa CC-HR-21.
