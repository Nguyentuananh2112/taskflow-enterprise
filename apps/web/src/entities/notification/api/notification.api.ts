import * as z from 'zod';

import { http } from '@/shared/api';
import { NotificationDto, UnreadNotificationCountDto } from '@taskflow/contracts/hr';

const base = '/me/notifications';

/** attendance-leave.md §5: chỉ của mình, chỉ workspace còn là thành viên. */
export const notificationApi = {
  list: (cursor?: string) =>
    http.request('GET', base, { schema: z.array(NotificationDto), query: { cursor, limit: 20 } }),
  unreadCount: () => http.get(`${base}/unread-count`, { schema: UnreadNotificationCountDto }),
  markRead: (id: string) =>
    http.post(`${base}/${encodeURIComponent(id)}/read`, { schema: z.unknown() }),
  markAllRead: () => http.post(`${base}/read-all`, { schema: z.unknown() }),
};
