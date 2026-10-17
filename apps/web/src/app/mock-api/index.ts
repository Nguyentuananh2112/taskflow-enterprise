import { createActivationHandlers } from './activation-handlers';
import { createAdminHandlers } from './admin-handlers';
import { createAttendanceHandlers } from './attendance-handlers';
import { createEmployeeHandlers } from './employee-handlers';
import { createAuthHandlers } from './auth-handlers';
import { createHrAttendanceHandlers } from './hr-attendance-handlers';
import { createHrCalendarHandlers } from './hr-calendar-handlers';
import { createHrLeaveHandlers } from './hr-leave-handlers';
import { createLeaveHandlers } from './leave-handlers';
import { MockLeave } from './mock-leave';
import { MockAttendance } from './mock-attendance';
import { MockBoard } from './mock-board';
import { MockDb, type MockDbOptions } from './mock-db';
import { MockHr } from './mock-hr';
import { MockPayroll } from './mock-payroll';
import { createPayrollEditHandlers } from './payroll-edit-handlers';
import { createPayrollRunHandlers } from './payroll-run-handlers';
import { createPayslipHandlers } from './payslip-handlers';
import { createMemberHandlers } from './member-handlers';
import { MockNotifications, createNotificationHandlers } from './notification-handlers';
import { createProjectHandlers } from './project-handlers';
import { contentTypeGuard, createRateLimiter } from './request-guards';
import { setMockClock } from './respond';
import { createTaskHandlers } from './task-handlers';
import { createWorkspaceHandlers } from './workspace-handlers';

// Mock API (T-019, T-025): cùng bộ handler MSW dùng cho test (setupServer) và cho dev (route handler
// app/mock-api/v1/[...path] khi APP_MOCK_API=1). Hành vi theo data-and-api.md; event realtime phát
// qua `board.onEvent` (test nối vào socket giả).

export { MockBoard, type BoardEvent } from './mock-board';
export { MockDb, REFRESH_GRACE_MS, type MockDbOptions } from './mock-db';
export { isMockApiEnabled } from './mock-flag';

export type MockApiOptions = MockDbOptions &
  Readonly<{
    /** Origin được gọi `/auth/refresh` + `/auth/logout` (CORS_ORIGINS). Mặc định: origin của baseUrl. */
    allowedOrigins?: readonly string[];
  }>;

/** `baseUrl` = API_URL (gồm `/api/v1`, không có `/` cuối). */
export function createMockApi(baseUrl: string, options: MockApiOptions = {}) {
  const board = new MockBoard(options.now ?? Date.now);
  const db = new MockDb({
    ...options,
    // ADR-103: workspace mặc định có sẵn project "Dự án đầu tiên" (keyPrefix TF).
    onWorkspaceCreated: (workspaceId) => {
      board.createProject(workspaceId, { name: 'Dự án đầu tiên', keyPrefix: 'TF' });
      options.onWorkspaceCreated?.(workspaceId);
    },
  });
  const allowedOrigins = new Set(options.allowedOrigins ?? [new URL(baseUrl).origin]);
  setMockClock(options.now ?? Date.now);
  const limit = createRateLimiter(options.now ?? Date.now);
  const attendance = new MockAttendance(options.now ?? Date.now);
  const notifications = new MockNotifications(board, options.now ?? Date.now);
  const leave = new MockLeave(attendance, options.now ?? Date.now);
  const hr = new MockHr(db, attendance, leave);
  const payroll = new MockPayroll(hr);
  return {
    db,
    board,
    attendance,
    notifications,
    leave,
    hr,
    payroll,
    handlers: [
      contentTypeGuard(baseUrl),
      ...createAuthHandlers(baseUrl, db, allowedOrigins),
      ...createActivationHandlers(baseUrl, db),
      ...createAdminHandlers(baseUrl, db),
      ...createWorkspaceHandlers(baseUrl, db, board, limit),
      ...createMemberHandlers(baseUrl, db, board, limit),
      ...createProjectHandlers(baseUrl, db, board),
      ...createTaskHandlers(baseUrl, db, board),
      ...createAttendanceHandlers(baseUrl, db, attendance),
      ...createNotificationHandlers(baseUrl, db, notifications),
      // HR trước leave của E: `GET leave-requests` không có `mine` thuộc HR (T-041c).
      ...createHrLeaveHandlers(baseUrl, hr, notifications),
      ...createHrAttendanceHandlers(baseUrl, hr),
      ...createHrCalendarHandlers(baseUrl, hr),
      ...createEmployeeHandlers(baseUrl, hr),
      ...createLeaveHandlers(baseUrl, db, leave),
      ...createPayslipHandlers(baseUrl, payroll, db),
      ...createPayrollEditHandlers(baseUrl, payroll, db),
      ...createPayrollRunHandlers(baseUrl, payroll, db, attendance.today),
    ],
  };
}

export type MockApi = ReturnType<typeof createMockApi>;
