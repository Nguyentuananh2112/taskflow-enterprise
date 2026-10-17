'use client';

import { useAttendanceToday } from '@/entities/attendance';
import { useCompanyPermission } from '@/entities/session';
import { CheckButtons } from '@/features/attendance-check';

/**
 * Nút gọn Vào/Ra trên header ở MỌI trang (ADR-139 — chấm công thuộc công ty, không theo workspace). Dùng chung cache
 * "hôm nay" với thẻ Chấm công. Ẩn ở màn hẹp (thẻ gọn ở trang chính đã có nút) và với Admin (không phải nhân viên).
 */
export function HeaderAttendance() {
  const allowed = useCompanyPermission().can('attendance:self');
  const today = useAttendanceToday(allowed);
  if (!allowed || !today.data) return null;
  return (
    <div className="hidden sm:block">
      <CheckButtons today={today.data} size="sm" />
    </div>
  );
}
