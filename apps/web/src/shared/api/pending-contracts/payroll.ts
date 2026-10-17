import { UserRefDto } from '@taskflow/contracts/auth';
import { DateOnly, IsoDateTime, Uuid } from '@taskflow/contracts/common';
import { MAX_HALF_DAYS, MAX_MONEY_VND, MAX_PAYSLIP_LINES } from '@taskflow/contracts/payroll';
import * as z from 'zod';

// TẠM (T-050 — payroll.md v4 §3–§5; hình dạng E đề xuất B 18/10). B (T-048) đưa vào `@taskflow/contracts` ⇒ xóa file
// này, đổi import. Mọi tiền là số nguyên đồng; công là số nguyên NỬA NGÀY.

export const MoneyVnd = z.int().min(0).max(MAX_MONEY_VND);
export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const PayslipSection = z.enum(['INCOME', 'BONUS', 'DEDUCTION']);
export type PayslipSection = z.infer<typeof PayslipSection>;

export const PayrollSettingsDto = z.object({
  seniorityPerYear: MoneyVnd,
  version: z.int().min(1),
  updatedAt: IsoDateTime.nullable(),
  updatedBy: UserRefDto.nullable(),
});
export type PayrollSettingsDto = z.infer<typeof PayrollSettingsDto>;
export const PutPayrollSettingsBody = z.strictObject({
  seniorityPerYear: MoneyVnd,
  expectedVersion: z.int().min(1),
});

export const SalaryProfileVersionDto = z.object({
  id: Uuid,
  effectiveFrom: Period,
  level: z.string(),
  baseSalary: MoneyVnd,
  createdBy: UserRefDto,
  createdAt: IsoDateTime,
});
export type SalaryProfileVersionDto = z.infer<typeof SalaryProfileVersionDto>;
export const SalaryProfileRowDto = z.object({
  userId: Uuid,
  user: UserRefDto,
  /** Chỉ đọc — HR sửa ở hồ sơ nhân viên (ADR-128). */
  hireDate: DateOnly.nullable(),
  current: SalaryProfileVersionDto.nullable(),
  versions: z.array(SalaryProfileVersionDto),
});
export type SalaryProfileRowDto = z.infer<typeof SalaryProfileRowDto>;
export const CreateSalaryProfileBody = z.strictObject({
  effectiveFrom: Period,
  level: z.string().trim().min(1).max(32),
  baseSalary: MoneyVnd.min(1),
});
export type CreateSalaryProfileBody = z.infer<typeof CreateSalaryProfileBody>;

export const RunStatus = z.enum(['DRAFT', 'PUBLISHED']);
export const PayrollRunSummaryDto = z.object({
  period: Period,
  status: RunStatus,
  payslipCount: z.int().min(0),
  netTotal: z.int(),
  publishedAt: IsoDateTime.nullable(),
});
export const PayrollRunsDto = z.object({
  runs: z.array(PayrollRunSummaryDto),
  /** Tháng kế tiếp chưa có bảng: tạo được từ ngày `from` (tháng đã kết thúc theo giờ lịch). */
  next: z.object({ period: Period, from: DateOnly }).nullable(),
});
export type PayrollRunsDto = z.infer<typeof PayrollRunsDto>;

export const TodoKind = z.enum([
  'MISSING_SALARY_PROFILE',
  'MISSING_HIRE_DATE',
  'HIRE_DATE_AFTER_PERIOD',
  'HIRE_DATE_CHANGED',
  'SENIORITY_RATE_CHANGED',
  'MISSING_OUT',
  'NEGATIVE_NET_PAY',
  'ATTENDANCE_CHANGED_AFTER_PUBLISH',
  'PROFILE_CHANGED_AFTER_PUBLISH',
]);
export type TodoKind = z.infer<typeof TodoKind>;
export const TodoDto = z.object({
  kind: TodoKind,
  userId: Uuid.nullable(),
  user: UserRefDto.nullable(),
  date: DateOnly.nullable(),
});
export type TodoDto = z.infer<typeof TodoDto>;

