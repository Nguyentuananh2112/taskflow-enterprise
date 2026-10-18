// Lưu trữ phiếu lương (migration 7 — T-048). Tiền là số nguyên an toàn (`bigint` của Prisma đổi ở biên adapter).
// Mọi lệnh ghi bảng tháng gọi TRONG `uow.run` sau khóa `taskflow:payroll:<period>` (ADR-127).

export type PayslipSection = 'INCOME' | 'BONUS' | 'DEDUCTION';
export type RunStatus = 'DRAFT' | 'PUBLISHED';

export interface PayrollSettingsRecord {
  seniorityPerYear: number;
  version: number;
  updatedAt: Date;
  updatedById: string | null;
}

export interface SalaryProfileRecord {
  id: string;
  userId: string;
  /** `YYYY-MM` — áp từ kỳ này. */
  effectiveFrom: string;
  level: string;
  baseSalary: number;
  createdById: string;
  createdAt: Date;
}

export interface PayrollRunRecord {
  id: string;
  period: string;
  status: RunStatus;
  standardDays: number;
  seniorityPerYear: number;
  companyName: string | null;
  publishedAt: Date | null;
  publishedById: string | null;
  createdById: string;
  createdAt: Date;
}

export interface PayslipLineRecord {
  id: string;
  section: PayslipSection;
  label: string;
  amount: number;
}

export interface PayslipRecord {
  id: string;
  runId: string;
  userId: string;
  revision: number;
  lockVersion: number;
  fullName: string;
  level: string | null;
  baseSalary: number | null;
  hireDate: string | null;
  seniorityYears: number;
  seniorityAllowance: number;
  paidHalfDays: number;
  overrideHalfDays: number | null;
  overrideReason: string | null;
  revisionReason: string | null;
  salaryByDays: number;
  incomeTotal: number;
  bonusTotal: number;
  deductionTotal: number;
  netPay: number;
  note: string | null;
  hasSickDays: boolean;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Theo `sortOrder` (0..49). */
  lines: PayslipLineRecord[];
}

export interface IPayrollStore {
  /** Khóa giao dịch `taskflow:payroll:<period>` (advisory) — tuần tự mọi lệnh ghi lên bảng tháng. */
  lockPeriod(period: string): Promise<void>;

  getSettings(): Promise<PayrollSettingsRecord>;
  /** UPDATE có điều kiện version (đếm 1); lệch ⇒ null. */
  updateSettings(input: {
    seniorityPerYear: number;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<PayrollSettingsRecord | null>;

  /** Mọi phiên bản hồ sơ của các người (bỏ trống ⇒ mọi người); mới nhất trước theo `effectiveFrom`. */
  listProfiles(userIds?: readonly string[]): Promise<SalaryProfileRecord[]>;
  /** Chỉ thêm; trùng (userId, effectiveFrom) ⇒ 'duplicate'. */
  insertProfile(record: SalaryProfileRecord): Promise<'ok' | 'duplicate'>;

  /** Mới nhất trước, kèm số phiếu + tổng thực lĩnh của bản hiệu lực. */
  listRuns(): Promise<(PayrollRunRecord & { payslipCount: number; netTotal: number })[]>;
  findRun(period: string): Promise<PayrollRunRecord | null>;
  /** Unique (period) ⇒ 'exists' (tạo nháp idempotent ở use case). */
  insertRun(record: PayrollRunRecord): Promise<'ok' | 'exists'>;
  /** Chỉ NHÁP: cập nhật ảnh chụp công chuẩn + mức thâm niên khi "Tính lại công". */
  updateDraftRun(
    runId: string,
    input: { standardDays: number; seniorityPerYear: number },
  ): Promise<boolean>;
  /** MỘT lệnh `UPDATE … WHERE status = 'DRAFT'` đặt đủ 4 cột (trigger: đã PUBLISHED thì bất biến) — đếm 1. */
  publishRun(input: {
    runId: string;
    publishedAt: Date;
    publishedById: string;
    companyName: string;
  }): Promise<boolean>;

  /** Bản HIỆU LỰC (superseded_at IS NULL) của mọi người trong bảng, theo userId. */
  listCurrentPayslips(runId: string): Promise<PayslipRecord[]>;
  findCurrentPayslip(runId: string, userId: string): Promise<PayslipRecord | null>;
  /** Mọi bản của một người trong bảng (revision tăng dần). */
  listRevisions(runId: string, userId: string): Promise<PayslipRecord[]>;
  /** Thêm phiếu + dòng (số ĐÃ TÍNH XONG — sau khi bảng PUBLISHED không UPDATE được nữa). */
  insertPayslip(record: PayslipRecord): Promise<void>;
  /**
   * Chỉ NHÁP: thay số + dòng (deleteMany + createMany), `lockVersion + 1`, điều kiện `lockVersion = expected` (đếm 1);
   * lệch ⇒ null.
   */
  updateDraftPayslip(
    record: PayslipRecord,
    expectedLockVersion: number,
  ): Promise<PayslipRecord | null>;
  /** Bản điều chỉnh: CHỈ đặt `superseded_at` của bản hiệu lực (đổi cột khác ⇒ trigger chặn) — đếm 1. */
  supersede(payslipId: string, at: Date): Promise<boolean>;

  /** Phiếu của tôi: bản hiệu lực trên bảng PUBLISHED, mới nhất trước — kèm kỳ. */
  myPayslips(userId: string): Promise<{ period: string; revision: number; publishedAt: Date }[]>;
  /** Kỳ theo id phiếu (ngữ cảnh thông báo PAYSLIP_*). */
  payslipPeriods(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
