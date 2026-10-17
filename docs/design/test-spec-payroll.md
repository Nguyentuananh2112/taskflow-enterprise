# Đặc tả test — Mốc 4 "Phiếu lương" (T-051)

> **Căn cứ:** `docs/design/payroll.md` v4 (main `c578622`, ADR-124…127, §7 test bắt buộc), `test-spec-company.md` (harness ADR-140), `test-spec-hr-extended.md` (bộ đọc .xlsx, `nextVnDateAnchor`), code domain của A trên `feat/T-049-payroll-domain` (`payslip-math.ts` bfbe930, `payroll-days.ts` cae6c3a), review cũ `docs/reviews/F-m4-payroll-review.md` (nhánh `docs/F-m4-payroll-review`).
> **Chủ:** F (QA độc lập).
> **Trạng thái:** đặc tả. Ca S/C/K/E viết khi contracts T-048 có route (B) và từng vé vào `feat/m4-payroll` (TL báo).
> **Nhánh:** `test/T-051-*` từ `feat/m4-payroll`, merge vào `feat/m4-payroll`.
>
> Số tiền trong spec / test là **số bịa**, không dùng mẫu phiếu người dùng gửi (có tên / lương thật — không vào repo). Mã lỗi theo `test-spec-hr.md` §0.2b: 409 `RESOURCE_CONFLICT` + `details.reason` thường; 422 `BUSINESS_RULE_VIOLATION` + `details.rule` HOA. Ca kiểm `code` + `details`.

## 0. Quy ước

### 0.1 Tầng và người viết

Tầng như `test-spec-company.md` §0.1 (U / A / I / H / S / C / K / E / M).

| Tầng | Người viết | Duyệt |
|---|---|---|
| U / A / I / H | tác giả vé: B (T-048 — schema, CHECK, trigger, luật self, audit, redact), A (T-049 — `payrollDaysOf`, `computePayslip`, use case) | F kiểm phủ theo mã ca + Stryker |
| S / C / K | **F** | **D** (người review tiền / khóa của Mốc 4, không viết module payroll) |
| E | **F** | E (selector T-050), TL |
| M | F, chỉ khi TL báo "máy rảnh" | — |

### 0.2 Bối cảnh chuẩn

Như `test-spec-company.md` §0.2: **Ada** Admin (bootstrap) · **Kay** nhân viên + `PAYROLL_MANAGE` (Kế toán) · **Kim** nhân viên + `PAYROLL_MANAGE` (Kế toán thứ hai — sửa phiếu của Kay) · **Hana** nhân viên + `HR_MANAGE` (nhập `hireDate`, sửa công) · **Mia**, **Max** nhân viên · **Quinn** đã nghỉ trong kỳ. Mọi ca tự tạo người; lương cơ bản / thưởng là số tròn bịa (vd 7 000 000).

### 0.3 Thứ tự lỗi

1. 401 / 401 `SESSION_REVOKED`;
2. 403 — `payroll:manage` thiếu (HR, nhân viên, Admin gọi route self); luật self tuyệt đối của Kế toán; `permit` trước validate ⇒ body sai vẫn 403;
3. 400 (Zod strict; > 50 dòng là 400 ở contract — §5 PR-05);
4. 404 tài nguyên con (phiếu người khác ⇒ 404; kỳ chưa có bảng ⇒ 404);
5. 422 / 409.

### 0.4 Cách ly (ADR-140)

- **Bảng lương là của cả công ty, unique `(period)`** ⇒ mỗi file S/C/K có DB riêng; trong một file, mỗi ca dùng **kỳ riêng** (tháng khác nhau, lùi dần từ tháng trước của mốc) hoặc khẳng định theo dòng của người do ca tạo. Không ca nào khẳng định tổng số phiếu / tổng thực lĩnh của cả bảng — trừ khi file chỉ có người của ca đó.
- **E2E** (một DB cho cả lượt): một kỳ cho cả suite E2E payroll (`workers: 1`), tạo bảng ở `beforeAll`; ca phát hành chạy **cuối** file; ca chỉ đọc / sửa phiếu của người do ca tạo.
- `payroll_settings` (mức thâm niên/năm) là **một dòng cho cả công ty** ⇒ ca đổi mức ở file riêng (`payroll-settings.sec.ts`); E2E không đổi.
- Thông báo `PAYSLIP_PUBLISHED` / `PAYROLL_REMINDER`: delta lọc `refId` (kỳ / phiếu).

