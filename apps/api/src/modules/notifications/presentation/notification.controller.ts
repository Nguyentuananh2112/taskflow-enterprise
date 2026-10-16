import { ListNotificationsQuery, NotificationParams } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { afterFromCursor, pageMeta } from '../../../core/http/pagination';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { NotificationQueries } from '../application/notification.queries';

/** Mount dưới `/api/v1` (container) — cursor gắn với endpoint này (`afterFromCursor` kiểm uuid). */
export const NOTIFICATIONS_PATH = '/me/notifications';
const CURSOR_KIND = 'notifications';

export interface NotificationControllerDeps {
  queries: Pick<NotificationQueries, 'list' | 'unreadCount' | 'markRead' | 'markAllRead'>;
  responder: HttpResponder;
}

/** userId luôn lấy từ access token (`requireUser`) — không route nào nhận userId của người khác. */
export class NotificationController {
  constructor(private readonly d: NotificationControllerDeps) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListNotificationsQuery;
    const page = await this.d.queries.list(requireUser(req).id, {
      after: afterFromCursor(CURSOR_KIND, query.cursor),
      limit: query.limit,
    });
    this.d.responder.ok(res, page.items, pageMeta(CURSOR_KIND, page.nextAfter, query.limit));
  };

  unreadCount = async (req: Request, res: Response) => {
    this.d.responder.ok(res, { count: await this.d.queries.unreadCount(requireUser(req).id) });
  };

  markRead = async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    await this.d.queries.markRead(requireUser(req).id, id);
    res.status(204).end();
  };

  markAllRead = async (req: Request, res: Response) => {
    await this.d.queries.markAllRead(requireUser(req).id);
    res.status(204).end();
  };
}

/** Thứ tự mỗi route: authenticate → rate limit theo user → validate → controller. */
export function notificationRoutes(d: {
  controller: NotificationController;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  const c = d.controller;
  const authed = [d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  router.get('/', ...authed, validate({ query: ListNotificationsQuery }), c.list);
  router.get('/unread-count', ...authed, c.unreadCount);
  router.post('/read-all', ...authed, c.markAllRead);
  router.post('/:id/read', ...authed, validate({ params: NotificationParams }), c.markRead);
  return router;
}