export const PayslipRowDto = z.object({
  userId: Uuid,
  user: UserRefDto,
  paidHalfDays: z.int().min(0).max(MAX_HALF_DAYS),
  netPay: z.int(),
  revision: z.int().min(1),
  /** Có lý do chặn phát hành (thiếu hồ sơ lương / ngày vào / thực lĩnh âm). */
  blocked: z.boolean(),
});
export type PayslipRowDto = z.infer<typeof PayslipRowDto>;

export const PayrollRunDto = z.object({
  period: Period,
  status: RunStatus,
  standardDays: z.int().min(1).max(31),
  seniorityPerYear: MoneyVnd,
  publishedAt: IsoDateTime.nullable(),
  publishedBy: UserRefDto.nullable(),
  /** Retention chấm công đã qua một phần kỳ ⇒ không "Tính lại công" được. */
  recalcBlocked: z.boolean(),
  todo: z.array(TodoDto),
  payslips: z.array(PayslipRowDto),
});
export type PayrollRunDto = z.infer<typeof PayrollRunDto>;

export const PayslipLineDto = z.object({
  id: Uuid,
  section: PayslipSection,
  label: z.string(),
  amount: MoneyVnd,
});
export const PayslipDto = z.object({
  period: Period,
  userId: Uuid,
  fullName: z.string(),
  companyName: z.string().nullable(),
  status: RunStatus,
  revision: z.int().min(1),
  lockVersion: z.int().min(1),
  level: z.string().nullable(),
  baseSalary: MoneyVnd,
  hireDate: DateOnly.nullable(),
  seniorityYears: z.int().min(0),
  seniorityPerYear: MoneyVnd,
  seniorityAllowance: MoneyVnd,
  paidHalfDays: z.int().min(0).max(MAX_HALF_DAYS),
  standardDays: z.int().min(1).max(31),
  overrideHalfDays: z.int().min(0).max(MAX_HALF_DAYS).nullable(),
  overrideReason: z.string().nullable(),
  lines: z.array(PayslipLineDto).max(MAX_PAYSLIP_LINES),
  note: z.string().nullable(),
  salaryByDays: MoneyVnd,
  incomeTotal: MoneyVnd,
  bonusTotal: MoneyVnd,
  deductionTotal: MoneyVnd,
  netPay: z.int(),
  revisionReason: z.string().nullable(),
  revisedAt: IsoDateTime.nullable(),
  supersededAt: IsoDateTime.nullable(),
  publishedAt: IsoDateTime.nullable(),
  /** Tháng có ngày nghỉ ốm ⇒ ghi chú "do BHXH chi trả". */
  hasSickDays: z.boolean(),
});
export type PayslipDto = z.infer<typeof PayslipDto>;

const LineBody = z.strictObject({
  section: PayslipSection,
  label: z.string().trim().min(1).max(120),
  amount: MoneyVnd,
});
export const PutPayslipBody = z.strictObject({
  lines: z.array(LineBody).max(MAX_PAYSLIP_LINES),
  note: z.string().trim().max(1000).nullable(),
  overrideHalfDays: z.int().min(0).max(MAX_HALF_DAYS).nullable(),
  overrideReason: z.string().trim().min(1).max(500).optional(),
  expectedLockVersion: z.int().min(1),
});
export type PutPayslipBody = z.infer<typeof PutPayslipBody>;
export const CreateRevisionBody = PutPayslipBody.extend({
  reason: z.string().trim().min(1).max(500),
});
export type CreateRevisionBody = z.infer<typeof CreateRevisionBody>;

export const RecalcPreviewDto = z.object({ changedCount: z.int().min(0) });
export const PublishBody = z.strictObject({ confirmed: z.literal(true) });

export const MyPayslipListDto = z.array(
  z.object({ period: Period, revision: z.int().min(1), publishedAt: IsoDateTime }),
);
export type MyPayslipListDto = z.infer<typeof MyPayslipListDto>;

/** Như `XLSX_CONTENT_TYPE` của attendance (T-056) — nhánh Mốc 4 chưa có contract đó. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
