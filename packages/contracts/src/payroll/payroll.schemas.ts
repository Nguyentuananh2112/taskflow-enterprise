import * as z from 'zod';

import { YearMonth } from '../attendance/attendance.schemas';
import { DateOnly, IsoDateTime, singleLineText, Uuid } from '../common';
import { MAX_PAYSLIP_LINES, PAYSLIP_SECTIONS } from './limits';

// Mốc 4 — phiếu lương cấp công ty (docs/design/payroll.md v4, ADR-124…127; T-048 contract). Quyền: `payroll:manage`
// (Kế toán + Admin) cho mọi route `payroll/*`; route nhân viên `payslips/*` chỉ EMPLOYEE (Admin ⇒ 403). Luật self tuyệt
// đối với Kế toán (ADR-124): hồ sơ lương / phiếu / bản điều chỉnh của chính mình ⇒ 403. Mọi body `.strict()`.
//
// Route (OpenAPI thêm cùng code T-048/T-049 — parity A2 đòi router thật):
//   GET  payroll/settings · PUT payroll/settings
//   GET  payroll/salary-profiles · POST payroll/salary-profiles/:userId
//   GET  payroll/runs · POST payroll/runs/:period · GET payroll/runs/:period
//   POST payroll/runs/:period/recalculate/preview · POST …/recalculate · POST …/add-missing · POST …/publish
//   GET  payroll/runs/:period/export.xlsx
//   GET  payroll/runs/:period/payslips/:userId · PUT …/payslips/:userId · POST …/payslips/:userId/revisions
//   GET  payslips · GET payslips/:period · GET payslips/:period/revisions/:revision

// ---------------------------------------------------------------- số

/** ADR-125: số nguyên VND, không float; `Number.isSafeInteger` ở biên. */
export const MoneyVnd = z.int().min(0).max(1e12);
export type MoneyVnd = z.infer<typeof MoneyVnd>;

/** Thực lĩnh có thể ÂM trên NHÁP (chặn phát hành — `NEGATIVE_NET_PAY`); phiếu đã phát hành luôn ≥ 0. */
export const SignedMoneyVnd = z.int().min(-1e13).max(1e13);

/** Kỳ lương `YYYY-MM` (cùng mẫu tháng của chấm công). */
export const PayrollPeriod = YearMonth;
export type PayrollPeriod = z.infer<typeof PayrollPeriod>;

/** Công: số nguyên NỬA ngày (ADR-126) — 0..62. */
export const HalfDays = z.int().min(0).max(62);

const PersonRef = z.object({ id: Uuid, fullName: z.string() });

export const PayrollPeriodParams = z.strictObject({ period: PayrollPeriod });
export const PayslipParams = z.strictObject({ period: PayrollPeriod, userId: Uuid });
export const SalaryProfileParams = z.strictObject({ userId: Uuid });
export const MyPayslipParams = z.strictObject({ period: PayrollPeriod });
export const MyPayslipRevisionParams = z.strictObject({
  period: PayrollPeriod,
  revision: z.coerce.number().int().min(1).max(1000),
});
export type PayrollPeriodParams = z.infer<typeof PayrollPeriodParams>;
export type PayslipParams = z.infer<typeof PayslipParams>;
export type SalaryProfileParams = z.infer<typeof SalaryProfileParams>;
export type MyPayslipParams = z.infer<typeof MyPayslipParams>;
export type MyPayslipRevisionParams = z.infer<typeof MyPayslipRevisionParams>;

// ---------------------------------------------------------------- cài đặt (payroll_settings — một dòng)

export const PayrollSettingsDto = z.object({
  /** Phụ cấp thâm niên / năm tròn (mặc định 500 000). */
  seniorityPerYear: MoneyVnd,
  version: z.int().min(1),
  updatedAt: IsoDateTime,
  /** null = giá trị migration (chưa ai đổi). */
  updatedBy: PersonRef.nullable(),
});
export type PayrollSettingsDto = z.infer<typeof PayrollSettingsDto>;

