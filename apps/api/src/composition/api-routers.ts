import type { RequestHandler, Router } from 'express';

import { ATTENDANCE_PATH } from '../modules/attendance/presentation/attendance.routes';
import { LEAVE_PATH } from '../modules/leave/presentation/leave.routes';
import { NOTIFICATIONS_PATH } from '../modules/notifications/notifications.module';
import { TASKS_PATH } from '../modules/task/presentation/task.routes';

type Mount = { path: string; router: Router };
type Routes = { routes(authenticate: RequestHandler): Router };

/**
 * Router của module dưới `/api/v1` theo đúng THỨ TỰ gắn — trả ra ngoài để test parity OpenAPI (A2) duyệt route thật.
 * Tách khỏi container (max-lines).
 */
export function apiRouters(m: {
  auth: { router: Router; authenticate: RequestHandler };
  company: { routers(authenticate: RequestHandler): Mount[] };
  hrProfile: { routers(authenticate: RequestHandler): Mount[] };
  payroll: { routers(authenticate: RequestHandler): Mount[] };
  task: Routes;
  attendance: Routes;
  leave: { router: Router };
  workspace: Routes;
  notifications: Routes;
}): Mount[] {
  const auth = m.auth.authenticate;
  return [
    { path: '/auth', router: m.auth.router },
    ...m.company.routers(auth),
    ...m.hrProfile.routers(auth),
    ...m.payroll.routers(auth),
    // Task TRƯỚC /workspaces: router workspace gắn authenticate + limiter cho mọi đường dẫn con ⇒
    // request task đi qua nó trước sẽ bị xác thực + đếm limiter 2 lần (audit T-028 F1).
    { path: TASKS_PATH, router: m.task.routes(auth) },
    // Attendance cũng TRƯỚC /workspaces (cùng lý do với Task).
    { path: ATTENDANCE_PATH, router: m.attendance.routes(auth) },
    { path: LEAVE_PATH, router: m.leave.router },
    { path: '/workspaces', router: m.workspace.routes(auth) },
    { path: NOTIFICATIONS_PATH, router: m.notifications.routes(auth) },
  ];
}
