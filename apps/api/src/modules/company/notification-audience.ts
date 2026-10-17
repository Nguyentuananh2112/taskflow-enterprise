import type { IClock } from '../../core/domain';
import type { ICompanyMemberRepository } from './application/ports/company-member.port';
import { isCompanyAccessActive, type CompanyMemberSnapshot } from './domain/company-member';
import { effectiveCompanyPermissions } from './domain/roles';

/**
 * `INotificationAudience` của notifications (khớp cấu trúc — ADR-093): tư cách công ty HIỆN TẠI đọc từ DB mỗi lần
 * (B-H3b) — loại "dành cho HR" lọc theo `hr:manage`, loại "dành cho Kế toán" theo `payroll:manage` (T-049).
 */
export interface CompanyNotificationAudience {
  accessOf(
    userId: string,
  ): Promise<{ since: Date; canManageHr: boolean; canManagePayroll: boolean } | null>;
  hrRecipients(): Promise<string[]>;
  payrollRecipients(): Promise<string[]>;
}

export function companyNotificationAudience(d: {
  /** Thành viên còn trong `access_until`, không thì null. */
  active(userId: string): Promise<CompanyMemberSnapshot | null>;
  members: Pick<
    ICompanyMemberRepository,
    'listHrManagerCandidates' | 'listPayrollManagerCandidates'
  >;
  clock: IClock;
}): CompanyNotificationAudience {
  const stillActive = (rows: CompanyMemberSnapshot[]) => {
    const now = d.clock.now();
    return rows.filter((m) => isCompanyAccessActive(m, now)).map((m) => m.userId);
  };
  return {
    async accessOf(userId) {
      const m = await d.active(userId);
      if (!m) return null;
      const perms = effectiveCompanyPermissions(m.role, m.grants);
      return {
        since: m.createdAt,
        canManageHr: perms.has('hr:manage'),
        canManagePayroll: perms.has('payroll:manage'),
      };
    },
    hrRecipients: async () => stillActive(await d.members.listHrManagerCandidates()),
    payrollRecipients: async () => stillActive(await d.members.listPayrollManagerCandidates()),
  };
}
