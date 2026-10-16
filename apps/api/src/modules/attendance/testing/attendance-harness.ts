import { FakeClock, FakeUnitOfWork, SequentialIdGenerator } from '../../../../test/support';
import type { AttendanceDeps } from '../application/attendance-days';
import { CheckInOutUseCase } from '../application/use-cases/check-in-out.use-case';
import { MyAttendanceQueries } from '../application/use-cases/my-attendance.queries';
import { instantOf } from '../domain/local-time';
import type { WorkSchedule } from '../domain/work-schedule';
import {
  FakeApprovedLeaves,
  InMemoryAttendanceEventStore,
  InMemoryWorkCalendarStore,
} from '../infrastructure/persistence/in-memory/in-memory-attendance';

/**
 * Bối cảnh chuẩn test-spec-hr §0.2 cho tầng A: workspace W1, lịch S0 (VN, T2–T7, 08:00–17:30, nghỉ trưa
 * 12:00–13:30, grace 0), đồng hồ giả theo GIỜ VN. Nối store in-memory (application không import infra).
 */
export const VN = 'Asia/Ho_Chi_Minh';
export const W1 = '0199e5a2-0000-7000-8000-0000000000a1';
export const MIA = '0199e5a2-0000-7000-8000-0000000000b1';
export const MAX = '0199e5a2-0000-7000-8000-0000000000b2';
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

export function createAttendanceHarness(now = '2026-11-17 07:55') {
  const clock = new FakeClock(vnTime(now));
  const events = new InMemoryAttendanceEventStore();
  const calendar = new InMemoryWorkCalendarStore(W1);
  calendar.versions.push(S0);
  const leaves = new FakeApprovedLeaves();
  const deps: AttendanceDeps = {
    events,
    calendar,
    leaves,
    clock,
    ids: new SequentialIdGenerator(),
    uow: new FakeUnitOfWork(),
  };
  const checkInOut = new CheckInOutUseCase(deps);
  return {
    deps,
    clock,
    events,
    calendar,
    leaves,
    checkInOut,
    queries: new MyAttendanceQueries(deps),
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
