import { NotificationDto, UnreadNotificationCountDto } from '@taskflow/contracts/hr';
import { NotificationNewEvent } from '@taskflow/contracts/realtime';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { authenticate } from './mock-guard';
import { noContent, ok } from './respond';
import { userRoom } from './workspace-events';

// Thông báo bền (ADR-123, attendance-leave.md §5): chỉ của mình; chỉ workspace còn là thành viên;
// ghi xong ⇒ `notification:new` (chỉ id + loại) tới `user:{id}`. Ngữ cảnh (tên workspace / người /
// khoảng ngày nghỉ, KHÔNG lý do) join lúc đọc — ở mock lưu sẵn trong bản ghi.

type Stored = NotificationDto & { recipientId: string };

export class MockNotifications {
  #items: Stored[] = [];
  constructor(
    private readonly board: MockBoard,
    private readonly now: () => number,
  ) {}

  /** Tạo thông báo cho `recipientId` (test/dev) và phát `notification:new`. */
  notify(
    recipientId: string,
    n: Omit<NotificationDto, 'id' | 'readAt' | 'createdAt'>,
  ): NotificationDto {
    const item: Stored = {
      ...n,
      id: crypto.randomUUID(),
      readAt: null,
      createdAt: new Date(this.now()).toISOString(),
      recipientId,
    };
    this.#items.unshift(item);
    this.board.publish({
      room: userRoom(recipientId),
      name: 'notification:new',
      payload: NotificationNewEvent.parse({
        eventId: crypto.randomUUID(),
        type: 'notification:new',
        occurredAt: item.createdAt,
        actorId: n.actor?.id ?? recipientId,
        originClientId: null,
        data: { notificationId: item.id, type: item.type, workspaceId: item.workspaceId },
      }),
    });
    return item;
  }

  of(userId: string, db: MockDb): Stored[] {
    return this.#items.filter(
      (n) => n.recipientId === userId && db.membershipIn(userId, n.workspaceId),
    );
  }
}

const strip = ({ recipientId: _r, ...dto }: Stored): NotificationDto => dto;

export function createNotificationHandlers(
  baseUrl: string,
  db: MockDb,
  notifications: MockNotifications,
): HttpHandler[] {
  const base = `${baseUrl}/me/notifications`;
  return [
    http.get(base, ({ request }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      return ok(z.array(NotificationDto), notifications.of(auth.ok.id, db).slice(0, 20).map(strip));
    }),
    http.get(`${base}/unread-count`, ({ request }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      const count = notifications.of(auth.ok.id, db).filter((n) => n.readAt === null).length;
      return ok(UnreadNotificationCountDto, { count });
    }),
    http.post(`${base}/read-all`, ({ request }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      const at = new Date().toISOString();
      for (const n of notifications.of(auth.ok.id, db)) n.readAt ??= at;
      return noContent();
    }),
    http.post(`${base}/:id/read`, ({ request, params }) => {
      const auth = authenticate(request, db);
      if (auth.response) return auth.response;
      const hit = notifications.of(auth.ok.id, db).find((n) => n.id === params.id);
      if (hit) hit.readAt ??= new Date().toISOString();
      return noContent();
    }),
  ];
}
