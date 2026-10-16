import { useMutation } from '@tanstack/react-query';

import { notificationApi, notificationKeys } from '@/entities/notification';

/** Đánh dấu đã đọc một / tất cả ⇒ làm mới danh sách + số chưa đọc. */
export function useMarkRead() {
  return useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSettled: (_d, _e, _v, _r, context) =>
      void context.client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  return useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSettled: (_d, _e, _v, _r, context) =>
      void context.client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
