import { FakeClock, SequentialIdGenerator } from '../../../../test/support';
import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type { AttendanceDeps } from '../application/attendance-days';
import type { HrAuditAction } from '../application/ports/collaborators.port';
import { AttendanceEventsUseCases } from '../application/use-cases/attendance-events.use-cases';
import { AttendanceExportUseCase } from '../application/use-cases/attendance-export.use-case';
import { CheckInOutUseCase } from '../application/use-cases/check-in-out.use-case';
import { HrAttendanceQueries } from '../application/use-cases/hr-attendance.queries';
import { MyAttendanceQueries } from '../application/use-cases/my-attendance.queries';
import { WorkCalendarUseCases } from '../application/use-cases/work-calendar.use-cases';
import { instantOf } from '../domain/local-time';
import type { WorkSchedule } from '../domain/work-schedule';
import {
  FakeApprovedLeaves,
  FakeCompanyTenures,
} from '../infrastructure/persistence/in-memory/fake-collaborators';
import { inMemoryAttendanceBackend, type AttendanceBackend } from './attendance-backend';

/**
 * Bối cảnh chuẩn test-spec-hr §0.2 cho tầng A — cấp CÔNG TY (company-level ADR-136): một công ty, lịch S0 (VN, T2–T7, 08:00–17:30, nghỉ trưa
 * 12:00–13:30, grace 0), đồng hồ giả theo GIỜ VN. Lưu trữ qua `AttendanceBackend` — in-memory mặc định, Postgres ở
 * runner LSP (application không import infra).
 */
// Hằng fixture ở file riêng: backend Postgres của runner LSP import chúng mà KHÔNG đi qua module harness
// (module bị `vi.mock` — import ngược lại từ factory của mock làm treo vòng import).
export { HANA, MAX, MIA, OLIVIA, VIC, VN } from './attendance-fixture';
import { FIXTURE, HR_MANAGERS, MIA, NAMES, ROLES, VN } from './attendance-fixture';
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
  backend: AttendanceBackend = inMemoryAttendanceBackend(),
) {
  await backend.seed();
  const clock = new FakeClock(vnTime(now));
  // Không seed phiên bản lịch nào (TL): workspace chưa lưu lịch ⇒ DEFAULT_SCHEDULE (= nội dung S0).
  const { events, calendar } = backend;
  const leaves = new FakeApprovedLeaves();
  // Nhân viên (role EMPLOYEE) của fixture đều có nhiệm kỳ từ 2020; Admin không có (không phải nhân viên).
  const tenures = new FakeCompanyTenures();
  for (const [userId, role] of Object.entries(ROLES)) {
    if (role === 'EMPLOYEE') tenures.rows.push({ userId, from: '2020-01-01', until: null });
  }
  // Như composition: job retention tắt (local/test mặc định) ⇒ null. Test bật bằng `retention.cutoff = 'YYYY-MM-DD'`.
  const retention = { cutoff: null as string | null, recordsCutoffDate: () => retention.cutoff };
  const deps: AttendanceDeps = {
    events,
    calendar,
    leaves,
    tenures,
    retention,
    clock,
    ids: new SequentialIdGenerator(),
    uow: backend.uow,
  };
  const members = new Map<string, 'ADMIN' | 'EMPLOYEE'>(Object.entries(ROLES));
  /** Người đã mất quyền vào (hết `access_until`) — `assertActiveEmployee` ⇒ 401 (A C2). */
  const revoked = new Set<string>();
  const notified: { recipientId: string; eventId: string; actorId: string }[] = [];
  const audit: {
    action: HrAuditAction;
    actorId: string;
    targetUserId: string | null;
    refId: string | null;
    before: unknown;
    after: unknown;
  }[] = [];
  const collaborators = {
    users: {
      findRefs: (ids) =>
        Promise.resolve(
          new Map(ids.filter((id) => NAMES[id]).map((id) => [id, { id, fullName: NAMES[id]! }])),
        ),
    },
    // Fake theo đúng luật `CompanyAccess` của T-061 (bản thật ở module company + runner HTTP): không thuộc công ty ⇒
    // 401; thiếu `hr:manage` ⇒ 403; tự xử lý ⇒ 403 (luật self TUYỆT ĐỐI — kể cả Admin).
    company: {
      authorizeWrite: ({ actorId, targetUserId }) => {
        const role = revoked.has(actorId) ? undefined : members.get(actorId);
        if (!role) return Promise.reject(new SessionRevokedError());
        if (!HR_MANAGERS.has(actorId)) return Promise.reject(new ForbiddenError('hr:manage'));
        if (targetUserId === actorId) return Promise.reject(new ForbiddenError('hr:manage'));
        return Promise.resolve({ role });
      },
      isEmployee: (userId) => Promise.resolve(members.get(userId) === 'EMPLOYEE'),
      assertActiveEmployee: (userId) =>
        members.get(userId) === 'EMPLOYEE' && !revoked.has(userId)
          ? Promise.resolve()
          : Promise.reject(new SessionRevokedError()),
    },
    notifier: {
      attendanceAdjusted: (n) => {
        notified.push({ recipientId: n.recipientId, eventId: n.eventId, actorId: n.actorId });
        return Promise.resolve();
      },
    },
    audit: {
      record: (e) => {
        // Như `HrAuditWriter` (T-037): khóa `reason` trong before/after là lỗi lập trình (B-H2).
        if ([e.before, e.after].some((v) => v && 'reason' in v)) {
          return Promise.reject(new Error("HrAuditLog không được chứa 'reason'"));
        }
        audit.push({
          action: e.action,
          actorId: e.actorId,
          targetUserId: e.targetUserId ?? null,
          refId: e.refId ?? null,
          before: e.before ?? null,
          after: e.after ?? null,
        });
        return Promise.resolve();
      },
    },
  } satisfies Omit<ConstructorParameters<typeof AttendanceEventsUseCases>[0], keyof AttendanceDeps>;
  const eventUseCases = new AttendanceEventsUseCases({ ...deps, ...collaborators });
  const calendarUseCases = new WorkCalendarUseCases({ ...deps, ...collaborators });
  const checkInOut = new CheckInOutUseCase({ ...deps, company: collaborators.company });
  return {
    backend,
    deps,
    clock,
    leaves,
    tenures,
    retention,
    checkInOut,
    queries: new MyAttendanceQueries(deps),
    eventUseCases,
    calendarUseCases,
    exportUseCase: new AttendanceExportUseCase({ ...deps, ...collaborators }),
    collaborators,
    hrQueries: new HrAttendanceQueries({ ...deps, users: collaborators.users }),
    members,
    revoked,
    notified,
    audit,
    /** Đặt đồng hồ theo giờ VN. */
    at: (local: string) => clock.set(vnTime(local)),
    punch: async (kind: 'IN' | 'OUT', idempotencyKey: string, userId = MIA) =>
      (
        await checkInOut.execute({
          userId,
          kind,
          idempotencyKey,
          ip: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
        })
      ).card,
  };
}
