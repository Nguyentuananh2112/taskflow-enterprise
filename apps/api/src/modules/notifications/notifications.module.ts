import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { NotificationPublisher } from './application/notification-publisher';
import { NotificationQueries } from './application/notification.queries';
import type {
  CanManageHr,
  INotificationAudience,
  INotificationContextReader,
  INotificationRealtime,
  INotificationStore,
} from './application/ports';
import { InMemoryNotificationStore } from './infrastructure/in-memory-notification.store';
import { NotificationController, notificationRoutes } from './presentation/notification.controller';

export { NOTIFICATIONS_PATH } from './presentation/notification.controller';

export interface NotificationRepositories {
  store: INotificationStore;
  audience: INotificationAudience;
  context: INotificationContextReader;
}

/** Store InMemory (dev/test) — composition root thêm vào participants của `InMemoryUnitOfWork`. */
export function createInMemoryNotificationStore(): InMemoryNotificationStore {
  return new InMemoryNotificationStore();
}

export interface NotificationsModuleDeps {
  repos: NotificationRepositories;
  canManageHr: CanManageHr;
  realtime: INotificationRealtime;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  clock: IClock;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface NotificationsModule {
  /** Port ghi cho attendance / leave / workspace — nối ở composition root (ADR-093). */
  publisher: NotificationPublisher;
  routes(authenticate: RequestHandler): Router;
}

/** Composition của module notifications (ADR-016, ADR-123). */
export function createNotificationsModule(d: NotificationsModuleDeps): NotificationsModule {
  const { store, audience, context } = d.repos;
  const { canManageHr, clock } = d;
  const publisher = new NotificationPublisher({
    store,
    audience,
    canManageHr,
    realtime: d.realtime,
    uow: d.uow,
    ids: d.ids,
    clock,
  });
  const controller = new NotificationController({
    queries: new NotificationQueries({ store, audience, context, canManageHr, clock }),
    responder: d.responder,
  });
  return {
    publisher,
    routes: (authenticate) => notificationRoutes({ controller, authenticate, limit: d.limit }),
  };
}
