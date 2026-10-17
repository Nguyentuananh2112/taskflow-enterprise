# Mốc 4 — Phiếu lương hằng tháng (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất v4** (Tech Lead, 2026-10-17; A soạn bản chuyển sang cấp công ty) — v2 đã gộp review của A (domain), B (bảo mật), D (tiền), E (web), F (kiểm thử); v3 gộp quyết định người dùng 17/10 + công thức của A + luồng UX của E; v3.1 bổ sung review A. ADR-124…127 chỉ ghi vào `DECISIONS.md` sau khi người dùng duyệt. Chưa ai code trước khi duyệt. **Làm SAU Mốc 3.5 (`company-level.md`) và Mốc 5 (`hr-extended.md`, ít nhất T-054 hồ sơ).**

**Thay đổi v4 — chuyển sang cấp công ty** (nguồn: `company-level.md` v2.1 §8 — người dùng duyệt 17/10; `hr-extended.md` §8)
- Một công ty: bỏ `ws` khỏi mọi bảng, route, khóa, chống lặp nhắc. Route `/api/v1/payroll/…`, `/api/v1/payslips/…`; web `/payslips`, `/payroll/…` (không `/w/[ws]`). Đầu phiếu in **tên công ty** (`companies.name`).
- Quyền: `CompanyGrant.PAYROLL_MANAGE` ⇒ `payroll:manage` (ADR-134/135); "OWNER" ⇒ **Admin**. **Admin không có phiếu lương** (không phải nhân viên — người dùng 17/10).
- Luật self **tuyệt đối** với Kế toán: phiếu / hồ sơ lương / sửa công của Kế toán do **Kế toán khác hoặc Admin** làm.
- **Một nguồn `hireDate` = `EmployeeProfile`** (Mốc 5, HR nhập, không phiên bản): `SalaryProfile` bỏ `hireDate`; payroll đọc qua port `payroll/application/ports/hire-date.port.ts`. Bỏ luật "sửa tại chỗ khi chưa PUBLISHED".
- Cấu hình mức thâm niên: bảng **`payroll_settings`** riêng, PK hằng `id = 1`, module payroll sở hữu, tạo ở migration payroll.
- Nhiệm kỳ: `ICompanyTenurePort` trả **ngày** (`first_day`/`last_day`) — người trong kỳ = có nhiệm kỳ EMPLOYEE giao kỳ (gồm nâng/hạ Admin giữa tháng).
- Khóa `taskflow:payroll:<period>`; unique `(period)`; nhắc chống lặp theo `(period, ngày)`; migration payroll = **7**.

## 0. Người dùng đã chốt

| Điểm | Chốt |
|---|---|
| Ngày trả lương | Mùng **10** hằng tháng (phiếu tháng M phát hành trước/đúng ngày 10 tháng M+1) |
| Mẫu phiếu | Theo mẫu người dùng gửi (ảnh KHÔNG đưa vào repo — có tên/lương thật): Thông tin người lĩnh · (1) Tiền lương chi tiết · (2) Thưởng doanh số theo kênh · (3) Các khoản giảm trừ · (4) Tổng thực lĩnh = (1)+(2)−(3) · Ghi chú |
| Ai làm lương | Quyền cấp công ty **"Kế toán"** (`CompanyGrant.PAYROLL_MANAGE` ⇒ `payroll:manage`), tách khỏi "Nhân sự"; Admin ngầm có |
| Ai có phiếu lương | **Nhân viên** (role EMPLOYEE) trong nhiệm kỳ — **Admin không có phiếu** (17/10) |
| Bảo hiểm, thuế TNCN | **Kế toán tự nhập số** (v1 không tự tính) |
| Công chuẩn | **Số ngày làm việc của tháng theo lịch công ty** — đi đủ ⇒ nhận đủ lương cơ bản (thay cho "cố định 26") |
| Quên chấm ra | **Không tính công** phần đi làm tới khi HR bổ sung giờ ra |
| Phát hành | **Kế toán bấm "Phát hành"**; nhắc từ ngày 5 |
| Thiết bị nhập liệu (17/10) | Kế toán nhập trên **cả điện thoại**: 360 px dùng tốt (§5.2) |
| Nhãn dòng (17/10) | Kế toán **gõ tay mỗi tháng** (thưởng theo kênh, BHXH, thuế, tạm ứng…) — không mẫu dòng, không copy tháng trước. Gợi ý nhãn (autocomplete từ nhãn đã dùng trong công ty): *tùy chọn, không trong phạm vi bắt buộc* |
| Phụ cấp thâm niên (17/10) | **Tự động** = 500.000 đ × số năm làm việc tròn (1 năm 500.000; 2 năm 1.000.000; 3 năm 1.500.000…; < 1 năm = 0), theo **Ngày vào công ty** `EmployeeProfile.hireDate` (HR nhập ở Nhân sự; KHÔNG dùng `company_members.start_date` — đó là đầu nhiệm kỳ trên hệ thống). Mức/năm là cấu hình công ty (`payroll_settings`, mặc định 500.000) |

