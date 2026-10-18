# T-049 — Module lương (payroll.md v4) — báo cáo Engineer A

Nhánh `feat/T-049-payroll-domain` @`08a42517` đã gộp vào `feat/m4-payroll` = `039baf4a` (TL, 18/10, cùng
SEC-PAY-14 và T-050). Thiết kế: `docs/design/payroll.md` v4 (ADR-124…127), xuất .xlsx theo `hr-extended.md` ADR-130.
Schema / migration / trigger thuộc T-048 (B).

## Commit

| Nhóm | Commit |
|---|---|
| Toán phiếu thuần (contracts, dùng chung web + API) | `bfbe930f` computePayslip · `2a4534d9` tách `limits.ts` (cắt vòng schemas ↔ math) · `3d9c876d` nhóm Stryker payroll-math |
| Công từ chấm công (attendance) | `cae6c3a4` payrollDaysOf + standardDaysOf · `92f7b577` payrollDaysFor / payrollMembersOf (một lần đọc phép typed) · `88e8e816` ngày ốm (`hasSickDays`) · `1940a299` `20b112ef` PD-13 / PD-17 / PD-19 |
| Thông báo | `53b887d6` người nhận `payroll` (lọc theo `payroll:manage` hiện tại) + ngữ cảnh kỳ phiếu |
| Use case | `cce6dc14` số phiếu từng người + lý do chặn · `13bc9673` store port + in-memory, tạo nháp / tính lại (+ preview) / thêm người / phát hành · `5d7f860d` sửa nháp + bản điều chỉnh · `b32abf4a` cài đặt, hồ sơ lương phiên bản, các màn đọc |
| Prisma + HTTP | `cb9d5df7` PrismaPayrollStore · `c0e1e631` route `/payroll/*` + `/payslips/*`, module, composition, OpenAPI |
| Soát B | `df9e815e` HIGH-1 + L1–L3 |
| Job nhắc | `68d32c39` PayrollReminderUseCase + `notifyOnce`, env test-only |
| Xuất .xlsx + LSP | `87372575` |
| Gộp | `b11551c0` m4 (Mốc 5) · `08a42517` T-048 @`33a58a0a` (m4 `43bfccc0`, Mốc 6, migration `20261102000000_payroll`) |

## Quyết định chính

- **Tiền** là số nguyên đồng, `BigInt` ở DB, đổi sang số an toàn ở biên adapter. `computePayslip` là nguồn duy nhất
  của các tổng. Lương theo công làm tròn half-up đúng một lần.
- **Thâm niên** = mức × số năm tròn từ `hireDate` tới cuối kỳ, không chia tỷ lệ, tối đa 80 năm.
- **Công** tính bằng nửa ngày có lương:
  - phép thắng lượt chấm;
  - lễ rơi vào ngày làm = 2 nửa;
  - lọc theo nhiệm kỳ;
  - kỳ có ngày quá hạn lưu ⇒ 422 `ATTENDANCE_RETENTION_EXPIRED`;
  - kỳ không có ngày làm ⇒ 422 `NO_WORKING_DAYS`.
- **Phát hành**:
  - một lệnh UPDATE có điều kiện;
  - bị chặn ⇒ 422 `PUBLISH_BLOCKED` với `details.blockers` sắp theo userId;
  - `MISSING_OUT` chỉ là cảnh báo.
- **Bản điều chỉnh**: chỉ UPDATE `superseded_at` của bản cũ, rồi INSERT `revision + 1` đã tính đủ. Trigger của T-048
  chặn mọi thay đổi khác.
- **Khóa** `taskflow:payroll:<period>` lấy SAU `authorizeWrite(payroll:manage)`. Kế toán tự xử lý phiếu của mình ⇒ 403
  (luật self).
- **Quyền và lỗi**:
  - `/payroll/*` cần `payroll:manage`; `/payslips/*` cần `payslip:self` (Admin ⇒ 403);
  - quyền được kiểm trước validate;
  - thông báo lỗi không bao giờ chứa số tiền (HIGH-1).
