import type { AttendanceMonthDto } from '@taskflow/contracts/attendance';

import { cn } from '@/shared/lib/cn';

import { DAY_STATUS, LEAVE_PART_LABEL } from '../lib/labels';
import { dayLabel, duration, timeOfDay } from '../lib/time';

type Props = Readonly<{
  month: AttendanceMonthDto;
  caption: string;
  /** Bấm ngày ⇒ xem lượt chấm (trang của tôi). */
  onSelectDay?: (date: string) => void;
  /** "Hôm nay" THEO SERVER (múi giờ của lịch) — đánh dấu hàng, không dùng giờ máy. */
  today?: string | undefined;
}>;

/**
 * Bảng công tháng (attendance-leave.md §6, E2E-HR-07): `<table>` có tiêu đề cột + tiêu đề HÀNG (ngày),
 * trạng thái bằng CHỮ + biểu tượng `aria-hidden` (không chỉ màu). Giờ theo `timezone` của lịch.
 */
export function MonthTable({ month, caption, onSelectDay, today }: Props) {
  const { timezone: tz } = month;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Ngày
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Trạng thái
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Vào
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Ra
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Giờ làm
            </th>
            <th scope="col" className="py-2 font-medium">
              Muộn / sớm
            </th>
          </tr>
        </thead>
        <tbody>
          {month.days.map((d) => {
            const s = DAY_STATUS[d.status];
            const notes = [
              d.lateMin > 0 && `muộn ${duration(d.lateMin)}`,
              d.earlyMin > 0 && `sớm ${duration(d.earlyMin)}`,
            ].filter(Boolean);
            return (
              <tr
                key={d.date}
                aria-current={d.date === today ? 'date' : undefined}
                className={cn(
                  'border-b border-border',
                  !d.isWorkday && 'bg-bg-subtle',
                  d.date === today && 'font-semibold',
                )}
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal whitespace-nowrap">
                  {onSelectDay ? (
                    <button
                      type="button"
                      onClick={() => onSelectDay(d.date)}
                      className="rounded-control text-left text-primary hover:underline"
                    >
                      {dayLabel(d.date)}
                    </button>
                  ) : (
                    dayLabel(d.date)
                  )}
                  {/* Chỉ để nhìn: trình đọc màn hình đã nghe `aria-current="date"`; tên rowheader giữ dạng "Th 3, 21/10" (locator E2E neo "dd/MM" ở cuối). */}
                  {d.date === today && (
                    <span aria-hidden="true" className="text-text-muted">
                      {' '}
                      · hôm nay
                    </span>
                  )}
                </th>
                <td className={cn('py-2 pr-3', s.tone)}>
                  <span aria-hidden="true">{s.icon} </span>
                  {s.label}
                  {d.holidayName && <span className="text-text-muted"> · {d.holidayName}</span>}
                  {d.leave && d.leave !== 'FULL' && (
                    <span className="text-text-muted"> · nghỉ {LEAVE_PART_LABEL[d.leave]}</span>
                  )}
                  {d.absentHalf && <span className="text-text-muted"> · vắng nửa ngày</span>}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {d.firstIn ? timeOfDay(d.firstIn, tz, d.date) : '—'}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {d.lastOut ? timeOfDay(d.lastOut, tz, d.date) : '—'}
                </td>
                <td className="py-2 pr-3">{d.workedMin > 0 ? duration(d.workedMin) : '—'}</td>
                <td className="py-2">{notes.length > 0 ? notes.join(', ') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
