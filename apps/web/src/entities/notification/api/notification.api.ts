import * as z from 'zod';

import { http } from '@/shared/api';
import { NotificationDto, UnreadNotificationCountDto } from '@taskflow/contracts/hr';

const base = '/me/notifications';
/** T-040: read / read-all trả 204 không body. */
const NoContent = z.undefined();

/** attendance-leave.md §5: chỉ của mình, chỉ workspace còn là thành viên. */
export const notificationApi = {
  list: (cursor?: string) =>
    http.request('GET', base, { schema: z.array(NotificationDto), query: { cursor, limit: 20 } }),
  unreadCount: () => http.get(`${base}/unread-count`, { schema: UnreadNotificationCountDto }),
  markRead: (id: string) =>
    http.post(`${base}/${encodeURIComponent(id)}/read`, { schema: NoContent }),
  markAllRead: () => http.post(`${base}/read-all`, { schema: NoContent }),
};
