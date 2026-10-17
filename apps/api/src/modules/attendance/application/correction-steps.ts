import {
  BusinessRuleViolationError,
  ResourceConflictError,
  VersionConflictError,
} from '../../../core/errors';
import { decideCorrection, type CorrectionAsk } from '../domain/correction-rules';
import { localToday } from '../domain/work-schedule';
import type { AttendanceDeps } from './attendance-days';
import { CORRECTION_RULE_MESSAGE, toCorrectionDtos } from './correction-view';
import type { CorrectionRecord, ICorrectionStore } from './ports/correction-store.port';
import type {
  CorrectionNotifier,
  ICompanyAccess,
  ICorrectionAuditRecorder,
  IUserRefReader,
} from './ports/collaborators.port';

/** Phụ thuộc chung của đơn bổ sung giờ (T-056, hr-extended ADR-129). */
export interface CorrectionDeps extends AttendanceDeps {
  corrections: ICorrectionStore;
  company: ICompanyAccess;
  users: IUserRefReader;
  audit: ICorrectionAuditRecorder;
  notifier: CorrectionNotifier;
}

export const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export const askOf = (
  r: Pick<CorrectionRecord, 'workDate' | 'kind' | 'minuteOfDay' | 'nextDay'>,
): CorrectionAsk => ({
  date: r.workDate,
  kind: r.kind,
  minuteOfDay: r.minuteOfDay,
  nextDay: r.nextDay,
});

/** Luật gửi 1–5 (đọc TRONG khóa `punch:<user>`); lúc duyệt kiểm LẠI với dữ liệu hiện tại ⇒ 422 `details.rule`. */
export async function assertCorrectionRules(
  d: CorrectionDeps,
  userId: string,
  ask: CorrectionAsk,
): Promise<void> {
  const now = d.clock.now();
  const schedules = await d.calendar.scheduleVersions();
  const today = localToday(schedules, now).date;
  const [tenures, events, leaves] = await Promise.all([
    d.tenures.tenuresOf({ userIds: [userId], from: today, to: today }),
    d.events.listForUser({ userId, from: ask.date, to: ask.date }),
    d.leaves.approvedLeaves({ userIds: [userId], from: ask.date, to: ask.date }),
  ]);
  const decision = decideCorrection({
    ask,
    now,
    schedules,
    // Bên gọi đã qua assertActiveEmployee / isEmployee ⇒ có nhiệm kỳ hiện tại giao hôm nay.
    tenureStart: tenures.find((t) => t.until === null)?.from ?? tenures[0]?.from ?? today,
    retentionCutoff: d.retention.recordsCutoffDate(),
    events,
    fullDayLeave: leaves.some((l) => l.part === 'FULL'),
  });
  if (!decision.ok) {
    throw new BusinessRuleViolationError(decision.reason, CORRECTION_RULE_MESSAGE[decision.reason]);
  }
}

/** Không còn PENDING ⇒ 409 `invalid_transition`; lệch version ⇒ 409 `VERSION_CONFLICT`. */
export function assertPending(found: CorrectionRecord, expectedVersion: number): void {
  if (found.status !== 'PENDING') {
    throw new ResourceConflictError({ reason: 'invalid_transition' }, 'Đơn này đã được xử lý.');
  }
  if (found.version !== expectedVersion) throw new VersionConflictError(found.version);
}

/** Chuyển trạng thái có điều kiện (đếm 1); thua lượt đua ⇒ đọc lại để báo đúng 409. */
export async function transitionCorrection(
  d: CorrectionDeps,
  found: CorrectionRecord,
  expectedVersion: number,
  change: Pick<
    CorrectionRecord,
    'decidedById' | 'decidedAt' | 'decisionNote' | 'createdEventId'
  > & {
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  },
): Promise<CorrectionRecord> {
  assertPending(found, expectedVersion);
  const done = await d.corrections.decide({
    id: found.id,
    expectedVersion,
    ...change,
    at: d.clock.now(),
  });
  if (done) return done;
  assertPending((await d.corrections.findById(found.id))!, expectedVersion);
  throw new VersionConflictError(found.version);
}

export async function correctionDto(d: CorrectionDeps, record: CorrectionRecord) {
  return (await toCorrectionDtos(d, [record], true))[0]!;
}
