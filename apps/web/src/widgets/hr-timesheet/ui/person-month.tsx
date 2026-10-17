'use client';

import { useState } from 'react';

import { MonthCalendar, MonthSummary } from '@/entities/attendance';
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
 * Lịch tháng của MỘT nhân viên — CÙNG ngôn ngữ với "Bảng công của tôi" (T-046): tổng kết từ server + lưới lịch T2→CN
 * (màu + biểu tượng + chữ ngắn). Múi giờ: mỗi ngày mang `timezone` riêng. Bấm ngày ⇒ lượt thô + sửa.
 */
export function PersonMonth({ wsId, month, row, today, canEdit }: Props) {
  const [date, setDate] = useState<string | null>(null);
  const timezone = row.days[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
  return (
    <section
      aria-label={`Bảng công của ${row.user.fullName}`}
      className="rounded-card border border-border bg-surface p-3"
    >
      <div className="flex flex-col gap-3">
        <MonthSummary totals={row.totals} title={`Tổng kết của ${row.user.fullName}`} />
        <MonthCalendar
          month={{ month, timezone, days: row.days, totals: row.totals }}
          caption={`${row.user.fullName}${row.left ? ' (đã rời)' : ''}`}
          onSelectDay={setDate}
          today={today}
        />
      </div>
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