### 0.5 Bất biến "không lộ tiền" (dùng ở mọi ca S có ghi)

Mỗi ca ghi tiền dùng một **số đánh dấu** duy nhất (vd `7 031 117`) và kiểm số đó (cả dạng `7031117`, `7.031.117`, `7,031,117`) **không** có trong: thông báo (title / body / data), log API (`api.logs()`), URL / header `Location`, body lỗi, audit đọc bởi người không phải Admin.

## 1. Harness

### 1.1 Có sẵn

- `useCompanyApi`, `CompanyActors.createUser(label, { grants: ['PAYROLL_MANAGE'] })`, `setAccess`, `offboardRaw`, `api.restart` (mốc tiến), `secCase` + pending theo vé.
- `nextVnDateAnchor` (`'*-01'` đầu tháng, `'*-05'`, `'*-10'`, `'*-L'` cuối tháng), `localToIso`, `daysInMonth` — `harness/clock.ts`.
- `download`, `readXlsx`, `expectSafeWorkbook`, `expectXlsxHeaders` — `harness/xlsx.ts` — export bảng lương là **.xlsx** (TL chốt 18/10).
- Dựng công: HR `adjust` IN/OUT qua API (không chờ đồng hồ), đơn nghỉ qua `submitLeave` + approve, `PUT hr/employee-profiles/:userId` cho `hireDate` (T-054 đã có trên `feat/m5-hr`).

### 1.2 Thêm (viết cùng ca, `harness/payroll.ts`)

- `PAYROLL` — bản đồ route lấy từ contracts T-048 (B), không lặp chuỗi trong ca: `runs`, `run(period)`, `createRun(period)`, `recompute(period)` + `recomputePreview(period)`, `addMissing(period)`, `publish(period)`, `payslip(period, userId)`, `payslipLines`, `revise`, `salaryProfiles`, `salaryProfile(userId)`, `settings`, `export(period)`, `mySlips`, `mySlip(period)`.
- `seedMonth(actors, who, period, plan)` — dựng một tháng công theo kế hoạch `{ 'YYYY-MM-DD': 'P' | 'MO' | 'A' | { leave: 'ANNUAL', part: 'AM' } … }` bằng `adjust` + đơn nghỉ. Kỳ dùng phải là **tháng đã kết thúc** theo mốc.
- `expectNoMoney(marker, sources)` — bất biến §0.5.
- `expectTotals(slip)` — so tổng trong DTO với `computePayslip` của `@taskflow/contracts` (cùng package web dùng) trên dòng đọc lại.

### 1.3 Env test-only cần hỏi tác giả (chỉ nhận khi `APP_ENV=test`)

| Env | Ai | Vì sao |
|---|---|---|
| Kích hoạt job nhắc `PAYROLL_REMINDER` theo yêu cầu (vd `PAYROLL_REMINDER_ON_START`, `…_INTERVAL_MS`, log `maintenance.run_done {job}`) | A (T-049) | CLK-PAY-02…04: nhắc từ ngày 5, chống lặp `(period, ngày)` |
| Hạ mốc retention chấm công (vd `RETENTION_ATTENDANCE_DAYS` nhỏ) — hoặc xác nhận chỉ kiểm ở tầng I | A / B | RD-06: kỳ quá retention ⇒ cấm Tính lại công; điều chỉnh copy `paidHalfDays` |

## 2. PD — `payrollDaysOf` (tầng U, Stryker `attendance-domain` ≥ 90 %; vế S ở PD-20)