TL chốt (người dùng xem lại): phụ cấp thâm niên **trả đủ, không chia theo công** (là thưởng theo thâm niên — *giả định TL, người dùng có thể đổi*); số năm tròn tính đến **ngày cuối kỳ lương** (tròn năm trong tháng M ⇒ được tính cả tháng M); nghỉ loại OTHER **không lương** mặc định (sửa tay được); đi làm có IN+OUT hợp lệ ⇒ **đủ** các nửa đi làm của ngày đó dù làm ít giờ — đi muộn/về sớm chỉ hiện ở bảng công, **không trừ lương tự động**, muốn trừ thì kế toán gõ dòng giảm trừ; phép đã duyệt **thắng** lượt chấm (phép cả ngày UNPAID mà vẫn chấm ⇒ 0 công, HR phải thu hồi đơn); thực lĩnh âm ⇒ **cấm phát hành**; nhân viên đã nghỉ việc **không** tự xem phiếu cũ trên web (không còn đăng nhập được — ADR-137; kế toán xuất gửi).

## 1. Phạm vi v1

**Có:** hồ sơ lương theo phiên bản (level, lương cơ bản); phụ cấp thâm niên tự tính theo `EmployeeProfile.hireDate`; bảng lương tháng (nháp tự điền công từ chấm công → kế toán gõ dòng thưởng/giảm trừ → phát hành → phiếu bất biến); bản điều chỉnh có lịch sử; "Phiếu lương của tôi" xem/in/lưu PDF; thông báo; nhắc kế toán từ ngày 5; xuất Excel (.xlsx); nhập liệu trên điện thoại.

**Không:** tự tính BH/thuế; giảm trừ gia cảnh; tăng ca; file ngân hàng; ký số; nhân viên đã nghỉ tự tra phiếu; mẫu dòng / copy dòng tháng trước; autosave; phiếu lương cho Admin.

## 2. ADR đề xuất

**ADR-124 — Quyền "Kế toán" cấp công ty.** `CompanyGrant.PAYROLL_MANAGE` ⇒ `payroll:manage` (cơ chế ADR-134/135 của `company-level.md`; enum đã khai ở migration 5; Admin ngầm có; chỉ Admin cấp/thu qua `PUT admin/access/:userId` (`company:grant`), có thông báo `ACCESS_CHANGED` + audit). Parity (SEC-HR-34): `HR_MANAGE` ∌ `payroll:*`; `PAYROLL_MANAGE` ∌ `hr:*`, `company:*`; quyền công ty ∩ quyền workspace = ∅. **Luật self tuyệt đối** với Kế toán (B-H1, `company-level.md` ADR-134): hồ sơ lương, sửa công, dòng phiếu, ghi chú, bản điều chỉnh **của chính Kế toán** ⇒ 403 — Kế toán khác hoặc Admin làm (audit như mọi lệnh). Kế toán vẫn phát hành được cả bảng (gồm phiếu của mình — phát hành không sửa số). Cấu hình mức thâm niên/năm: `payroll:manage`, có audit. Mọi lệnh ghi qua `authorizeCompanyWrite({actorId, targetUserId?})` với `payroll:manage` (khóa dòng `company_members` của actor FOR SHARE + đọc lại quyền — thu quyền có hiệu lực ngay). `hireDate` **không** thuộc luật self của payroll (Kế toán chỉ đọc; HR sửa — ADR-128).

