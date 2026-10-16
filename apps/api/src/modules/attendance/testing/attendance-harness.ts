import { FakeClock, SequentialIdGenerator } from '../../../../test/support';
import type { AttendanceDeps } from '../application/attendance-days';
import type { HrAuditAction } from '../application/ports/collaborators.port';
import { AttendanceEventsUseCases } from '../application/use-cases/attendance-events.use-cases';
import { CheckInOutUseCase } from '../application/use-cases/check-in-out.use-case';
import { MyAttendanceQueries } from '../application/use-cases/my-attendance.queries';
import { instantOf } from '../domain/local-time';
import type { WorkSchedule } from '../domain/work-schedule';
import { FakeApprovedLeaves } from '../infrastructure/persistence/in-memory/in-memory-attendance';
import { inMemoryAttendanceBackend, type AttendanceBackend } from './attendance-backend';

/**
 * Bối cảnh chuẩn test-spec-hr §0.2 cho tầng A: workspace W1, lịch S0 (VN, T2–T7, 08:00–17:30, nghỉ trưa
 * 12:00–13:30, grace 0), đồng hồ giả theo GIỜ VN. Lưu trữ qua `AttendanceBackend` — in-memory mặc định, Postgres ở
 * runner LSP (application không import infra).
 */
// Hằng fixture ở file riêng: backend Postgres của runner LSP import chúng mà KHÔNG đi qua module harness
// (module bị `vi.mock` — import ngược lại từ factory của mock làm treo vòng import).
export { HANA, MAX, MIA, OLIVIA, VIC, VN, W1, W2 } from './attendance-fixture';
import { FIXTURE, MIA, NAMES, ROLES, VN, W1 } from './attendance-fixture';
export { FIXTURE };

export const S0: WorkSchedule = {
  effectiveFrom: '2026-01-01',
  timezone: VN,
  workdays: 0b0111111,
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
};

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** `'2026-11-17 07:55'` (giờ VN) ⇒ thời điểm UTC. */
export const vnTime = (local: string) => {
  const [date, time] = local.split(' ') as [string, string];
  return instantOf(date, hm(time), VN);
};
/** Idempotency-Key giả (UUID hợp lệ) theo số thứ tự. */
export const key = (n: number) => `0199e5a2-0000-7000-8000-${String(n).padStart(12, '0')}`;

export async function createAttendanceHarness(
  now = '2026-11-17 07:55',
  backend: AttendanceBackend = inMemoryAttendanceBackend(W1),
) {
  await backend.seed();
  const clock = new FakeClock(vnTime(now));
  // Không seed phiên bản lịch nào (TL): workspace chưa lưu lịch ⇒ DEFAULT_SCHEDULE (= nội dung S0).
  const { events, calendar } = backend;
  const leaves = new FakeApprovedLeaves();
  const deps: AttendanceDeps = {
    events,
    calendar,
    leaves,
    clock,
    ids: new SequentialIdGenerator(),
    uow: backend.uow,
  };
  const members = new Map<string, 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'>(Object.entries(ROLES));
  const notified: { recipientId: string; eventId: string; actorId: string }[] = [];
  const audit: {
    action: HrAuditAction;
    actorId: string;
    targetUserId: string | null;
    refId: string | null;
    after: unknown;
  }[] = [];
  const eventUseCases = new AttendanceEventsUseCases({
    ...deps,
    users: {
      findRefs: (ids) =>
        Promise.resolve(
          new Map(ids.filter((id) => NAMES[id]).map((id) => [id, { id, fullName: NAMES[id]! }])),
        ),
    },
    members: {
      roleOf: ({ workspaceId, userId }) =>
        Promise.resolve(workspaceId === W1 ? (members.get(userId) ?? null) : null),
    },
    notifier: {
      attendanceAdjusted: (n) => {
        notified.push({ recipientId: n.recipientId, eventId: n.eventId, actorId: n.actorId });
        return Promise.resolve();
      },
    },
    audit: {
      append: (e) => {
        audit.push({
          action: e.action,
          actorId: e.actorId,
          targetUserId: e.targetUserId,
          refId: e.refId,
          after: e.after,
        });
        return Promise.resolve();
      },
    },
  });
  const checkInOut = new CheckInOutUseCase(deps);
  return {
    backend,
    deps,
    clock,
    leaves,
    checkInOut,
    queries: new MyAttendanceQueries(deps),
    eventUseCases,
    members,
    notified,
    audit,
    /** Đặt đồng hồ theo giờ VN. */
    at: (local: string) => clock.set(vnTime(local)),
    punch: (kind: 'IN' | 'OUT', idempotencyKey: string, userId = MIA) =>
      checkInOut.execute({
        workspaceId: W1,
        userId,
        kind,
        idempotencyKey,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      }),
  };
}
