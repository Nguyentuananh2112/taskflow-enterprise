import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { AttendanceWorkCalendar } from './application/adapters/work-calendar.adapter';
import type { AttendanceDeps } from './application/attendance-days';
import type { ApprovedLeavePort } from './application/ports/approved-leave.port';
import type { IAttendanceEventStore } from './application/ports/attendance-event-store.port';
import type {
  AttendanceNotifier,
  IHrAccess,
  IHrAuditRecorder,
  IUserRefReader,
} from './application/ports/collaborators.port';
import type { IMembershipTenurePort } from './application/ports/membership-tenure.port';
import type { IRetentionWindow } from './application/ports/retention-window.port';
import type { IWorkCalendarStore } from './application/ports/work-calendar-store.port';
import { AttendanceEventsUseCases } from './application/use-cases/attendance-events.use-cases';
import { AttendanceExportUseCase } from './application/use-cases/attendance-export.use-case';
import { CheckInOutUseCase } from './application/use-cases/check-in-out.use-case';
import { HrAttendanceQueries } from './application/use-cases/hr-attendance.queries';
import { MyAttendanceQueries } from './application/use-cases/my-attendance.queries';
import { WorkCalendarUseCases } from './application/use-cases/work-calendar.use-cases';
import { InMemoryAttendanceEventStore } from './infrastructure/persistence/in-memory/in-memory-attendance';
import { InMemoryWorkCalendarStore } from './infrastructure/persistence/in-memory/in-memory-work-calendar';
import type { DbProvider } from './infrastructure/persistence/prisma/db';
import { PrismaAttendanceEventStore } from './infrastructure/persistence/prisma/prisma-attendance-event.store';
import { PrismaWorkCalendarStore } from './infrastructure/persistence/prisma/prisma-work-calendar.store';
import type { AttendanceMembership } from './presentation/attendance-access';
import { AttendanceController } from './presentation/attendance.controller';
import { attendanceRoutes } from './presentation/attendance.routes';

export interface AttendanceRepositories {
  events: IAttendanceEventStore;
  calendar: IWorkCalendarStore;
}

/** Repository Prisma — `db` = `uow.db()` dùng chung transaction với module khác (composition root). */
export function createPrismaAttendanceRepositories(db: DbProvider): AttendanceRepositories {
  return { events: new PrismaAttendanceEventStore(db), calendar: new PrismaWorkCalendarStore(db) };
}

/** Lưu trữ trong bộ nhớ (local/test). */
export function createInMemoryAttendanceRepositories() {
  return { events: new InMemoryAttendanceEventStore(), calendar: new InMemoryWorkCalendarStore() };
}

export interface AttendanceModuleDeps {
  repos: AttendanceRepositories;
  /**
   * Port sang module khác (ADR-093) — nối ở composition root. Chỉ gọi khi xử lý request (KHÔNG lúc khởi tạo):
   * leave ↔ attendance phụ thuộc vòng, composition dùng tham chiếu trễ.
   */
  leaves: ApprovedLeavePort;
  tenures: IMembershipTenurePort;
  /** T-047: mốc lưu của job retention (null khi job tắt). */
  retention: IRetentionWindow;
  users: IUserRefReader;
  hrAccess: IHrAccess;
  audit: IHrAuditRecorder;
  notifier: AttendanceNotifier;
  membership: AttendanceMembership;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface AttendanceModule {
  /** Router gắn tại `ATTENDANCE_PATH` (cần `authenticate` của auth). */
  routes(authenticate: RequestHandler): Router;
  /** Hiện thực `IWorkCalendarPort` của module leave (thiết kế §4). */
  workCalendar: AttendanceWorkCalendar;
}

/** Composition của module Attendance (ADR-016): wire nội bộ module, port ngoài được tiêm vào. */
export function createAttendanceModule(d: AttendanceModuleDeps): AttendanceModule {
  const deps: AttendanceDeps = {
    events: d.repos.events,
    calendar: d.repos.calendar,
    leaves: d.leaves,
    tenures: d.tenures,
    retention: d.retention,
    clock: d.clock,
    ids: d.ids,
    uow: d.uow,
  };
  const collaborators = {
    users: d.users,
    hrAccess: d.hrAccess,
    audit: d.audit,
    notifier: d.notifier,
  };
  const controller = new AttendanceController({
    checkInOut: new CheckInOutUseCase(deps),
    mine: new MyAttendanceQueries(deps),
    hr: new HrAttendanceQueries({ ...deps, users: d.users }),
    events: new AttendanceEventsUseCases({ ...deps, ...collaborators }),
    calendar: new WorkCalendarUseCases({ ...deps, ...collaborators }),
    exporter: new AttendanceExportUseCase({ ...deps, ...collaborators }),
    responder: d.responder,
  });
  return {
    routes: (authenticate) =>
      attendanceRoutes({ controller, membership: d.membership, authenticate, limit: d.limit }),
    workCalendar: new AttendanceWorkCalendar(d.repos.calendar),
  };
}
