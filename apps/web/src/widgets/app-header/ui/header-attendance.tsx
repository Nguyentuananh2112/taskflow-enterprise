'use client';

import { Uuid } from '@taskflow/contracts/common';
import { useParams } from 'next/navigation';

import { useAttendanceToday } from '@/entities/attendance';
import { usePermission } from '@/entities/workspace';
import { CheckButtons } from '@/features/attendance-check';

/**
 * Nút gọn Vào/Ra trên header khi đang ở route có `wsId` (attendance-leave.md §6). Dùng chung cache
 * "hôm nay" với thẻ Chấm công. Ẩn ở màn hẹp (thẻ ở đầu trang dự án đã có nút) và với VIEWER.
 */
export function HeaderAttendance() {
  const { wsId } = useParams<{ wsId?: string }>();
  const id = wsId && Uuid.safeParse(wsId).success ? wsId : '';
  const { can } = usePermission(id);
  const allowed = id !== '' && can('attendance:self');
  const today = useAttendanceToday(id, allowed);
  if (!allowed || !today.data) return null;
  return (
    <div className="hidden sm:block">
      <CheckButtons wsId={id} today={today.data} size="sm" />
    </div>
  );
}