- **Audit** dùng `PAYROLL_*`; lý do nằm ở `after.note`, không có khóa `reason`. VIEW phiếu và EXPORT đều có audit.
- **Job nhắc**:
  - từ ngày 5 (giờ lịch công ty), nhắc kỳ tháng trước mỗi ngày, kể cả quá ngày 10, tới khi bảng của kỳ đó PUBLISHED;
  - chưa có bảng vẫn nhắc;
  - chống lặp bằng khóa `reminder:<kỳ>` + `notifyOnce` theo `refId` tất định của ngày, không cần bảng mới;
  - actor = hệ thống;
  - env `PAYROLL_REMINDER_ON_START` / `_INTERVAL_MS` chỉ hợp lệ khi APP_ENV=test.
- **Xuất .xlsx** `GET payroll/runs/:period/export.xlsx`, thứ tự B chốt:
  - quyền → validate → `EXPORT_RATE_LIMIT` → chốt quyền → `ExportSlots` (dùng chung với bảng công / phép) → một
    snapshot: 404 / `EXPORT_TOO_LARGE` → audit `PAYROLL_EXPORT` (`outside`) → header → stream;
  - nội dung chỉ gồm bản hiệu lực, có cột "Bản";
  - ô tiền là số nguyên, ngày vào công ty là ô ngày (`xlsxDate`);
  - KHÔNG xuất lý do sửa công / lý do điều chỉnh (có thể nhắc sức khỏe).
- **Composition**:
  - `apiRouters` tách khỏi container (max-lines);
  - hồ sơ nhân viên dựng trong `wireLeaveAndProfile` (Mốc 5), lương nhận `hrProfile` từ đó.

## Ngoài phạm vi

- Schema, migration, trigger, `payslip:self`, `payroll-schema.int.ts`, SEC-PAY-14: T-048 / B.
- Web và E2E Mốc 4: T-050 (E / H).
- Đặc tả test: T-051 (F).
- Kiểm file .xlsx trên Excel vi-VN thật: D + F.
- B L1 (không chặn): kiểm quyền trong `PayrollQueries` cho bên gọi ngoài route. Hiện chỉ route gọi, và route đã
  `permit`.

## Kết quả kiểm (trên `08a42517`)

- tsc contracts / api / web, eslint, prettier, depcruise (api 757 module): sạch. Hook commit đầy đủ.
- Unit: api 2494/2494; contracts + web 210/210. Riêng phần xuất bảng lương: 5 ca gồm thứ tự snapshot / outside /
  send, 404, 422 trước send, 403 / 429 không audit, stream lỗi vẫn còn audit và vẫn nhả suất.
- Integration (Postgres thật, DB riêng `taskflow_t049b`, đã drop):
  - `payroll-schema.int.ts` (B): 8/8;
  - 4 file LSP chạy lại test use case lương trên `PrismaPayrollStore` + PrismaUnitOfWork: 21/21;
  - `notifications-persistence`: 9/9.
- Chưa chạy: Stryker payroll-math (đã cấu hình `3d9c876d`, ngưỡng 90 %) — chờ lượt máy.

## Việc còn lại

1. Stryker payroll-math (A, cần lượt máy).
2. D + F kiểm `bang-luong-<kỳ>.xlsx` trên Excel vi-VN (ô tiền là số, nhãn bắt đầu bằng `=` hiển thị đúng chữ).
3. Hai tiến trình vitest mồ côi của lượt integration hỏng đầu tiên (PID 21140 / 36828, worktree T-024). Lượt đó treo
   do vòng import `vi.mock` ↔ backend Prisma, đã sửa bằng `payroll-fixture.ts`. Chúng chỉ giữ khóa của DB đã xóa +
   Valkey db 13. Người dùng quyết định tắt (lệnh kill của A bị từ chối).
