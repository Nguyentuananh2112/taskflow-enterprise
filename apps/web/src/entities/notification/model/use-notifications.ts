import { queryOptions, useQuery } from '@tanstack/react-query';

import { notificationApi } from '../api/notification.api';

// Không thuộc workspace nào (chuông gộp mọi workspace) ⇒ gốc riêng ['notifications'].
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

/** Số chưa đọc — làm mới qua `notification:new` (realtime) và khi kết nối lại; dự phòng 2 phút. */
export const unreadCountQuery = () =>
  queryOptions({
    queryKey: notificationKeys.unread,
    queryFn: notificationApi.unreadCount,
    staleTime: 60_000,
  });

export function useUnreadCount() {
  return useQuery({ ...unreadCountQuery(), refetchInterval: 2 * 60_000 });
}

/** 20 thông báo mới nhất — chỉ tải khi mở chuông (`enabled`). */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: async () => (await notificationApi.list()).data,
    enabled,
    staleTime: 30_000,
  });
}
