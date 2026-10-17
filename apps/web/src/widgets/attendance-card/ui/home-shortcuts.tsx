'use client';

import { useAttendanceToday } from '@/entities/attendance';
import { Skeleton } from '@/shared/ui/skeleton';

import { AttendanceShortcuts } from './attendance-shortcuts';

/**
 * Lối tắt của nhân viên ở trang chính (ADR-139 mục 3): Bảng công · Xin nghỉ (số phép còn) · Đơn nghỉ của tôi. "Nhân
 * sự" nằm ở khối "Việc quản lý" ⇒ không lặp ở đây. Năm số phép theo ngày của SERVER ⇒ chờ `me/today`; trong lúc chờ
 * giữ CÙNG lưới (không layout-shift).
 */
export function HomeShortcuts({ enabled }: Readonly<{ enabled: boolean }>) {
  const today = useAttendanceToday(enabled).data;
  if (!enabled) return null;
  if (!today) {
    return (
      <div aria-hidden="true" className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        <Skeleton className="h-12 md:h-9 md:w-36" />
        <Skeleton className="h-12 md:h-9 md:w-40" />
        <Skeleton className="h-12 md:h-9 md:w-40" />
        <Skeleton className="h-12 md:h-9 md:w-28" />
      </div>
    );
  }
  return <AttendanceShortcuts today={today.date} />;
}