**ADR-125 — Tiền là số nguyên VND; một hàm tính; phiếu đã phát hành bất biến.**
- Lưu `BIGINT` đồng; DTO là number nguyên an toàn (`MoneyVnd = z.int().min(0).max(1e12)` dùng chung web/API; `Number.isSafeInteger` ở biên). Không float.
- Công là **số nguyên nửa ngày** `h` (0..62); công chuẩn `S` (ngày, ≥ 1) ⇒ `salaryByDays = floor((2·base·min(h, 2S) + 2S) / (4S))` (half-up chính xác, làm tròn **một lần** trên lương cơ bản). Mọi phép là cộng/nhân số nguyên; lớn nhất `2·1e12·62 ≈ 1,24e14 < 2^53`.
- **Thâm niên:** `years = số năm tròn từ hireDate tới ngày cuối kỳ` (ngày kỷ niệm ≤ ngày cuối tháng M ⇒ đủ năm; hireDate 29/02 ⇒ kỷ niệm năm không nhuận là 28/02, năm nhuận là 29/02); `seniority = seniorityPerYear × years` (0 nếu < 1 năm), **không** nhân tỉ lệ công (kể cả h = 0, nghỉ việc / lên Admin giữa tháng). Tính bằng **chuỗi `YYYY-MM-DD` thuần** (so sánh năm/tháng/ngày số nguyên), không `Date`, không múi giờ — cùng một hàm ở web và server. Thiếu `hireDate` hoặc `hireDate` **sau ngày cuối kỳ** ⇒ phiếu gắn cờ, chặn phát hành. Biên `hireDate` (`[1950-01-01, hôm nay]`) ở contract hồ sơ (ADR-128).
- `hireDate` đọc qua `payroll/application/ports/hire-date.port.ts` (`hireDates({userIds}) ⇒ Map<userId, LocalDate | null>`, adapter ở module hồ sơ) lúc **tạo nháp / "Tính lại công"**. Hồ sơ không phiên bản ⇒ giá trị hiện hành là giá trị dùng cho kỳ. HR đổi `hireDate` khi bảng còn **NHÁP** ⇒ việc còn lại "Ngày vào công ty đã đổi — tính lại"; sau **PUBLISHED** ⇒ cờ "hồ sơ đã thay đổi sau phát hành" (so `Payslip.hireDate` với giá trị hiện hành), kế toán quyết bản điều chỉnh.
- Đổi `seniorityPerYear` khi bảng còn **NHÁP**: nháp giữ ảnh chụp cũ (`PayrollRun.seniorityPerYear`) tới khi "Tính lại công"; danh sách việc còn lại cảnh báo "Mức thâm niên đã đổi — tính lại". Bảng đã phát hành không đổi.
- Biên: contract ≤ **50 dòng/phiếu** (mỗi dòng ≤ 1e12); `computePayslip` assert `Number.isSafeInteger` cho **mọi tổng** (ném lỗi, không trả số sai).
- `incomeTotal = salaryByDays + seniority + Σ INCOME`; `bonusTotal = Σ BONUS`; `deductionTotal = Σ DEDUCTION`; `netPay = income + bonus − deduction`. Mọi `amount ≥ 0` (dấu do mục quyết định). Tổng do **duy nhất** hàm thuần `computePayslip` sinh (đặt ở **package thuần** dùng chung — web import để xem trước tổng khi gõ; server tính lại và là chuẩn), ghi cùng transaction với dòng; `computePayslip` assert `S ≥ 1`; test parity "đọc lại dòng ⇒ tính lại = tổng đã lưu". `netPay < 0` ⇒ 422 `NEGATIVE_NET_PAY` khi phát hành.
- Dòng thâm niên do hệ thống tính (kế toán không gõ, không sửa trên phiếu); nhãn các dòng còn lại kế toán gõ tay (`label` bắt buộc, ≤120).
- Phiếu `PUBLISHED` bất biến (use case + trigger DB chặn UPDATE cột tiền khi bảng đã phát hành). Sai ⇒ **bản điều chỉnh**: trong một transaction, `UPDATE … SET superseded_at WHERE superseded_at IS NULL` (đếm 1, không thì 409) rồi INSERT `revision+1` (copy bản cũ, kế toán sửa, lý do bắt buộc — **nhân viên xem được lý do**). Partial unique một bản hiệu lực.
- Mọi số trên phiếu là **ảnh chụp** (gồm `hireDate`, `seniorityYears`, `seniorityPerYear`, `seniorityAllowance`, tên người lĩnh, tên công ty lúc phát hành) — không phụ thuộc hồ sơ, cấu hình hay chấm công về sau.

**ADR-126 — Công tính lương: hàm theo nửa ngày ở module attendance.** Không suy từ `presentDays + leaveDays` (đếm trùng nửa ngày, không có loại phép, bỏ qua lễ). Hàm thuần `payrollDaysOf(days, leaves, scheduleVersions, tenures)` cạnh `totalsOf` (cùng ô ngày của `summarizeRange`), payroll gọi qua port; trả **số nguyên nửa ngày** `h`. Mỗi ngày xét 2 nửa AM/PM, mỗi nửa 0 hoặc 1, **trần 2 nửa/ngày**:
- Nửa = 1 nếu nửa đó có **đi làm hợp lệ** (ngày PRESENT = có IN+OUT hợp lệ: các nửa không có phép, đủ nửa dù làm ít giờ; muộn/sớm không trừ) **hoặc** có **phép loại có lương** (ANNUAL, PERSONAL_PAID) ở nửa đó.
- **Phép thắng lượt chấm:** nửa có phép đã duyệt lấy theo loại phép, bỏ qua lượt chấm ở nửa đó — phép cả ngày UNPAID mà vẫn chấm công ⇒ 0 (HR thu hồi đơn nếu thực tế đi làm; 1 dòng hướng dẫn ở màn duyệt phép/bảng công: "Đã chấm công nhưng có đơn nghỉ không lương — thu hồi đơn nếu nhân viên đi làm").
- **Một nguồn phép:** dùng **cùng một lần đọc** phép (có `type`) cho cả ô ngày và các nửa — `summarizeUsers` nhận sẵn danh sách phép do payroll đọc, hoặc `payrollDaysOf` tự suy nửa từ danh sách typed và chỉ dùng `status`/`employed` của ô ngày. Dòng trùng (cùng ngày, cùng nửa) không cộng hai lần; tổng ≤ 2 nửa/ngày.
- Nửa = 0 nếu phép **không lương** (SICK, UNPAID, OTHER) hoặc vắng. Ví dụ: PRESENT + AM UNPAID ⇒ 1 nửa; PRESENT + AM ANNUAL ⇒ 2; ABSENT + AM ANNUAL ⇒ 1.
- **MISSING_OUT** chỉ làm mất phần đi làm; nửa phép có lương của ngày đó vẫn giữ (nghỉ AM ANNUAL + chiều quên chấm ra ⇒ 1 nửa = 0,5 ngày).
- HOLIDAY rơi vào ngày làm việc (theo `isWorkday(effectiveSchedule(versions, date), date)`, không theo status) và trong nhiệm kỳ ⇒ 2.
- **Nhiệm kỳ** = `ICompanyTenurePort` (attendance, `company-level.md` ADR-133/136): các đoạn `{from, until}` **bằng ngày** của thời gian có role EMPLOYEE (`company_members.start_date` + `company_member_departures.first_day/last_day`, gồm `ROLE_CHANGED` khi nâng/hạ Admin). Ngoài mọi đoạn ⇒ 0 (lọc cứng, kể cả có lượt chấm — IN ngoài nhiệm kỳ đã bị chặn 422 `NOT_EMPLOYED`, nhưng ADJUSTMENT/dữ liệu cũ vẫn có thể có); OFF/Chủ nhật ⇒ 0.
- Ngày quá hạn retention chấm công ⇒ lỗi 422 `ATTENDANCE_RETENTION_EXPIRED` (không trả số thiếu).
- Port `ApprovedLeavePort` cho payroll trả `{date, part: AM|PM, type}[]` (phép cả ngày = 2 dòng; không `workspaceId`); `payrollDaysOf` phải chịu **2 dòng/ngày khác loại** (AM ANNUAL + PM UNPAID ⇒ 1 nửa phép có lương). Gộp AM+PM ở attendance đã sửa ở **T-052** (main f191b48).
- SICK = 0 công vì BHXH chi trả — phiếu nhân viên hiện ghi chú này khi tháng có ngày SICK.

