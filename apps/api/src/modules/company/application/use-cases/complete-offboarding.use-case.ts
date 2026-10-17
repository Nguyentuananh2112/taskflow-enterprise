import type { IClock, IIdGenerator } from '../../../../core/domain';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../company-access';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository } from '../ports/company-member.port';
import type { EmploymentCollaborators } from '../ports/employment-collaborators.port';
import type { ICompanyOffboardingRepository } from '../ports/offboarding.port';

/** Mỗi lượt job hoàn tất tối đa bấy nhiêu người, rồi lượt kế (theo lô). */
export const COMPLETION_BATCH = 50;

export interface OffboardingDeps {
  access: CompanyAccess;
  members: ICompanyMemberRepository;
  offboarding: ICompanyOffboardingRepository;
  accounts: ICompanyAccounts;
  collaborators: () => EmploymentCollaborators;
  audit: HrAuditWriter;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  /** Giờ NGHIỆP VỤ (R31, TEST_CLOCK_ANCHOR) — "hôm nay", `access_until`, mốc DELETE. */
  clock: IClock;
  timeZone: () => Promise<string>;
  logger: ILogger;
}

/**
 * Hoàn tất nghỉ việc của MỘT người (ADR-137 "Hoàn tất", thứ tự khóa ADR-136): một transaction — khóa `company:admins`
 * nếu là Admin (bậc 2) → `leave:<U>` rồi `punch:<U>` (bậc 3, TRƯỚC khi đụng dòng — D HIGH-1) → dọn đơn → `DELETE …
 * RETURNING` đếm 1 → departure → rời mọi ws → thu hồi token kích hoạt → thu hồi phiên (ADR-105: Valkey TRƯỚC commit,
 * lỗi ⇒ rollback, lượt sau thử lại; `disconnectUser` SAU commit). Request ‖ job ⇒ đúng một bên thắng.
 */
export class CompleteOffboardingUseCase {
  constructor(private readonly d: OffboardingDeps) {}

  /** `true` ⇔ lượt này hoàn tất; `false` ⇔ chưa tới hạn / người khác đã làm. */
  completeOne(userId: string): Promise<boolean> {
    const d = this.d;
    return d.uow.run(async () => {
      const now = d.clock.now();
      const peek = await d.members.find(userId);
      if (!peek?.offboardAccessUntil || peek.offboardAccessUntil.getTime() > now.getTime()) {
        return false;
      }
      if (peek.role === 'ADMIN') await d.members.lockAdmins();
      await d.members.lockEmployeeWork(userId);
      const m = await d.members.find(userId); // đọc lại sau khóa: lịch có thể vừa bị hủy / đổi
      if (!m?.offboardAccessUntil || m.offboardAccessUntil.getTime() > now.getTime()) return false;
      const actorId = m.offboardScheduledById ?? userId;
      const c = d.collaborators();
      if (m.role === 'EMPLOYEE' && m.offboardLastDay) {
        await c.offboardLeave.offboardCleanup({ userId, lastDay: m.offboardLastDay, actorId });
      }
      const deleted = await d.offboarding.deleteIfDue(userId, now);
      if (!deleted) return false;
      if (deleted.role === 'EMPLOYEE' && deleted.startDate && deleted.offboardLastDay) {
        await d.members.recordDeparture({
          id: d.ids.next(),
          userId,
          role: 'EMPLOYEE',
          firstDay: deleted.startDate,
          lastDay: deleted.offboardLastDay,
          leftAt: now,
          reason: 'OFFBOARDED',
        });
      }
      const exit = await c.workspaceExit.endMembership({ userId, actorId });
      await d.accounts.revokeActivations(userId);
      await d.accounts.revokeSessions(userId, 'OFFBOARDED');
      await d.audit.record({
        actorId: deleted.offboardScheduledById,
        action: 'EMPLOYEE_OFFBOARD_COMPLETED',
        targetUserId: userId,
        before: { role: deleted.role, lastDay: deleted.offboardLastDay },
        after: { workspaces: exit.workspaceIds.length, orphaned: exit.orphaned },
      });
      d.uow.afterCommit(() => {
        d.logger.info(
          { userId, workspaces: exit.workspaceIds.length, orphaned: exit.orphaned.length },
          'company.offboard_completed',
        );
      });
      return true;
    });
  }

  /** Job mỗi phút (R40): theo lô, mỗi người một transaction; lỗi một người không chặn người khác. */
  async runDue(signal?: AbortSignal): Promise<{ completed: number; failed: number }> {
    let completed = 0;
    let failed = 0;
    for (;;) {
      if (signal?.aborted) break;
      const due = await this.d.uow.run(() =>
        this.d.offboarding.listDue(this.d.clock.now(), COMPLETION_BATCH),
      );
      let progressed = 0;
      for (const userId of due) {
        if (signal?.aborted) break;
        try {
          if (await this.completeOne(userId)) {
            completed += 1;
            progressed += 1;
          }
        } catch (err) {
          failed += 1;
          this.d.logger.error({ err, userId }, 'company.offboard_complete_failed');
        }
      }
      // Lô chưa đầy, hoặc không tiến được (mọi người đều lỗi) ⇒ dừng, lượt sau thử lại.
      if (due.length < COMPLETION_BATCH || progressed === 0) break;
    }
    return { completed, failed };
  }
}