/** `PUT payroll/settings` — đổi khi có bảng NHÁP ⇒ việc còn lại `SENIORITY_RATE_CHANGED` (nháp giữ ảnh chụp cũ). */
export const PutPayrollSettingsBody = z.strictObject({
  seniorityPerYear: MoneyVnd,
  expectedVersion: z.int().min(1),
});
export type PutPayrollSettingsBody = z.infer<typeof PutPayrollSettingsBody>;

// ---------------------------------------------------------------- hồ sơ lương (phiên bản theo tháng)

export const SalaryLevel = singleLineText(1, 32);

export const SalaryProfileVersionDto = z.object({
  id: Uuid,
  /** Áp từ kỳ này (gồm cả kỳ này). */
  effectiveFrom: PayrollPeriod,
  level: z.string(),
  baseSalary: MoneyVnd,
  createdBy: PersonRef,
  createdAt: IsoDateTime,
});
export type SalaryProfileVersionDto = z.infer<typeof SalaryProfileVersionDto>;

/**
 * `GET payroll/salary-profiles` — người TỪNG là nhân viên (gồm đã nghỉ còn trong hạn lưu). `hireDate` CHỈ ĐỌC từ hồ sơ
 * nhân viên (ADR-128 — HR sửa). `current` = phiên bản áp cho kỳ hiện tại; `versions` mới nhất trước.
 */
export const SalaryProfileDto = z.object({
  userId: Uuid,
  user: PersonRef,
  hireDate: DateOnly.nullable(),
  current: SalaryProfileVersionDto.nullable(),
  versions: z.array(SalaryProfileVersionDto),
});
export type SalaryProfileDto = z.infer<typeof SalaryProfileDto>;

/** `POST payroll/salary-profiles/:userId` ⇒ 201 phiên bản mới; trùng `effectiveFrom` ⇒ 409; self ⇒ 403. */
export const CreateSalaryProfileVersionBody = z.strictObject({
  effectiveFrom: PayrollPeriod,
  level: SalaryLevel,
  baseSalary: MoneyVnd.min(1),
});
export type CreateSalaryProfileVersionBody = z.infer<typeof CreateSalaryProfileVersionBody>;

// ---------------------------------------------------------------- bảng lương tháng

export const PayrollRunStatus = z.enum(['DRAFT', 'PUBLISHED']);
export type PayrollRunStatus = z.infer<typeof PayrollRunStatus>;

/**
 * Lý do CHẶN phát hành của một phiếu (ADR-125, TL chốt 18/10). Cờ "đã đổi — cần tính lại" chỉ có trên NHÁP.
 * MISSING_OUT KHÔNG chặn (chỉ là việc còn lại / cảnh báo modal).
 */
export const PublishBlockReason = z.enum([
  'NEGATIVE_NET_PAY',
  'MISSING_SALARY_PROFILE',
  'MISSING_HIRE_DATE',
  'HIRE_DATE_AFTER_PERIOD',
  'HIRE_DATE_CHANGED',
  'SENIORITY_RATE_CHANGED',
]);
export type PublishBlockReason = z.infer<typeof PublishBlockReason>;

/** `422 PUBLISH_BLOCKED` — `details.blockers` đủ MỌI phiếu bị chặn + mọi lý do, sắp theo `userId`. */
export const PublishBlockedDetails = z.object({
  rule: z.literal('PUBLISH_BLOCKED'),
  blockers: z.array(z.object({ userId: Uuid, reasons: z.array(PublishBlockReason).min(1) })),
});
export type PublishBlockedDetails = z.infer<typeof PublishBlockedDetails>;

/** Việc còn lại ở đầu bảng tháng (§5.2). `userId` / `date` tùy loại. */
export const PayrollTodoKind = z.enum([
  'MISSING_SALARY_PROFILE',
  'MISSING_HIRE_DATE',
  'HIRE_DATE_AFTER_PERIOD',
  'HIRE_DATE_CHANGED',
  'SENIORITY_RATE_CHANGED',
  'MISSING_OUT',
  'ATTENDANCE_CHANGED_AFTER_PUBLISH',
  'PROFILE_CHANGED_AFTER_PUBLISH',
]);
export type PayrollTodoKind = z.infer<typeof PayrollTodoKind>;

