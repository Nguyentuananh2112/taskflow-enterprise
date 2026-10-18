import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import type { PayrollDeps } from '../payroll-kit';
import { payslipNumbers } from '../payslip-numbers';
import type { PayrollRunRecord, PayslipRecord, PayslipSection } from '../ports/payroll-store.port';
import { draftRun } from '../run-steps';

export interface PayslipEdit {
  lines: readonly { section: PayslipSection; label: string; amount: number }[];
  note: string | null;
  overrideHalfDays: number | null;
  overrideReason: string | null;
}

/** Số mới của một phiếu khi kế toán sửa dòng / ghi chú / công — mọi ẢNH CHỤP (hồ sơ, hireDate, công) giữ nguyên. */
function edited(d: PayrollDeps, run: PayrollRunRecord, p: PayslipRecord, e: PayslipEdit, at: Date) {
  const lines = e.lines.map((l) => ({ id: d.ids.next(), ...l }));
  const n = payslipNumbers({
    period: run.period,
    profile:
      p.level !== null && p.baseSalary !== null
        ? { level: p.level, baseSalary: p.baseSalary }
        : null,
    hireDate: p.hireDate,
    seniorityPerYear: run.seniorityPerYear,
    standardDays: run.standardDays,
    paidHalfDays: p.paidHalfDays,
    overrideHalfDays: e.overrideHalfDays,
    lines,
  });
  return {
    ...p,
    lines,
    note: e.note,
    overrideHalfDays: e.overrideHalfDays,
    overrideReason: e.overrideReason,
    salaryByDays: n.salaryByDays,
    seniorityAllowance: n.seniorityAllowance,
    incomeTotal: n.incomeTotal,
    bonusTotal: n.bonusTotal,
    deductionTotal: n.deductionTotal,
    netPay: n.netPay,
    updatedAt: at,
  };
}

/**
 * Sửa phiếu (payroll.md ADR-124/125, T-049): `authorizeWrite(payroll:manage, targetUserId)` — phiếu của CHÍNH Kế toán ⇒
 * 403 (luật self tuyệt đối) → khóa kỳ. NHÁP: sửa tại chỗ có `lockVersion`. PUBLISHED: bản điều chỉnh `revision + 1`
 * (UPDATE bản cũ CHỈ `superseded_at`, INSERT bản mới đã tính xong — trigger cấm sửa sau đó), lý do bắt buộc, nhân viên
 * được thông báo. Lý do sửa công / điều chỉnh ở `after.note` của audit (không khóa `reason`).
 */
export class PayslipEditsUseCases {
  constructor(private readonly d: PayrollDeps) {}

  /** `PUT payroll/runs/:period/payslips/:userId` (NHÁP). */
  async put(
    actorId: string,
    q: { period: string; userId: string; expectedLockVersion: number } & PayslipEdit,
  ): Promise<PayslipRecord> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId, targetUserId: q.userId });
      await d.store.lockPeriod(q.period);
      const run = await draftRun(d, q.period);
      const p = await d.store.findCurrentPayslip(run.id, q.userId);
      if (!p) throw new ResourceNotFoundError('payslip');
      if (p.lockVersion !== q.expectedLockVersion) throw new VersionConflictError(p.lockVersion);
      const next = edited(d, run, p, q, d.clock.now());
      const saved = await d.store.updateDraftPayslip(next, q.expectedLockVersion);
      if (!saved) throw new VersionConflictError(p.lockVersion);
      await d.audit.record({
        actorId,
        action: 'PAYROLL_PAYSLIP_SET',
        targetUserId: q.userId,
        refId: p.id,
        before: { netPay: p.netPay, overrideHalfDays: p.overrideHalfDays },
        // B L3: lý do sửa công chỉ khi có (không ghi `note: null`).
        after: {
          netPay: saved.netPay,
          lines: saved.lines.length,
          overrideHalfDays: saved.overrideHalfDays,
          ...(saved.overrideReason ? { note: saved.overrideReason } : {}),
        },
      });
      return saved;
    });
  }

  /** `POST payroll/runs/:period/payslips/:userId/revisions` (PUBLISHED) ⇒ bản mới. */
  async revise(
    actorId: string,
    q: { period: string; userId: string; expectedRevision: number; reason: string } & PayslipEdit,
  ): Promise<PayslipRecord> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId, targetUserId: q.userId });
      await d.store.lockPeriod(q.period);
      const run = await d.store.findRun(q.period);
      if (!run) throw new ResourceNotFoundError('payroll_run');
      if (run.status !== 'PUBLISHED') {
        throw new ResourceConflictError(
          { reason: 'invalid_transition' },
          'Bảng còn nháp — sửa phiếu trực tiếp.',
        );
      }
      const p = await d.store.findCurrentPayslip(run.id, q.userId);
      if (!p) throw new ResourceNotFoundError('payslip');
      if (p.revision !== q.expectedRevision) throw new VersionConflictError(p.revision);
      const now = d.clock.now();
      const next: PayslipRecord = {
        ...edited(d, run, p, q, now),
        id: d.ids.next(),
        revision: p.revision + 1,
        lockVersion: 1,
        revisionReason: q.reason,
        supersededAt: null,
        createdAt: now,
      };
      if (next.netPay < 0) {
        throw new BusinessRuleViolationError('PUBLISH_BLOCKED', 'Thực lĩnh âm.', {
          blockers: [{ userId: q.userId, reasons: ['NEGATIVE_NET_PAY'] }],
        });
      }
      if (!(await d.store.supersede(p.id, now))) throw new VersionConflictError(p.revision);
      await d.store.insertPayslip(next);
      await d.notifier.notify({
        type: 'PAYSLIP_REVISED',
        refId: next.id,
        actorId,
        recipient: { kind: 'user', userId: q.userId },
      });
      await d.audit.record({
        actorId,
        action: 'PAYROLL_PAYSLIP_REVISE',
        targetUserId: q.userId,
        refId: next.id,
        before: { revision: p.revision, netPay: p.netPay },
        after: { revision: next.revision, netPay: next.netPay, note: q.reason },
      });
      return next;
    });
  }
}
