// Cổng sang module khác (ADR-093) — payroll sở hữu, adapter nối ở composition root.

/** Quyền ghi cấp công ty (`CompanyAccess.authorizeWrite` với `payroll:manage` — khóa dòng người gọi FOR SHARE). */
export interface IPayrollAccess {
  /** Thiếu quyền ⇒ 403; tự xử lý của mình (`targetUserId = actorId`) ⇒ 403 (luật self tuyệt đối — ADR-124). */
  authorizeWrite(input: { actorId: string; targetUserId?: string | null }): Promise<void>;
}

/** `EmployeeProfile.hireDate` (ADR-128) — người chưa có hồ sơ ⇒ null. */
export interface IHireDatePort {
  hireDates(query: { userIds: readonly string[] }): Promise<Map<string, string | null>>;
}

export type PayrollDaysResult =
  | { ok: true; halfDays: number; missingOutDates: string[]; sickDays: number }
  | { ok: false; reason: 'ATTENDANCE_RETENTION_EXPIRED' };

/** Công tính lương + người trong kỳ — module attendance (ADR-126/127). */
export interface IPayrollAttendance {
  payrollDaysFor(q: { userIds: readonly string[]; period: string }): Promise<{
    standardDays: number;
    byUser: ReadonlyMap<string, PayrollDaysResult>;
  }>;
  payrollMembersOf(period: string): Promise<string[]>;
}

/** Tên hiển thị hiện hành (tên người lĩnh chụp lên phiếu). */
export interface IPayrollUsers {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, { id: string; fullName: string }>>;
}

export type PayrollAuditAction =
  | 'PAYROLL_SETTINGS_SET'
  | 'PAYROLL_SALARY_SET'
  | 'PAYROLL_RUN_CREATE'
  | 'PAYROLL_RECALCULATE'
  | 'PAYROLL_ADD_MISSING'
  | 'PAYROLL_PAYSLIP_SET'
  | 'PAYROLL_PUBLISH'
  | 'PAYROLL_PAYSLIP_REVISE'
  | 'PAYROLL_PAYSLIP_VIEW'
  | 'PAYROLL_EXPORT';

/** `HrAuditLog` (chỉ Admin đọc) — lý do để ở `after.note`, KHÔNG dùng khóa `reason` (writer ném lỗi). */
export interface IPayrollAudit {
  record(entry: {
    actorId: string;
    action: PayrollAuditAction;
    targetUserId?: string | null;
    refId?: string | null;
    before?: Readonly<Record<string, unknown>> | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void>;
}

/** Thông báo bền (ADR-123) — ghi TRONG transaction; `payroll` ⇒ mọi người có payroll:manage hiện tại. */
export interface PayrollNotifyInput {
  type: 'PAYSLIP_PUBLISHED' | 'PAYSLIP_REVISED' | 'PAYROLL_REMINDER';
  refId: string;
  /** `null` = hệ thống (job nhắc). */
  actorId: string | null;
  recipient: { kind: 'user'; userId: string } | { kind: 'payroll' };
}

export interface IPayrollNotifier {
  notify(input: PayrollNotifyInput): Promise<void>;
  /** Một lần cho mỗi `(type, refId)` — bên gọi giữ khóa advisory. */
  notifyOnce(input: PayrollNotifyInput): Promise<boolean>;
}

/** Tên công ty hiện hành (chụp lên bảng lúc phát hành). */
export interface ICompanyNameReader {
  companyName(): Promise<string | null>;
}