Một ca U = một bảng `{ngày ⇒ trạng thái, phép nửa ngày, lịch, nhiệm kỳ}` ⇒ `halfDays`. A đã có `payroll-days.test.ts` (185 dòng) — F đối chiếu đủ các mã dưới, thiếu thì A thêm.

| Mã | Ca | Mong đợi (nửa ngày) |
|---|---|---|
| PD-01 | PRESENT không phép | 2 |
| PD-02 | PRESENT + AM ANNUAL | 2 |
| PD-03 | PRESENT + AM UNPAID | 1 |
| PD-04 | ABSENT + AM ANNUAL | 1 |
| PD-05 | MISSING_OUT + AM ANNUAL | 1 (`missingOutDates` có ngày đó) |
| PD-06 | MISSING_OUT không phép | 0 (`missingOutDates` có ngày đó) |
| PD-07 | 2 dòng/ngày AM ANNUAL + PM UNPAID (cả ABSENT lẫn PRESENT) | 1 |
| PD-08 | phép cả ngày SICK / UNPAID / OTHER | 0 mỗi loại |
| PD-09 | PERSONAL_PAID cả ngày | 2 |
| PD-10 | HOLIDAY rơi ngày làm việc (theo `effectiveSchedule` của **ngày đó**, không theo status) | 2 |
| PD-11 | HOLIDAY rơi CN / OFF | 0 |
| PD-12 | ngoài nhiệm kỳ, có lượt chấm (ADJUSTMENT cũ) | 0 |
| PD-13 | biên nhiệm kỳ bằng ngày: `start_date` tính, ngày trước 0; `last_day` tính, ngày sau 0; nhiệm kỳ 1 ngày; 2 nhiệm kỳ trong tháng (nghỉ + nhận lại) | đúng |
| PD-14 | dòng phép trùng (cùng ngày, cùng nửa — 2 đơn, hoặc ANNUAL + UNPAID cùng nửa) | không cộng 2 lần; ≤ 2 nửa/ngày; có một dòng có lương ⇒ 1 |
| PD-15 | PRESENT ít giờ / đi muộn / về sớm | 2 |
| PD-16 | phép cả ngày UNPAID + có IN+OUT | 0 (phép thắng lượt chấm) |
| PD-17 | đổi lịch giữa tháng: thứ Bảy là ngày làm ở đoạn đầu, nghỉ ở đoạn sau | thứ Bảy đoạn đầu tính, đoạn sau 0 |
| PD-18 | `from` trước mốc retention | `{ok:false, reason:'ATTENDANCE_RETENTION_EXPIRED'}` (không trả số thiếu) |
| PD-19 | property (vòng lặp có seed, không thêm thư viện): mọi tháng ngẫu nhiên ⇒ `0 ≤ halfDays ≤ 2 × số ngày làm trong nhiệm kỳ`; thêm phép có lương vào nửa vắng không bao giờ làm giảm; bỏ nhiệm kỳ ⇒ 0 | đúng |
| PD-20 | (S) cùng tháng dựng qua API (`seedMonth`) ⇒ `paidHalfDays` trên phiếu nháp = kết quả bảng PD-01…16 cho từng ngày | khớp |

## 3. SD — công chuẩn (U + S)

| Mã | Ca | Mong đợi |
|---|---|---|
| SD-01 | tháng lịch mặc định T2–T7: số ngày làm việc theo lịch; lễ rơi ngày làm **vẫn tính** vào `S` (ADR-126: "gồm ngày lễ rơi vào ngày làm") | đúng |
| SD-02 | đổi lịch công ty giữa tháng ⇒ tổng hai đoạn | đúng |
| SD-03 | tháng không có ngày làm việc nào (lịch toàn OFF) ⇒ `standardDaysOf` ném lỗi; tạo nháp ⇒ 422 (mã do A chốt — §11 câu 3), không chia cho 0 | đúng |
| SD-04 | (S) người vào ngày 15 / nghỉ ngày 10 cùng kỳ ⇒ cùng `standardDays` với người đủ tháng; phiếu hiện "công thực tế / công chuẩn" | đúng |
| SD-05 | (S) `standardDays` là ảnh chụp: HR đổi lịch sau khi tạo nháp ⇒ nháp giữ; "Tính lại công" ⇒ cập nhật | đúng |

