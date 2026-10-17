'use client';

import { useState } from 'react';

import { MonthTable } from '@/entities/attendance';
import { DayPunchesDialog } from '@/features/hr-attendance-adjust';
import type { AttendanceMemberMonthDto } from '@taskflow/contracts/attendance';

type Props = Readonly<{
  wsId: string;
  month: string;
  row: AttendanceMemberMonthDto;
  /** Ngày theo lịch (server). */
  today: string;
  canEdit: boolean;
}>;

/**
 * Lịch tháng của MỘT nhân viên (dùng lại `MonthTable` — `<table>` có tiêu đề hàng/cột, trạng thái bằng
 * chữ + biểu tượng). Múi giờ: của ngày đầu tháng (A — mỗi ngày mang `timezone` riêng; đổi lịch giữa
 * tháng hiếm, các ô vẫn dùng giờ ISO). Bấm ngày ⇒ lượt thô + sửa.
 */
export function PersonMonth({ wsId, month, row, today, canEdit }: Props) {
  const [date, setDate] = useState<string | null>(null);
  const timezone = row.days[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
  return (
    <section
      aria-label={`Bảng công của ${row.user.fullName}`}
      className="rounded-card border border-border bg-surface p-3"
    >
      <MonthTable
        month={{ month, timezone, days: row.days, totals: row.totals }}
        caption={`${row.user.fullName}${row.left ? ' (đã rời)' : ''}`}
        onSelectDay={setDate}
        today={today}
      />
      <DayPunchesDialog
        wsId={wsId}
        user={row.user}
        date={date}
        onClose={() => setDate(null)}
        readOnlyReason={
          !canEdit
            ? 'Bạn không tự sửa chấm công của mình — nhờ người khác có quyền Quản lý nhân sự.'
            : date !== null && date > today
              ? 'Ngày chưa tới — chưa thêm lượt chấm được.'
              : null
        }
      />
    </section>
  );
}