**Công chuẩn** `S` = đếm **từng ngày** của tháng theo `effectiveSchedule(versions, date)` của **lịch công ty** (một bộ lịch + lễ + múi giờ — ADR-136; đổi lịch giữa tháng ⇒ tổng hai đoạn), gồm ngày lễ rơi vào ngày làm; ảnh chụp vào `PayrollRun.standardDays` — cùng `S` cho mọi người, kể cả người vào / nghỉ / lên Admin giữa tháng (công của họ chỉ đếm ngày trong nhiệm kỳ). Trần `h ≤ 2S`, áp **sau** khi sửa tay; phiếu hiện "công thực tế / công chuẩn" ("21,5 / 22 ngày").

**Lễ rơi vào CN/OFF (N2):** hệ thống không tự bù. HR tự nhập ngày nghỉ bù vào lịch lễ công ty; màn lịch lễ cảnh báo "Ngày dd/mm rơi vào ngày nghỉ — nếu có nghỉ bù, thêm ngày bù vào lịch lễ" + 1 dòng hướng dẫn HR.

**ADR-127 — Thời điểm lấy số.** Chỉ tạo nháp khi tháng M đã kết thúc theo giờ nghiệp vụ + múi giờ lịch công ty. **Người trong kỳ** = mọi user có một đoạn nhiệm kỳ EMPLOYEE **giao** tháng M (đang làm, đã nghỉ trong tháng, lên Admin trong tháng — Admin hiện tại chỉ có phiếu nếu còn đoạn EMPLOYEE trong M). Nháp có **"Tính lại công"** (giữ override có lý do; có **preview số người thay đổi** trước khi áp) và **"Thêm người còn thiếu"**; người thiếu hồ sơ lương hoặc thiếu `hireDate` vẫn có dòng, gắn cờ, chặn phát hành; còn MISSING_OUT ⇒ cảnh báo khi phát hành. Kỳ có ngày quá hạn retention ⇒ **cấm "Tính lại công"** (422 `ATTENDANCE_RETENTION_EXPIRED`); bản điều chỉnh **copy `paidHalfDays` của bản trước**, không tính lại. Ràng buộc gửi **R27**: retention chấm công ≥ thời gian còn được điều chỉnh phiếu lương. Sau phát hành mà bảng công tháng đó đổi (ADJUSTMENT cho người đã nghỉ trong nhiệm kỳ cũ cũng được — ADR-136) ⇒ đánh dấu "công đã thay đổi sau phát hành" cho kế toán (không tự sửa phiếu). Mọi lệnh ghi lên bảng tháng M lấy khóa `taskflow:payroll:<period>` (bậc theo bảng thứ tự khóa toàn cục của `company-level.md` ADR-136: sau `authorizeCompanyWrite`), kiểm `status = DRAFT` trong khóa; phát hành = `UPDATE … WHERE status = 'DRAFT'` (đếm 1). Tạo nháp idempotent (unique `(period)`). Toàn bộ theo `businessClock`.

## 3. Dữ liệu (migration 7 — sau 5 `company_level`, 6 hồ sơ)

