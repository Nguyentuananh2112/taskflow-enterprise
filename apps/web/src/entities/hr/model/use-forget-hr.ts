import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { hrKeys } from './query-keys';

/**
 * Mất `hr:manage` (thu grant / hạ role — realtime) ⇒ xóa NGAY nhánh cache ['company', 'hr']: bảng công,
 * IP/UA, lý do nghỉ là dữ liệu cá nhân/nhạy cảm (§9, R27), không để lại cho tới khi hết gcTime.
 * `revoked` chỉ true khi đã biết quyền (role đã tải) và thiếu quyền.
 */
export function useForgetHrWhenRevoked(revoked: boolean): void {
  const client = useQueryClient();
  useEffect(() => {
    if (revoked) client.removeQueries({ queryKey: hrKeys.all() });
  }, [client, revoked]);
}