## 4. PE — người trong kỳ (A + I + S)

| Mã | Ca | Mong đợi |
|---|---|---|
| PE-01 | Ada (Admin chưa từng là nhân viên) | không có phiếu; `GET /payslips` ⇒ 403 |
| PE-02 | nâng Mia EMPLOYEE → ADMIN ngày 15 | có phiếu tháng đó, công đếm 1..15; tháng sau không có phiếu |
| PE-03 | hạ ADMIN → EMPLOYEE ngày 20 | phiếu tháng đó công đếm từ 21 |
| PE-04 | Quinn nghỉ `last_day` = ngày cuối tháng | có phiếu tháng đó, không có phiếu tháng sau |
| PE-05 | nghỉ tháng M, nhận lại tháng M+2 | tháng M+1 không có phiếu |
| PE-06 | "Thêm người còn thiếu": người có đoạn EMPLOYEE giao kỳ được thêm sau khi tạo nháp ⇒ thêm đúng người đó, người đã có không bị nhân đôi, chạy 2 lần idempotent | đúng |
| PE-07 | người thiếu hồ sơ lương / thiếu `hireDate` ⇒ vẫn có dòng, gắn cờ, phát hành ⇒ 422 (mã theo contract) | đúng |

## 5. SN — thâm niên (U `completedYears` / `seniorityAllowanceOf` + S)

| Mã | Ca | Mong đợi |
|---|---|---|
| SN-01 | < 1 năm | 0 |
| SN-02 | tròn năm đúng ngày cuối kỳ (hireDate 31/10/2025, kỳ 10/2026) | 1 năm — tính cả tháng |
| SN-03 | tròn năm ngày 1 tháng sau (hireDate 01/11/2025, kỳ 10/2026) | 0 |
| SN-04 | hireDate 29/02/2024: kỳ 02/2025 (kỷ niệm 28/02) ⇒ 1; kỳ 01/2025 ⇒ 0; kỳ 02/2028 (29/02) ⇒ 4 | đúng |
| SN-05 | hireDate 31/01: kỳ tháng 2 (cuối 28/29) và tháng 4 (cuối 30) | đúng năm tròn |
| SN-06 | hàm thuần chuỗi: chạy test U với `TZ=Pacific/Kiritimati` và `TZ=Pacific/Pago_Pago` ⇒ cùng kết quả (không `Date` — grep cấm `new Date` trong file) | đúng |
| SN-07 | hireDate sau ngày cuối kỳ | cờ, chặn phát hành |
| SN-08 | đổi `seniorityPerYear` khi **nháp** ⇒ nháp giữ số cũ + việc còn lại "Mức thâm niên đã đổi — tính lại"; Tính lại công ⇒ số mới; đổi sau phát hành ⇒ phiếu cũ không đổi | đúng |
| SN-09 | HR đổi `hireDate` khi nháp ⇒ "Ngày vào công ty đã đổi — tính lại"; sau PUBLISHED ⇒ cờ "hồ sơ đã thay đổi sau phát hành" (so `Payslip.hireDate`), phiếu không đổi | đúng |
| SN-10 | không chia theo công: `h = 0`, nghỉ việc giữa tháng, lên Admin giữa tháng ⇒ thâm niên đủ | đúng |
| SN-11 | `seniorityAllowanceOf` vượt trần (1e12 × 80) ⇒ ném lỗi, không trả số sai | đúng |

## 6. PR — `computePayslip` (U, Stryker nhóm mới `payroll-math` ≥ 90 %)

