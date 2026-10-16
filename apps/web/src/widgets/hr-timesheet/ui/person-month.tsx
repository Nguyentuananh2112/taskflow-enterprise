'use client';

import { useState } from 'react';

import { MonthTable } from '@/entities/attendance';
import { DayPunchesDialog } from '@/features/hr-attendance-adjust';
import type { AttendanceMemberMonthDto } from '@/shared/api/m3-provisional';

type Props = Readonly<{
  wsId: string;
  month: string;
  row: AttendanceMemberMonthDto;
  canEdit: boolean;
}>;

/**
 * Lịch tháng của MỘT nhân viên (dùng lại `MonthTable` — `<table>` có tiêu đề hàng/cột, trạng thái bằng
 * chữ + biểu tượng). Múi giờ: của ngày đầu tháng (A — mỗi ngày mang `timezone` riêng; đổi lịch giữa
 * tháng hiếm, các ô vẫn dùng giờ ISO). Bấm ngày ⇒ lượt thô + sửa.
 */
export function PersonMonth({ wsId, month, row, canEdit }: Props) {
  const [date, setDate] = useState<string | null>(null);
  const timezone = row.days[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
  return (
    <section
      aria-label={`Bảng công của ${row.user.fullName}`}
      className="rounded-card border border-border bg-surface p-3"
    >
      <MonthTable
        month={{ month, timezone, days: row.days }}
        caption={`${row.user.fullName}${row.left ? ' (đã rời)' : ''}`}
        onSelectDay={setDate}
      />
      <DayPunchesDialog
        wsId={wsId}
        user={row.user}
        date={date}
        onClose={() => setDate(null)}
        canEdit={canEdit}
      />
    </section>
  );
}