```
-- CompanyGrant.PAYROLL_MANAGE đã có từ migration 5 (company_level)
enum PayrollRunStatus     { DRAFT PUBLISHED }
enum PayslipSection       { INCOME BONUS DEDUCTION }

payroll_settings (id SMALLINT PK CHECK (id = 1), seniority_per_year BIGINT 0..1e12 DEFAULT 500000,
                  version, updated_by_id? → users Restrict, updated_at)
                  — một dòng, module payroll sở hữu; migration INSERT (1, 500000); đổi có audit
SalaryProfile (id, userId → users Restrict, effectiveFrom YYYY-MM (CHECK), level ≤32, baseSalary BIGINT > 0,
               createdBy, createdAt)                                  @@unique(userId, effectiveFrom)
               — chỉ level + lương cơ bản (hireDate ở EmployeeProfile — ADR-128)
PayrollRun    (id, period YYYY-MM (CHECK), status, standardDays 1..31 (ảnh chụp),
               seniorityPerYear BIGINT (ảnh chụp lúc tạo/tính lại nháp), companyName (ảnh chụp lúc phát hành)?,
               publishedAt?, publishedBy?, createdBy, timestamps)     @@unique(period)
Payslip       (id, runId, userId, revision ≥1, lockVersion, fullName, level, baseSalary,
               hireDate?, seniorityYears 0..80, seniorityAllowance BIGINT ≥ 0,
               paidHalfDays 0..62, overrideHalfDays?, overrideReason?, revisionReason?,
               salaryByDays, incomeTotal, bonusTotal, deductionTotal, netPay, note? ≤1000,
               supersededAt?, timestamps)
               UNIQUE (runId, userId, revision); UNIQUE (runId, userId) WHERE superseded_at IS NULL
               CHECK netPay = incomeTotal + bonusTotal − deductionTotal; các số ≥ 0 trừ netPay
               CHECK revision = 1 OR revisionReason IS NOT NULL
PayslipLine   (id, payslipId, section, label ≤120 (gõ tay), amount BIGINT 0..1e12, sortOrder)
               — contract ≤ 50 dòng/phiếu
```
Không cột `companyId` (`company-level.md` ADR-133 — một công ty; nếu sau này chung DB thì thêm cột vào đúng các bảng này). Dòng thâm niên **không** là `PayslipLine` — là cột `seniorityAllowance` (hệ thống tính), hiển thị như một dòng trong mục (1). FK `userId → users Restrict` (giữ phiếu của người đã nghỉ). Mọi bảng payroll + audit `PAYROLL_*` **nằm ngoài** mọi bước retention hiện có (có test khẳng định); thời hạn riêng `RETENTION_PAYROLL_DAYS` (đề xuất 10 năm — chốt cùng R27, kèm ràng buộc retention chấm công ở ADR-127).

## 4. Luồng

1. Hồ sơ lương: nhập/đổi theo phiên bản từ tháng X (level, lương cơ bản); lịch sử phiên bản xem được. Ngày vào công ty hiện **chỉ đọc** từ hồ sơ nhân viên.
2. Tạo bảng tháng M (sau khi M kết thúc): mỗi người có nhiệm kỳ EMPLOYEE giao M có phiếu nháp, ảnh chụp hồ sơ lương + `hireDate` + công (ADR-126) + thâm niên tự tính.
3. Kế toán gõ tay từng dòng: thưởng từng kênh, thưởng khác, bảo hiểm, thuế, đã ứng, ghi chú (`lockVersion` ⇒ 409 nếu 2 người sửa cùng phiếu). Lưu theo phiếu.
4. Phát hành: modal xác nhận (§5.2) → khóa bảng; thông báo `PAYSLIP_PUBLISHED` (không số tiền, link `/payslips/YYYY-MM`) qua outbox sau commit.
5. Nhắc `PAYROLL_REMINDER` từ ngày 5 (giờ lịch công ty) mỗi ngày tới khi phát hành, kể cả quá ngày 10, tới người đang có `payroll:manage` (gồm Admin); job có advisory lock + chống lặp theo `(period, ngày)`.
6. Bản điều chỉnh: như ADR-125/127; thông báo nhân viên (link tới tháng đó).

## 5. Màn hình & UX (E)

Tiền `7.000.000 ₫` (NBSP), `white-space: nowrap` + `font-variant-numeric: tabular-nums` mọi chỗ. Ví dụ số trong spec/test là số bịa.

### 5.1 Nhân viên — Phiếu lương của tôi

- `/payslips` **mở thẳng phiếu mới nhất**; nút **‹ tháng trước / tháng sau ›**; danh sách các tháng bên dưới. URL từng tháng `/payslips/YYYY-MM` (thông báo trỏ vào đây). Lối tắt "Phiếu lương" ở `/w` (`company-level.md` ADR-139) — **Admin không có** lối tắt / trang này (route self ⇒ 403).
- Trạng thái rỗng bằng lời, không mã lỗi: "Phiếu lương tháng 9 sẽ có trước ngày 10/10".
- Thẻ **"Tổng thực lĩnh"** ở đầu phiếu mọi cỡ màn; bên dưới là bảng đầy đủ, **không accordion**. Bố cục theo mẫu: đầu phiếu căn giữa (**TÊN CÔNG TY** in hoa đậm · "PHIẾU LƯƠNG NHÂN VIÊN" · "Tháng MM năm YYYY"), một bảng 2 cột (nhãn | số tiền canh phải) có viền; mỗi mục có dòng tiêu đề nền xám, tổng mục ở cột phải; dòng 0/trống in "—"; "Tổng thực lĩnh (4) = (1)+(2)−(3)" nền vàng nhạt + viền đậm; Ghi chú cuối. Công hiện "21,5 / 22 ngày"; dòng thâm niên hiện "Phụ cấp thâm niên (N năm)"; tháng có SICK ⇒ ghi chú "Ngày nghỉ ốm không tính công vì do BHXH chi trả".
- Bản điều chỉnh: dải "Đã điều chỉnh lần N ngày dd/mm" + **lý do** (nhân viên xem được). Bản cũ ở trang riêng, nhãn **"BẢN CŨ — đã được thay thế"** hiện cả khi in.
- Link "Xem chấm công tháng N" tới `/attendance` (tháng đó).
- Nút **"In / Lưu PDF"** + 1 dòng hướng dẫn ("chọn 'Lưu dưới dạng PDF' trong hộp in"); `@media print`: A4, ẩn điều hướng, luôn nền trắng chữ đen, `break-inside: avoid`, title in = `Phieu-luong-YYYY-MM` (không tên).
- A11y: `<table>` thật, nhãn dòng là `<th scope="row">`, "—" có nhãn đọc "0 đồng".
- `<title>` tab: "Phiếu lương tháng 9/2026" — không tiền, không tên.
- Cảnh báo trên thẻ/trang chấm công: "Ngày dd/mm chưa chấm ra — chưa được tính công, báo HR bổ sung trước ngày 5".

