'use client';

import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { Button } from '@/shared/ui/button';

import { newCheckKey, useAttendanceCheck } from '../model/use-attendance-check';

type Props = Readonly<{ today: AttendanceTodayDto; size?: 'sm' | 'md' }>;

/**
 * Vào / Ra theo trạng thái hôm nay: chưa vào ⇒ "Chấm vào"; đã vào ⇒ "Chấm ra"; đã ra ⇒ "Chấm ra lại"
 * (lượt mới, server lấy lượt muộn nhất — §4). Chấm cả ngày nghỉ/lễ vẫn được (ghi nhận, giờ thô).
 */
export function CheckButtons({ today, size = 'md' }: Props) {
  const check = useAttendanceCheck();
  const kind = today.firstIn ? 'OUT' : 'IN';
  const label = !today.firstIn ? 'Chấm vào' : today.lastOut ? 'Chấm ra lại' : 'Chấm ra';
  return (
    <Button
      size={size}
      variant={kind === 'IN' ? 'primary' : 'secondary'}
      loading={check.isPending}
      onClick={() => check.mutate({ kind, key: newCheckKey() })}
    >
      {label}
    </Button>
  );
}
