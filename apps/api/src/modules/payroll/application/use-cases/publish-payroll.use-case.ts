import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import { blockReasonsOf, type PayrollDeps } from '../payroll-kit';
import type { PublishBlockReason } from '../payslip-numbers';
import { draftRun } from '../run-steps';

/**
 * `POST payroll/runs/:period/publish` (payroll.md ADR-125/127). Trong khóa kỳ: mọi phiếu hiệu lực phải không còn lý do
 * chặn (của phiếu + cờ "đã đổi — cần tính lại") ⇒ không thì MỘT 422 `PUBLISH_BLOCKED` liệt kê ĐỦ phiếu + mọi lý do (sắp
 * theo userId — TL 18/10). MISSING_OUT không chặn. Phát hành = MỘT UPDATE có điều kiện (đếm 1) đặt đủ 4 cột (trigger: sau
 * đó bất biến), chụp tên công ty; thông báo `PAYSLIP_PUBLISHED` từng nhân viên (refId = id phiếu).
 */
export class PublishPayrollUseCase {
  constructor(private readonly d: PayrollDeps) {}

  async execute(actorId: string, period: string): Promise<void> {
    const { d } = this;
    await d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      await d.store.lockPeriod(period);
      const run = await draftRun(d, period);
      const payslips = await d.store.listCurrentPayslips(run.id);
      const [settings, hireDates] = await Promise.all([
        d.store.getSettings(),
        d.hireDates.hireDates({ userIds: payslips.map((p) => p.userId) }),
      ]);
      const blockers = payslips
        .map((p) => ({
          userId: p.userId,
          reasons: blockReasonsOf(run, p, {
            hireDate: hireDates.get(p.userId) ?? null,
            seniorityPerYear: settings.seniorityPerYear,
          }),
        }))
        .filter((b): b is { userId: string; reasons: PublishBlockReason[] } => b.reasons.length > 0)
        .sort((a, b) => (a.userId < b.userId ? -1 : 1));
      if (blockers.length) {
        throw new BusinessRuleViolationError(
          'PUBLISH_BLOCKED',
          'Còn phiếu chưa phát hành được — xem danh sách việc còn lại.',
          { blockers },
        );
      }
      const companyName = await d.company.companyName();
      if (companyName === null) throw new ResourceNotFoundError('company');
      const ok = await d.store.publishRun({
        runId: run.id,
        publishedAt: d.clock.now(),
        publishedById: actorId,
        companyName,
      });
      if (!ok) {
        throw new ResourceConflictError({ reason: 'invalid_transition' }, 'Bảng đã phát hành.');
      }
      for (const p of payslips) {
        await d.notifier.notify({
          type: 'PAYSLIP_PUBLISHED',
          refId: p.id,
          actorId,
          recipient: { kind: 'user', userId: p.userId },
        });
      }
      await d.audit.record({
        actorId,
        action: 'PAYROLL_PUBLISH',
        refId: run.id,
        after: { period, payslips: payslips.length },
      });
    });
  }
}