### 5.2 Kế toán — Bảng lương (chỉ `payroll:manage`)

- Đường dẫn: `/payroll` (danh sách tháng) → `/payroll/YYYY-MM` (bảng tháng) → `/payroll/YYYY-MM/[userId]` (form 1 người = **bố cục phiếu nhân viên với ô nhập**); `/payroll/profiles` (hồ sơ lương, có **lịch sử phiên bản**; cột "Ngày vào công ty" **chỉ đọc** + "HR sửa ở Nhân sự → Nhân viên"; ô mức thâm niên/năm của công ty). Vào từ khối "Việc quản lý" ở `/w` và menu header "Bảng lương" (`company-level.md` ADR-139).
- **Mobile (U1):** 360 px: bảng nhiều người là **danh sách thẻ** (tên · công · thực lĩnh · trạng thái), bấm mở form 1 người; form xếp dọc từng dòng, ô tiền lớn. **Không lưới nhiều cột trên mobile.** Desktop: bảng, cột tên dính trái.
- Đầu bảng tháng = **danh sách việc còn lại**: hạn (ngày 10), người thiếu hồ sơ lương, thiếu ngày vào công ty / ngày vào công ty sau kỳ (link tới hồ sơ nhân viên nếu có `hr:manage`, không thì "Báo HR bổ sung"), "Ngày vào công ty đã đổi — tính lại", ngày quên chấm ra (MISSING_OUT), "Mức thâm niên đã đổi — tính lại". Nút Phát hành bị chặn thì **ghi rõ lý do**.
- Nhập dòng: nhãn gõ tay (U2; autocomplete nhãn đã dùng trong công ty — tùy chọn); dòng thâm niên chỉ đọc "Hệ thống tính theo ngày vào công ty". Ô tiền `inputMode="numeric"`, tự chèn dấu chấm nghìn, hiểu dán "7,000,000"/"7.000.000", không gõ dấu trừ. Tổng xem trước bằng `computePayslip` (package thuần).
- **Lưu theo phiếu** (không autosave), cảnh báo khi rời trang có thay đổi chưa lưu; 409 ⇒ giữ số đã gõ + nút "Tải bản mới".
- Sửa công: bước 0,5 ngày, lý do bắt buộc.
- "Tính lại công": gọi endpoint **preview** ("N người thay đổi công") rồi mới áp; kỳ quá hạn retention ⇒ nút mờ + lý do.
- Modal phát hành: tóm tắt số phiếu + tổng thực lĩnh + cảnh báo MISSING_OUT + ô tick **"Tôi đã kiểm tra"** bắt buộc.
- Dòng của chính kế toán: chỉ đọc, "Phiếu của bạn — Kế toán khác hoặc Admin sửa".
- Tạo bản điều chỉnh: form điền sẵn từ bản hiện hành, lý do bắt buộc, **xem khác biệt** trước khi gửi.
- Tháng chưa kết thúc: nút tạo bảng mờ "tạo được từ 01/11".
- **Xuất Excel (.xlsx)** — TL chốt 18/10, thay CSV: dùng `ISpreadsheetWriter` / `sendXlsx` (bộ ghi tự viết trên `fflate`, T-055 — `hr-extended.md` ADR-130) ⇒ đóng rủi ro Excel locale vi-VN dùng ";" làm phân cách và BOM; D/F kiểm chứng trên Excel thật.

### 5.3 Điều hướng, cache, riêng tư

- "Phiếu lương" (nhân viên; lối tắt `/w`) / "Bảng lương" (`payroll:manage`; menu header + "Việc quản lý"). Thẻ chấm công `/w` không đổi bố cục (E2E-HR-14 / E2E-HR-15 vẫn xanh).
- Cache key `['company', 'payroll', …]` / `['company', 'payslips', …]` (gốc `['company', …]` — ADR-139); xóa khi nhận `company:access-changed` mất `payroll:manage` và khi đăng xuất / 401 `SESSION_REVOKED`. Trang lương `no-store`. Không số tiền trong URL/localStorage/title.

