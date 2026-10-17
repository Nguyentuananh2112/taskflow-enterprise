import type { RequestHandler } from 'express';

import type { IClock } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { ILogger } from '../core/logging/logger';
import type { CompanyModule } from '../modules/company';
import {
  createHrProfileModule,
  NO_NEGATIVE_BALANCES,
  type HrProfileModule,
} from '../modules/hr-profile/hr-profile.module';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { Persistence } from './persistence';

/**
 * Module hr-profile (Mốc 5, T-054) với adapter thật: quyền / luật self / người từng là EMPLOYEE / audit ← company,
 * thông báo ← notifications. Phép âm khi đổi `hireDate` ← leave (D, T-057 — tới khi nối: `[]`).
 */
export function wireHrProfile(
  d: { persistence: Pick<Persistence, 'hrProfile' | 'uow'>; clock: IClock; logger: ILogger },
  m: {
    company: Pick<CompanyModule, 'access' | 'permissionsOf' | 'employeeRef' | 'hrAudit'>;
    notifications: Pick<NotificationsModule, 'publisher'>;
    timeZone: () => Promise<string>;
  },
  http: { responder: HttpResponder; limit: (rules: readonly RateLimitRule[]) => RequestHandler[] },
): HrProfileModule {
  return createHrProfileModule({
    repos: d.persistence.hrProfile,
    access: {
      authorizeWrite: (input) => m.company.access.authorizeWrite(input),
      permissionsOf: (userId) => m.company.permissionsOf(userId),
    },
    people: { employeeRef: (userId) => m.company.employeeRef(userId) },
    audit: { record: (input) => m.company.hrAudit.record(input) },
    notifier: { notify: (input) => m.notifications.publisher.notify(input) },
    leaveBalances: () => NO_NEGATIVE_BALANCES,
    uow: d.persistence.uow,
    clock: d.clock,
    timeZone: m.timeZone,
    logger: d.logger,
    ...http,
  });
}