| Mã | Ca | Mong đợi |
|---|---|---|
| PR-01 | half-up một lần: base 7 000 001, `S` = 26, h = 43 ⇒ `floor((2·base·h + 2S)/(4S))`; so với tính bằng BigInt chính xác cho 10 000 bộ ngẫu nhiên có seed | khớp |
| PR-02 | trần `h ≤ 2S` áp sau sửa tay (h = 62, S = 20 ⇒ dùng 40) | đúng |
| PR-03 | biên `2·1e12·62` an toàn; `baseSalary` 1e12 + 1 / âm / 0,5 ⇒ ném lỗi | đúng |
| PR-04 | `netPay = income + bonus − deduction`; âm được trả về (không ném) — chặn ở phát hành (`NEGATIVE_NET_PAY`) | đúng |
| PR-05 | 51 dòng ⇒ `computePayslip` ném; contract ⇒ 400 (S) | đúng |
| PR-06 | 50 dòng × 1e12 + thâm niên lớn ⇒ tổng `isSafeInteger` hoặc ném lỗi (không trả số sai) | đúng |
| PR-07 | parity: phiếu đọc lại qua API ⇒ `computePayslip(dòng đọc lại)` = tổng đã lưu (S, mọi ca có phiếu — `expectTotals`) | khớp |
| PR-08 | web và server cùng kết quả: test web import cùng hàm từ `@taskflow/contracts` (không bản sao) — kiểm bằng depcruise / grep | đúng |
| PR-09 | `S` = 0 / 32 ⇒ ném lỗi | đúng |

## 7. RD — vòng đời bảng lương (A + I + S)

| Mã | Tầng | Ca | Mong đợi |
|---|---|---|---|
| RD-01 | I + S | tạo nháp kỳ M (M đã kết thúc) ⇒ 201; tạo lại ⇒ cùng bảng (idempotent, unique `(period)`) | đúng |
| RD-02 | S | tạo nháp tháng hiện tại / tương lai ⇒ 422 (mã theo contract) | đúng |
| RD-03 | A + S | sửa phiếu với `lockVersion` cũ ⇒ 409 `VERSION_CONFLICT`; sửa công không lý do ⇒ 400; bước 0,5 ngày (số lẻ nửa ngày được, 0,25 ⇒ 400) | đúng |
| RD-04 | A + S | phát hành: chặn khi còn cờ (thiếu hồ sơ / `hireDate` / sau kỳ, `NEGATIVE_NET_PAY`) — body lỗi liệt kê lý do; còn MISSING_OUT ⇒ cảnh báo, không chặn; phát hành thành công đếm 1, lần 2 ⇒ 409 | đúng |
| RD-05 | I + S | phiếu PUBLISHED bất biến: mọi lệnh sửa ⇒ 409/422; UPDATE thẳng cột tiền bằng SQL ⇒ trigger chặn (I) | đúng |
| RD-06 | I (+ K nếu có env §1.3) | kỳ có ngày quá retention ⇒ Tính lại công 422 `ATTENDANCE_RETENTION_EXPIRED`; bản điều chỉnh copy `paidHalfDays` của bản trước | đúng |
| RD-07 | A + S | "Tính lại công" preview ⇒ "N người thay đổi"; áp ⇒ đúng N phiếu đổi; override có lý do được giữ | khớp |
| RD-08 | A + S | bản điều chỉnh: lý do bắt buộc; bản cũ `supersededAt`, bản mới `revision + 1`; một bản hiệu lực (partial unique); nhân viên thấy lý do + bản cũ có nhãn | đúng |
| RD-09 | S | sau phát hành, HR `adjust` công tháng đó ⇒ cờ "công đã thay đổi sau phát hành", phiếu không đổi | đúng |
| RD-10 | S | thông báo `PAYSLIP_PUBLISHED` đúng 1 / nhân viên có phiếu, link `/payslips/YYYY-MM`, **không số tiền** (§0.5); gửi sau commit (phát hành lỗi ⇒ không thông báo) | đúng |
| RD-11 | I | bảng payroll + audit `PAYROLL_*` ngoài mọi bước retention hiện có (chạy retention ⇒ không xóa dòng nào) | đúng |
| RD-12 | S | export bảng lương **.xlsx** qua `ISpreadsheetWriter` (TL chốt 18/10 — không CSV): `expectXlsxHeaders` + `readXlsx` + `expectSafeWorkbook` (luật ADR-130: không `<f>`, `quotePrefix` cho nhãn `= + - @ TAB CR`, không metadata thừa); chỉ bản hiệu lực + cột revision; cột tiền là **ô số** nguyên (không chuỗi, không ₫, không `'`), tổng khớp `computePayslip`; no-store; audit `EXPORT` chỉ khi stream bắt đầu; hạn mức chung với export HR; kiểm thủ công 1 lần trên Excel vi-VN + LibreOffice cùng D (như XL-08) | đúng |