## 6. Bảo mật & riêng tư (B)

- Phiếu người khác ⇒ 404; chỉ `hr:manage` ⇒ 403 mọi route lương; Admin gọi route self (`/payslips…`) ⇒ 403; người không thuộc công ty / hết `access_until` ⇒ 401 `SESSION_REVOKED` (`loadCompanyMember`); route lương `Cache-Control: no-store` (cả trang Next, không ISR).
- Không số tiền trong thông báo, log, URL, Sentry (redact body route `/payroll`, `/payslips`, `/salary-profiles`, `/payroll-settings`; SEC test ném lỗi giữa chừng ⇒ không lộ). Audit before/after số tiền (mức thâm niên/năm, hồ sơ lương), **chỉ Admin đọc** (`GET hr/audit-logs`, `company:admin`); audit VIEW/EXPORT. Đổi `hireDate` là `PROFILE_SET` (ADR-128).
- Xuất .xlsx (ADR-130): ô tiền là ô SỐ nguyên (không `'`, không ₫ — tổng khớp `computePayslip`); nhãn/ghi chú là chuỗi nguyên văn + `quotePrefix` khi bắt đầu bằng `= + - @` TAB CR (nhãn gõ tay ⇒ bắt buộc); không công thức, không hyperlink; chỉ bản hiệu lực + cột revision; no-store, audit `EXPORT` khi stream bắt đầu, hạn mức chung.
- Phiếu giữ tên khi ẩn danh tài khoản (nghĩa vụ chứng từ) — ghi vào data-retention. Backup chứa lương ⇒ xác nhận mã hóa + giới hạn truy cập (threat-model; R37: Admin toàn quyền lương — nhiều Admin, audit).

## 7. Test bắt buộc (F)

- **PD** `payrollDaysOf` (nửa ngày): PRESENT không phép = 2; PRESENT + AM ANNUAL = 2; PRESENT + AM UNPAID = 1; ABSENT + AM ANNUAL = 1; MISSING_OUT + AM ANNUAL = 1; MISSING_OUT không phép = 0; 2 dòng/ngày AM ANNUAL + PM UNPAID; phép cả ngày SICK/UNPAID/OTHER = 0; HOLIDAY ngày làm = 2, HOLIDAY rơi CN/OFF = 0; ngoài nhiệm kỳ = 0 kể cả có lượt chấm; **nhiệm kỳ bằng ngày: ngày `last_day` tính, ngày sau = 0; ngày `start_date` tính, ngày trước = 0**; trần 2 nửa/ngày; **tổng ≤ 2 nửa/ngày kể cả dòng phép trùng**; PRESENT ít giờ / đi muộn / về sớm = 2; **phép cả ngày UNPAID + có IN+OUT = 0** (phép thắng lượt chấm); ô ngày và các nửa dùng cùng một danh sách phép typed; ngày quá retention ⇒ `ATTENDANCE_RETENTION_EXPIRED`.
- **SD** công chuẩn: **đổi lịch công ty giữa tháng** ⇒ tổng hai đoạn; lễ trừ đúng; `S ≥ 1` assert; cùng `S` cho người vào/nghỉ giữa tháng.
- **PE** người trong kỳ (company-level CO-08/09): **Admin không có phiếu**; nâng EMPLOYEE→ADMIN ngày 15 ⇒ có phiếu tháng đó, công chỉ đếm 1..15; hạ ADMIN→EMPLOYEE ngày 20 ⇒ phiếu tháng đó công đếm từ 21; nghỉ việc `last_day` = ngày cuối tháng ⇒ không có phiếu tháng sau; nhận lại ⇒ tháng giữa không có phiếu; "Thêm người còn thiếu" thấy người mới có đoạn EMPLOYEE giao kỳ.
- **SN** thâm niên: < 1 năm = 0; tròn năm đúng ngày cuối tháng ⇒ tính cả tháng; tròn năm ngày 1 tháng sau ⇒ chưa; hireDate 29/02 với kỳ **02/2025** (kỷ niệm 28/02) và **02/2028** (29/02); hireDate 31/01 (kỳ tháng 2/tháng 4); hàm thuần chuỗi chạy giống nhau ở mọi múi giờ; hireDate sau ngày cuối kỳ ⇒ cờ chặn phát hành; đổi `seniorityPerYear` khi **nháp** ⇒ nháp giữ số cũ + cảnh báo tới khi Tính lại công; đổi sau phát hành ⇒ phiếu cũ không đổi; **HR đổi `hireDate` khi nháp ⇒ cảnh báo tính lại; đổi sau PUBLISHED ⇒ cờ "hồ sơ đã thay đổi sau phát hành", phiếu không đổi**; thiếu `hireDate` ⇒ chặn phát hành; không chia theo công gồm **h = 0**, **nghỉ việc giữa tháng**, **lên Admin giữa tháng**.
- **PR** `computePayslip`: half-up một lần; parity đọc lại = tổng lưu; biên `2·1e12·62` an toàn; **51 dòng ⇒ 422**; 50 dòng × 1e12 + thâm niên lớn ⇒ tổng vẫn `isSafeInteger` hoặc assert ném lỗi (không trả số sai); `NEGATIVE_NET_PAY`; cùng kết quả ở web và server.
- **RD/CC/CLK**: tạo nháp idempotent (unique `(period)`), khóa `taskflow:payroll:<period>`, phát hành đếm 1, 409 lockVersion, điều chỉnh đếm 1; kỳ quá retention ⇒ cấm Tính lại công, điều chỉnh copy `paidHalfDays`; preview Tính lại công khớp kết quả áp; nhắc chống lặp theo `(period, ngày)`; mọi mốc theo `businessClock`.
- **SP/SEC**: luật self tuyệt đối của Kế toán (phiếu / hồ sơ lương / sửa công của chính mình ⇒ 403; Kế toán khác hoặc Admin ⇒ được); parity grant công ty (SEC-HR-34); Admin gọi `/payslips` ⇒ 403; HR ⇒ 403 mọi route lương; người đã nghỉ ⇒ 401 `SESSION_REVOKED`; 404 phiếu người khác; redact; payroll ngoài retention; `payroll_settings` chỉ một dòng (CHECK `id = 1`).
- **E2E**: nhân viên mở thẳng phiếu mới nhất + ‹ › ; đầu phiếu in tên công ty; kế toán nhập trọn 1 phiếu ở **360 px** (thẻ → form); modal phát hành bắt tick; **đăng xuất → Back không thấy số**; in có nhãn "BẢN CŨ"; Admin không thấy lối tắt "Phiếu lương"; E2E-HR-14/15 vẫn xanh.