export const PayrollTodoDto = z.object({
  kind: PayrollTodoKind,
  user: PersonRef.nullable(),
  /** MISSING_OUT: ngày công thiếu giờ ra. */
  date: DateOnly.nullable(),
});
export type PayrollTodoDto = z.infer<typeof PayrollTodoDto>;

/** `GET payroll/runs` — mới nhất trước. */
export const PayrollRunSummaryDto = z.object({
  period: PayrollPeriod,
  status: PayrollRunStatus,
  payslipCount: z.int().min(0),
  netTotal: SignedMoneyVnd,
  publishedAt: IsoDateTime.nullable(),
});
export type PayrollRunSummaryDto = z.infer<typeof PayrollRunSummaryDto>;

export const PayrollRunListDto = z.object({
  runs: z.array(PayrollRunSummaryDto),
  /** Kỳ kế tiếp chưa có bảng: `from` = ngày đầu được tạo (tháng đã kết thúc theo giờ nghiệp vụ). */
  next: z.object({ period: PayrollPeriod, from: DateOnly, canCreate: z.boolean() }).nullable(),
});
export type PayrollRunListDto = z.infer<typeof PayrollRunListDto>;

/** Một dòng trong bảng tháng — số tiền chỉ `netPay` (chi tiết ở phiếu). */
export const PayrollRunPayslipRowDto = z.object({
  user: PersonRef,
  /** Công đang tính = `overrideHalfDays ?? paidHalfDays`, trần 2S. */
  countedHalfDays: HalfDays,
  overridden: z.boolean(),
  netPay: SignedMoneyVnd,
  revision: z.int().min(1),
  /** Rỗng = phát hành được (trên NHÁP); PUBLISHED luôn rỗng. */
  blockReasons: z.array(PublishBlockReason),
  /** Phiếu của chính người gọi ⇒ chỉ đọc (luật self). */
  own: z.boolean(),
});
export type PayrollRunPayslipRowDto = z.infer<typeof PayrollRunPayslipRowDto>;

export const PayrollRunDto = z.object({
  period: PayrollPeriod,
  status: PayrollRunStatus,
  /** Công chuẩn S (ngày) — ảnh chụp. */
  standardDays: z.int().min(1).max(31),
  seniorityPerYear: MoneyVnd,
  /** Kỳ có ngày quá hạn lưu chấm công ⇒ "Tính lại công" bị cấm (422 ATTENDANCE_RETENTION_EXPIRED). */
  recalculable: z.boolean(),
  publishedAt: IsoDateTime.nullable(),
  publishedBy: PersonRef.nullable(),
  todo: z.array(PayrollTodoDto),
  payslips: z.array(PayrollRunPayslipRowDto),
});
export type PayrollRunDto = z.infer<typeof PayrollRunDto>;

/** `POST payroll/runs/:period/recalculate/preview` — chưa ghi gì. */
export const RecalculatePreviewDto = z.object({ changedCount: z.int().min(0) });
export type RecalculatePreviewDto = z.infer<typeof RecalculatePreviewDto>;

/** `POST payroll/runs/:period/publish` — modal "Tôi đã kiểm tra" bắt buộc. */
export const PublishPayrollBody = z.strictObject({ confirmed: z.literal(true) });
export type PublishPayrollBody = z.infer<typeof PublishPayrollBody>;

// ---------------------------------------------------------------- phiếu

export const PayslipSection = z.enum(PAYSLIP_SECTIONS);
export type PayslipSection = z.infer<typeof PayslipSection>;

/** Dòng kế toán gõ tay (nhãn bắt buộc); dấu do mục quyết định ⇒ `amount ≥ 0`. Thâm niên KHÔNG phải dòng. */
export const PayslipLineInput = z.strictObject({
  section: PayslipSection,
  label: singleLineText(1, 120),
  amount: MoneyVnd,
});
export type PayslipLineInput = z.infer<typeof PayslipLineInput>;

export const PayslipLineDto = z.object({
  id: Uuid,
  section: PayslipSection,
  label: z.string(),
  amount: MoneyVnd,
});
export type PayslipLineDto = z.infer<typeof PayslipLineDto>;