## 8. SEC — hộp đen bảo mật (`SEC-PAY-*`, tầng S)

| Mã | Ca | Mong đợi |
|---|---|---|
| SEC-PAY-01 | Mia, Hana (chỉ `HR_MANAGE`) gọi mọi route `payroll/…`, `salary-profiles`, `payroll-settings` (body sai) | 403 (không 400) |
| SEC-PAY-02 | Ada gọi `GET /payslips`, `/payslips/:period` | 403 |
| SEC-PAY-03 | Mia `GET /payslips/:period` của mình ⇒ 200 chỉ bản hiệu lực của mình; đổi `userId` / id phiếu sang Max ⇒ 404 (body giống phiếu không tồn tại) | đúng |
| SEC-PAY-04 | luật self tuyệt đối: Kay sửa phiếu / dòng / ghi chú / công / hồ sơ lương / bản điều chỉnh **của chính Kay** ⇒ 403; Kim hoặc Ada ⇒ 200; Kay vẫn **phát hành** được cả bảng (gồm phiếu của Kay) | đúng |
| SEC-PAY-05 | thu `PAYROLL_MANAGE` của Kim giữa lúc mở form và lưu ⇒ 403, không đổi số (đọc lại quyền FOR SHARE) | đúng |
| SEC-PAY-06 | Quinn sau `access_until` ⇒ 401 `SESSION_REVOKED` cả route self | đúng |
| SEC-PAY-07 | mass assignment: body phiếu có `netPay`, `incomeTotal`, `seniorityAllowance`, `salaryByDays`, `userId`, `revision`, `status` ⇒ 400 strict (tổng chỉ do server tính) | đúng |
| SEC-PAY-08 | tiền: `-1`, `1e12 + 1`, `1.5`, `"7000000"`, `1e21`, `NaN` ⇒ 400; 51 dòng ⇒ 400; nhãn rỗng / 121 ký tự / ký tự điều khiển ⇒ 400 | đúng |
| SEC-PAY-09 | không lộ tiền (§0.5): thông báo, log, URL, body lỗi; ném lỗi giữa chừng (body sai kiểu ở lô dòng thứ 30) ⇒ log không có số | đúng |
| SEC-PAY-10 | audit `PAYROLL_*` có before/after số tiền; `GET hr/audit-logs` chỉ Admin (Kay, Hana ⇒ 403) | đúng |
| SEC-PAY-11 | header: mọi route lương `Cache-Control: no-store`; export có header tải file + `nosniff` | đúng |
| SEC-PAY-12 | `payroll_settings`: chỉ `payroll:manage`; `seniorityPerYear` âm / > 1e12 ⇒ 400; luôn một dòng (CHECK `id = 1` — I) | đúng |
| SEC-PAY-13 | parity (bổ sung SEC-HR-34): `PAYROLL_MANAGE` ∌ `hr:*`, `company:*`; Kay gọi `hr/…` ⇒ 403 | đúng |
| SEC-PAY-14 | redact Sentry / log body các route `/payroll`, `/payslips`, `/salary-profiles`, `/payroll-settings` (tầng H — B) | đúng |

