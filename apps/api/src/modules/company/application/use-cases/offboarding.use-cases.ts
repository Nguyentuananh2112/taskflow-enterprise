import { addDays, toLocal, type LocalDate } from '../../../../core/domain/local-time';
import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import { accessUntilOf } from '../../domain/company-member';
import { authorizeOnEmployee } from '../employment-shared';
import type { CompleteOffboardingUseCase, OffboardingDeps } from './complete-offboarding.use-case';

/** `lastDay ∈ [hôm nay − 31, hôm nay + 90]` theo giờ nghiệp vụ (company-level.md "Cho nghỉ việc có lịch"). */
export const LAST_DAY_BACK_DAYS = 31;
export const LAST_DAY_AHEAD_DAYS = 90;

const outOfRange = (message: string) =>
  new BusinessRuleViolationError('LAST_DAY_OUT_OF_RANGE', message);

export interface ScheduleOffboardingResult {
  userId: string;
  /** Hoàn tất ngay trong request (`access_until` đã qua). */
  completed: boolean;
  warnings: { pendingLeaveCount: number; soleOwnerWorkspaces: { id: string; name: string }[] };
}

/**
 * `PUT /hr/employees/:userId/offboarding` (`hr:manage`): đặt / đổi lịch nghỉ — `lastDay ∈ [hôm nay − 31, + 90]` và
 * ≥ `start_date` ⇒ không thì 422 `LAST_DAY_OUT_OF_RANGE`; `access_until = 06:00 ngày sau lastDay` (ADR-135). Admin
 * chỉ Admin khác cho nghỉ, không được để công ty mất Admin cuối (409 `last_admin`). `access_until` đã qua ⇒ hoàn tất
 * NGAY trong request (transaction riêng, như job).
 */
export class ScheduleOffboardingUseCase {
  constructor(
    private readonly d: OffboardingDeps,
    private readonly completer: CompleteOffboardingUseCase,
  ) {}

  async execute(input: {
    actorId: string;
    userId: string;
    lastDay: LocalDate;
    reason?: string | undefined;
  }): Promise<ScheduleOffboardingResult> {
    const d = this.d;
    const scheduled = await d.uow.run(async () => {
      const { actor, target } = await authorizeOnEmployee(d, input.actorId, input.userId);
      if (target.role === 'ADMIN') {
        await d.members.lockAdmins();
        const others = (await d.members.listAdmins()).filter(
          (a) => a.userId !== target.userId && a.offboardLastDay === null,
        );
        if (others.length === 0) throw new ResourceConflictError({ reason: 'last_admin' });
      }
      const now = d.clock.now();
      const timeZone = await d.timeZone();
      const today = toLocal(now, timeZone).date;
      if (input.lastDay < addDays(today, -LAST_DAY_BACK_DAYS)) {
        throw outOfRange(`Ngày làm cuối lùi tối đa ${LAST_DAY_BACK_DAYS} ngày.`);
      }
      if (input.lastDay > addDays(today, LAST_DAY_AHEAD_DAYS)) {
        throw outOfRange(`Ngày làm cuối tối đa ${LAST_DAY_AHEAD_DAYS} ngày tới.`);
      }
      if (target.startDate && input.lastDay < target.startDate) {
        throw outOfRange('Ngày làm cuối không được trước ngày bắt đầu.'); // CHECK của migration 5
      }
      const accessUntil = accessUntilOf(input.lastDay, timeZone);
      const next = await d.offboarding.schedule({
        userId: target.userId,
        lastDay: input.lastDay,
        accessUntil,
        scheduledById: actor.userId,
        at: now,
      });
      if (!next) throw new ResourceNotFoundError('user');
      await d.audit.record({
        actorId: actor.userId,
        action: 'EMPLOYEE_OFFBOARD_SCHEDULED',
        targetUserId: target.userId,
        before: { lastDay: target.offboardLastDay },
        after: {
          lastDay: input.lastDay,
          accessUntil: accessUntil.toISOString(),
          note: input.reason ?? null,
        },
      });
      const c = d.collaborators();
      // Nhân viên + mọi Admin khác người gây ra (ADR-137); web hiện dải "Bạn làm việc tới hết ngày …".
      const recipients = new Set([
        target.userId,
        ...(await d.members.listAdmins()).map((a) => a.userId),
      ]);
      recipients.delete(actor.userId);
      for (const userId of recipients) {
        await c.notifier.notify({
          type: 'OFFBOARD_SCHEDULED',
          refId: target.userId,
          actorId: actor.userId,
          recipient: { kind: 'user', userId },
        });
      }
      return {
        due: accessUntil.getTime() <= now.getTime(),
        warnings: {
          pendingLeaveCount:
            target.role === 'EMPLOYEE' ? await c.rehireLeave.pendingCount(target.userId) : 0,
          soleOwnerWorkspaces: await c.workspaceExit.soleOwnerWorkspaces(target.userId),
        },
      };
    });
    const completed = scheduled.due ? await this.completer.completeOne(input.userId) : false;
    return { userId: input.userId, completed, warnings: scheduled.warnings };
  }
}

/** `DELETE /hr/employees/:userId/offboarding` — hủy lịch nghỉ chưa hoàn tất; không có lịch ⇒ 404 user. */
export class CancelOffboardingUseCase {
  constructor(private readonly d: OffboardingDeps) {}

  execute(input: { actorId: string; userId: string }): Promise<{ userId: string }> {
    const d = this.d;
    return d.uow.run(async () => {
      const { actor, target } = await authorizeOnEmployee(d, input.actorId, input.userId);
      const next = await d.offboarding.cancel(target.userId, d.clock.now());
      if (!next) throw new ResourceNotFoundError('user');
      await d.audit.record({
        actorId: actor.userId,
        action: 'EMPLOYEE_OFFBOARD_CANCELLED',
        targetUserId: target.userId,
        before: { lastDay: target.offboardLastDay },
        after: { lastDay: null },
      });
      return { userId: target.userId };
    });
  }
}