const payslipEdit = {
  lines: z.array(PayslipLineInput).max(MAX_PAYSLIP_LINES),
  note: z.string().trim().min(1).max(1000).nullable(),
  /** Sửa công (bước nửa ngày); null = theo chấm công. */
  overrideHalfDays: HalfDays.nullable(),
  overrideReason: z.string().trim().min(1).max(500).nullable(),
};
const overrideNeedsReason = (b: {
  overrideHalfDays: number | null;
  overrideReason: string | null;
}) => (b.overrideHalfDays === null) === (b.overrideReason === null);
const OVERRIDE_REASON = {
  error: 'Sửa công cần lý do (và chỉ có lý do khi sửa công)',
  path: ['overrideReason'],
};

/** `PUT payroll/runs/:period/payslips/:userId` — chỉ NHÁP; `lockVersion` lệch ⇒ 409; self ⇒ 403. */
export const PutPayslipBody = z
  .strictObject({ ...payslipEdit, expectedLockVersion: z.int().min(1) })
  .refine(overrideNeedsReason, OVERRIDE_REASON);
export type PutPayslipBody = z.infer<typeof PutPayslipBody>;

/**
 * `POST payroll/runs/:period/payslips/:userId/revisions` — chỉ PUBLISHED: bản `revision + 1` thay bản hiệu lực
 * (`expectedRevision` lệch / đã có bản mới hơn ⇒ 409). Lý do bắt buộc — nhân viên xem được.
 */
export const CreatePayslipRevisionBody = z
  .strictObject({
    ...payslipEdit,
    expectedRevision: z.int().min(1),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(overrideNeedsReason, OVERRIDE_REASON);
export type CreatePayslipRevisionBody = z.infer<typeof CreatePayslipRevisionBody>;

/** Phiếu đầy đủ (kế toán: `GET …/payslips/:userId`; nhân viên: `MyPayslipDto`). Mọi số là ẢNH CHỤP (ADR-125). */
export const PayslipDto = z.object({
  period: PayrollPeriod,
  userId: Uuid,
  fullName: z.string(),
  /** Tên công ty chụp lúc phát hành; NHÁP ⇒ null (web hiện tên hiện hành). */
  companyName: z.string().nullable(),
  status: PayrollRunStatus,
  revision: z.int().min(1),
  lockVersion: z.int().min(1),
  level: z.string().nullable(),
  baseSalary: MoneyVnd.nullable(),
  hireDate: DateOnly.nullable(),
  seniorityYears: z.int().min(0).max(80),
  seniorityPerYear: MoneyVnd,
  seniorityAllowance: MoneyVnd,
  paidHalfDays: HalfDays,
  standardDays: z.int().min(1).max(31),
  overrideHalfDays: HalfDays.nullable(),
  overrideReason: z.string().nullable(),
  lines: z.array(PayslipLineDto),
  note: z.string().nullable(),
  salaryByDays: MoneyVnd,
  incomeTotal: MoneyVnd,
  bonusTotal: MoneyVnd,
  deductionTotal: MoneyVnd,
  netPay: SignedMoneyVnd,
  revisionReason: z.string().nullable(),
  revisedAt: IsoDateTime.nullable(),
  supersededAt: IsoDateTime.nullable(),
  publishedAt: IsoDateTime.nullable(),
  /** Tháng có ngày nghỉ ốm ⇒ ghi chú "do BHXH chi trả". */
  hasSickDays: z.boolean(),
});
export type PayslipDto = z.infer<typeof PayslipDto>;

/** Bản nhân viên xem — không khóa sửa của kế toán. Chỉ PUBLISHED. */
export const MyPayslipDto = PayslipDto.omit({ lockVersion: true });
export type MyPayslipDto = z.infer<typeof MyPayslipDto>;

/** `GET payslips` — KHÔNG số tiền (riêng tư); mới nhất trước; chỉ bản hiệu lực. */
export const MyPayslipSummaryDto = z.object({
  period: PayrollPeriod,
  revision: z.int().min(1),
  publishedAt: IsoDateTime,
});
export type MyPayslipSummaryDto = z.infer<typeof MyPayslipSummaryDto>;