## 9. CC — đua (tầng C, ×20, gom vòng đỏ, `SEC_HR_RACE_RUNS`)

| Mã | Ca | Mong đợi |
|---|---|---|
| CC-PAY-01 | 2 lệnh tạo nháp cùng kỳ song song | 1 bảng; cả hai 200/201 cùng id hoặc 1 × 409 — không 500, không 2 bảng |
| CC-PAY-02 | Kim sửa phiếu ‖ Ada sửa cùng phiếu, cùng `lockVersion` | 1 × 200, 1 × 409 |
| CC-PAY-03 | phát hành ‖ sửa phiếu | sửa thắng ⇒ phát hành thấy số mới; phát hành thắng ⇒ sửa 409/422; không phiếu nào PUBLISHED mang số nửa cũ nửa mới (parity PR-07) |
| CC-PAY-04 | 2 lệnh phát hành song song | đúng 1 × 200; thông báo 1 lần / người |
| CC-PAY-05 | 2 bản điều chỉnh song song cùng phiếu | đúng 1 thắng (`revision + 1`), bên kia 409; một bản hiệu lực |
| CC-PAY-06 | "Tính lại công" ‖ HR `adjust` công tháng đó | kết quả = trước hoặc sau, không lẫn; không 500 |
| CC-PAY-07 | "Thêm người còn thiếu" ×2 song song | không phiếu trùng (unique hiệu lực) |

## 10. CLK — đồng hồ neo (tầng K) + E2E

| Mã | Mốc | Ca | Mong đợi |
|---|---|---|---|
| CLK-PAY-01 | `'*-L'` 23:59:30 | tạo nháp kỳ tháng hiện tại ⇒ 422; sau 00:00 cùng lệnh ⇒ 201 | đúng |
| CLK-PAY-02 | `'*-05'` 00:00:30 (cần env §1.3) | bảng kỳ trước còn NHÁP ⇒ nhắc `PAYROLL_REMINDER` tới Kay, Kim, Ada (không Hana, không Mia); chạy job lần 2 cùng ngày ⇒ không nhắc lại | đúng |
| CLK-PAY-03 | `'*-04'` 23:59:30 | trước 00:00 không nhắc; sau ⇒ nhắc | đúng |
| CLK-PAY-04 | restart mốc `'*-11'` 10:00 | quá ngày 10 vẫn nhắc mỗi ngày; phát hành ⇒ hết nhắc | đúng |

| Mã | Ca (tầng E, `workers: 1`, `@main` cho 02) |
|---|---|
| E2E-PAY-01 | nhân viên `/payslips` mở thẳng phiếu mới nhất; ‹ tháng trước / tháng sau ›; đầu phiếu in tên công ty; title tab "Phiếu lương tháng M/YYYY" không tiền, không tên |
| E2E-PAY-02 | Kế toán ở **360 px**: thẻ người ⇒ form ⇒ gõ nhãn + tiền ("7.000.000" / dán "7,000,000") ⇒ tổng xem trước ⇒ Lưu ⇒ số khớp API |
| E2E-PAY-03 | modal phát hành bắt tick "Tôi đã kiểm tra"; Phát hành bị chặn ⇒ ghi rõ lý do |
| E2E-PAY-04 | **đăng xuất ⇒ Back** ⇒ không thấy số tiền (no-store + cache `['company', …]` xóa) |
| E2E-PAY-05 | in: bản cũ có nhãn "BẢN CŨ — đã được thay thế" khi in (`page.emulateMedia({media:'print'})`) |
| E2E-PAY-06 | Admin không thấy lối tắt "Phiếu lương"; Kế toán thấy "Bảng lương"; E2E-HR-14/15 vẫn xanh |
| E2E-PAY-07 | 409 khi lưu (sửa song song qua API) ⇒ giữ số đã gõ + "Tải bản mới" |
| E2E-PAY-08 | axe + responsive 360/768/1280: `/payslips`, `/payroll/YYYY-MM`, form 1 người, `/payroll/profiles` |
| E2E-PAY-09 | XSS ở nhãn dòng / ghi chú / lý do điều chỉnh ⇒ hiện văn bản |