## 8. Chia việc (sau khi duyệt)

| Vé | Ai | Nội dung | Phụ thuộc |
|---|---|---|---|
| T-048 | B | Migration 7 (`payroll_settings` một dòng, `SalaryProfile` không `hireDate`, `PayrollRun`/`Payslip`/`PayslipLine`, ảnh chụp thâm niên + tên công ty, CHECK, partial unique, trigger) + luật self tuyệt đối của Kế toán qua `authorizeCompanyWrite` + audit `PAYROLL_*` (chỉ Admin đọc) + loại khỏi retention + redact route mới | Mốc 3.5 (T-061…T-064) đã vào `main`; T-054 (migration 6) |
| T-049 | A | `payrollDaysOf` nửa ngày (phép thắng lượt chấm; **một lần đọc phép typed** cho cả ô ngày và các nửa) + port phép `{date, part, type}` + công chuẩn theo `effectiveSchedule` từng ngày + nhiệm kỳ ngày từ `ICompanyTenurePort` + `ATTENDANCE_RETENTION_EXPIRED`; package thuần `computePayslip` (thâm niên chuỗi ngày thuần, assert `isSafeInteger`, ≤ 50 dòng ở contract); module payroll: port `hire-date` (đọc `EmployeeProfile`), hồ sơ lương/phiên bản, `payroll_settings` (cảnh báo nháp cần tính lại), nháp/tính lại (+ endpoint preview)/thêm người (người trong kỳ = đoạn EMPLOYEE giao kỳ), phát hành, điều chỉnh (copy công khi quá retention), cờ "hồ sơ đã thay đổi sau phát hành", nhắc, xuất .xlsx (`ISpreadsheetWriter`) | T-048; T-063 (tenure ngày); T-054 (port `hireDate`) |
| T-050 | E | Web theo §5: `/payslips` (mở mới nhất, ‹ ›, in, a11y, tên công ty), `/payroll/…` desktop + thẻ/form 360 px, danh sách việc còn lại, modal phát hành, điều chỉnh có diff, hồ sơ lương + lịch sử (`hireDate` chỉ đọc), menu header + "Việc quản lý", cache `['company', …]`; cảnh báo MISSING_OUT trên thẻ/trang chấm công; cảnh báo lễ rơi CN/OFF ở lịch lễ; dòng hướng dẫn HR "đã chấm công nhưng có đơn nghỉ không lương — thu hồi đơn" | T-048 contracts; Mốc 3.5 web (T-065) |
| T-051 | F | test-spec-payroll theo §7 (PD/SD/PE/SN/PR/RD/SP/SEC/CC/CLK/E2E), harness ADR-140 (Admin bootstrap, `Actors.createUser` có grant Kế toán), Stryker domain payroll + `payrollDaysOf` ≥ 90 %; kiểm chứng .xlsx trên Excel vi-VN cùng D | song song |
| — | D | Review tiền/khóa (bậc khóa `payroll:<period>` trong bảng thứ tự khóa toàn cục) + CI; cùng F kiểm .xlsx | — |

Thứ tự: Mốc 3.5 → Mốc 5 (ít nhất T-054 hồ sơ) → T-048 → T-049 ‖ T-050 → T-051 E2E. Migration: 5 `company_level` · 6 hồ sơ · **7 payroll** · 8 đơn bổ sung · 9 chính sách phép (`company-level.md` §8, timestamp đặt lúc merge).

Ước tính: 4–5 ngày làm việc của cả đội (tăng do mobile + nửa ngày + thâm niên tự động; giảm nhẹ vì `hireDate` đã ở hồ sơ).
