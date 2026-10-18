import type { IClock, IIdGenerator } from '../../../core/domain';
import { toLocal } from '../../../core/domain/local-time';
import { BusinessRuleViolationError } from '../../../core/errors';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import {
  payslipNumbers,
  profileFor,
  staleReasons,
  type PublishBlockReason,
} from './payslip-numbers';
import type {
  ICompanyNameReader,
  IHireDatePort,
  IPayrollAccess,
  IPayrollAttendance,
  IPayrollAudit,
  IPayrollNotifier,
  IPayrollUsers,
  PayrollDaysResult,
} from './ports/collaborators.port';
import type {
  IPayrollStore,
  PayrollRunRecord,
  PayslipLineRecord,
  PayslipRecord,
  SalaryProfileRecord,
} from './ports/payroll-store.port';

export interface PayrollDeps {
  store: IPayrollStore;
  access: IPayrollAccess;
  hireDates: IHireDatePort;
  attendance: IPayrollAttendance;
  users: IPayrollUsers;
  audit: IPayrollAudit;
  notifier: IPayrollNotifier;
  company: ICompanyNameReader;
  /** Múi giờ lịch công ty hôm nay (ADR-120) — "hôm nay" của giờ nghiệp vụ. */
  timeZoneNow(): Promise<string>;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
}

/** "Hôm nay" theo giờ nghiệp vụ + múi giờ lịch công ty. */
export async function todayOf(d: Pick<PayrollDeps, 'clock' | 'timeZoneNow'>): Promise<string> {
  return toLocal(d.clock.now(), await d.timeZoneNow()).date;
}

/** Công của từng người — một người quá hạn lưu ⇒ cả kỳ 422 `ATTENDANCE_RETENTION_EXPIRED`. */
export function assertDaysAvailable(
  byUser: ReadonlyMap<string, PayrollDaysResult>,
): ReadonlyMap<string, Extract<PayrollDaysResult, { ok: true }>> {
  for (const r of byUser.values()) {
    if (!r.ok) {
      throw new BusinessRuleViolationError(
        'ATTENDANCE_RETENTION_EXPIRED',
        'Kỳ này có ngày công đã quá thời hạn lưu dữ liệu chấm công — không tính lại công được.',
      );
    }
  }
  return byUser as ReadonlyMap<string, Extract<PayrollDaysResult, { ok: true }>>;
}

/** Dữ liệu nguồn để dựng phiếu của một lô người cho một kỳ (một lần đọc mỗi loại). */
export interface PayslipSources {
  profiles: readonly SalaryProfileRecord[];
  hireDates: ReadonlyMap<string, string | null>;
  names: ReadonlyMap<string, { fullName: string }>;
  days: ReadonlyMap<string, Extract<PayrollDaysResult, { ok: true }>>;
}

export async function loadSources(
  d: PayrollDeps,
  period: string,
  userIds: readonly string[],
): Promise<PayslipSources & { standardDays: number }> {
  const [days, profiles, hireDates, names] = await Promise.all([
    d.attendance.payrollDaysFor({ userIds, period }),
    d.store.listProfiles(userIds),
    d.hireDates.hireDates({ userIds }),
    d.users.findRefs(userIds),
  ]);
  return {
    standardDays: days.standardDays,
    days: assertDaysAvailable(days.byUser),
    profiles,
    hireDates,
    names,
  };
}

/**
 * Phiếu NHÁP của một người từ dữ liệu nguồn + phần kế toán đã gõ (`keep`: dòng, ghi chú, sửa công). Mọi số là ẢNH CHỤP
 * (ADR-125): tên, level, lương cơ bản, hireDate, thâm niên, công.
 */
export function draftPayslip(
  run: PayrollRunRecord,
  userId: string,
  src: PayslipSources,
  keep: {
    id: string;
    lines: PayslipLineRecord[];
    note: string | null;
    overrideHalfDays: number | null;
    overrideReason: string | null;
    lockVersion: number;
    createdAt: Date;
  },
  at: Date,
): PayslipRecord {
  const profile = profileFor(
    src.profiles.filter((p) => p.userId === userId),
    run.period,
  );
  const hireDate = src.hireDates.get(userId) ?? null;
  const days = src.days.get(userId);
  const n = payslipNumbers({
    period: run.period,
    profile: profile ? { level: profile.level, baseSalary: profile.baseSalary } : null,
    hireDate,
    seniorityPerYear: run.seniorityPerYear,
    standardDays: run.standardDays,
    paidHalfDays: days?.halfDays ?? 0,
    overrideHalfDays: keep.overrideHalfDays,
    lines: keep.lines,
  });
  return {
    id: keep.id,
    runId: run.id,
    userId,
    revision: 1,
    lockVersion: keep.lockVersion,
    fullName: src.names.get(userId)?.fullName ?? 'Người dùng đã xóa',
    level: profile?.level ?? null,
    baseSalary: profile?.baseSalary ?? null,
    hireDate,
    seniorityYears: n.seniorityYears,
    seniorityAllowance: n.seniorityAllowance,
    paidHalfDays: days?.halfDays ?? 0,
    overrideHalfDays: keep.overrideHalfDays,
    overrideReason: keep.overrideReason,
    revisionReason: null,
    salaryByDays: n.salaryByDays,
    incomeTotal: n.incomeTotal,
    bonusTotal: n.bonusTotal,
    deductionTotal: n.deductionTotal,
    netPay: n.netPay,
    note: keep.note,
    hasSickDays: (days?.sickDays ?? 0) > 0,
    supersededAt: null,
    createdAt: keep.createdAt,
    updatedAt: at,
    lines: keep.lines,
  };
}

/** Lý do chặn của một phiếu (của chính phiếu + cờ "đã đổi — cần tính lại" trên NHÁP). */
export function blockReasonsOf(
  run: PayrollRunRecord,
  p: PayslipRecord,
  current: { hireDate: string | null; seniorityPerYear: number },
): PublishBlockReason[] {
  if (run.status === 'PUBLISHED') return [];
  const own = payslipNumbers({
    period: run.period,
    profile:
      p.level !== null && p.baseSalary !== null
        ? { level: p.level, baseSalary: p.baseSalary }
        : null,
    hireDate: p.hireDate,
    seniorityPerYear: run.seniorityPerYear,
    standardDays: run.standardDays,
    paidHalfDays: p.paidHalfDays,
    overrideHalfDays: p.overrideHalfDays,
    lines: p.lines,
  }).blockReasons;
  return [
    ...own,
    ...staleReasons({
      snapshotHireDate: p.hireDate,
      currentHireDate: current.hireDate,
      runSeniorityPerYear: run.seniorityPerYear,
      currentSeniorityPerYear: current.seniorityPerYear,
    }),
  ];
}