Selector theo E (T-050) — chờ E gửi.

## 11. Stryker, kiểm kê, câu hỏi

### 11.1 Stryker (chỉ khi TL báo "máy rảnh")

- `attendance-domain` ≥ 90 % (gồm `payroll-days.ts`) — sau T-049.
- Nhóm mới **`payroll-math`**: `packages/contracts/src/payroll/payslip-math.ts` ≥ 90 %. Cấu hình Stryker hiện chỉ ở `apps/api/stryker/` ⇒ F thêm group cho package `contracts` (hoặc A chuyển file) — chốt khi chạy.
- `payroll-domain` (module `apps/api/src/modules/payroll/domain`, nếu có) — báo cáo, chưa ngưỡng.
- Mutant sống ⇒ `docs/reviews/F3-mutation-report.md` theo chủ (A).

### 11.2 Kiểm kê theo file (mỗi mã ca đúng một file)

| File | Ca | Pending theo vé | Duyệt |
|---|---|---|---|
| (A) `attendance/domain/payroll-days.test.ts` | PD-01…19, SD-01…03 (U) | T-049 | F |
| (A) `contracts/src/payroll/payslip-math.test.ts` | SN-01…07, 11, PR-01…06, 09 (U) | T-049 | F |
| (A/B) `*.test.ts`, `test/integration/payroll/**`, `test/http/payroll*.test.ts` | PE (A/I), RD-05/06/11 (I), SEC-PAY-12 (I), SEC-PAY-14 (H) | T-048 / T-049 | F |
| `test/security/harness/payroll.ts` | `PAYROLL`, `seedMonth`, `expectNoMoney`, `expectTotals` | T-048 contracts | D |
| `test/security/payroll.sec.ts` | PD-20, SD-04/05, PE-01…07 (S), SN-08…10 (S), PR-05/07 (S), RD-01…04, 07…10, 12 | T-048 + T-049 | D |
| `test/security/payroll-access.sec.ts` | SEC-PAY-01…11, 13 | T-048 + T-049 | D |
| `test/security/payroll-settings.sec.ts` | SEC-PAY-12 (S), SN-08 (vế đổi mức) | T-049 | D |
| `test/security/payroll-races.sec.ts` | CC-PAY-01…07 | T-049 | D |
| `test/security/payroll-clock-month.sec.ts` | CLK-PAY-01 | T-049 | D |
| `test/security/payroll-clock-reminder.sec.ts` | CLK-PAY-02…04 | T-049 (+ env §1.3) | D |
| `e2e/specs/payroll.e2e.ts` | E2E-PAY-01…09 | T-050 | E |

### 11.3 Câu hỏi mở (hỏi thẳng tác giả — chỉ báo TL nếu bất đồng thiết kế)

1. ~~A: CSV hay .xlsx~~ — **chốt (TL 18/10):** .xlsx qua `ISpreadsheetWriter` (bộ ghi `fflate` dùng chung, luật ADR-130), không CSV. Đã sửa §1.1, RD-12.
2. **A (T-049):** job nhắc `PAYROLL_REMINDER` chạy thế nào (interval maintenance như `leave-carryover`?) và có cờ test-only `…_ON_START` / `…_INTERVAL_MS` không (CLK-PAY-02…04)?
3. **A (T-049):** mã lỗi khi tạo nháp kỳ chưa kết thúc (RD-02) và kỳ không có ngày làm việc (SD-03); mã cờ chặn phát hành (PE-07, RD-04).
4. **B (T-048):** route + DTO (contracts) để dựng `PAYROLL` ở harness; sửa công đi qua route payroll (override trên phiếu) hay route attendance?
