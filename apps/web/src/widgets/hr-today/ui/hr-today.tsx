import type { AttendanceCompanyTodayDto, DayStatus } from '@taskflow/contracts/attendance';

import { DAY_STATUS, LEAVE_PART_LABEL, duration, timeOfDay } from '@/entities/attendance';
import { cn } from '@/shared/lib/cn';
import { EmptyState } from '@/shared/ui/empty-state';

type Props = Readonly<{ data: AttendanceCompanyTodayDto }>;

/** Thứ tự ô tổng: những gì HR cần xử lý trước (vắng, quên chấm ra) đứng đầu. */
const SUMMARY: readonly DayStatus[] = ['ABSENT', 'MISSING_OUT', 'PRESENT', 'ON_LEAVE', 'PENDING'];

/**
 * Tab "Hôm nay" (§6): ai vào / muộn / vắng / nghỉ. Trạng thái bằng CHỮ + biểu tượng (không chỉ màu);
 * giờ theo `timezone` của lịch. Người đã rời nhưng có lượt chấm hôm nay vẫn hiện (gắn nhãn — R30).
 */
export function HrToday({ data }: Props) {
  const count = (s: DayStatus) => data.members.filter((m) => m.day.status === s).length;
  const late = data.members.filter((m) => m.day.late).length;
  if (data.isHoliday || !data.isWorkday) {
    return (
      <EmptyState
        title={
          data.isHoliday
            ? `Hôm nay nghỉ lễ: ${data.holidayName ?? ''}`
            : 'Hôm nay không phải ngày làm việc'
        }
      />
    );
  }
  return (
    <section aria-labelledby="hr-today" className="flex flex-col gap-4">
      <h2 id="hr-today" className="sr-only">
        Chấm công hôm nay
      </h2>
      <ul aria-label="Tổng hợp hôm nay" className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {SUMMARY.map((s) => (
          <li key={s} className="rounded-card border border-border bg-surface p-3">
            <span className={cn('block text-xl font-semibold tabular-nums', DAY_STATUS[s].tone)}>
              {count(s)}
            </span>
            <span className="text-xs text-text-muted">
              <span aria-hidden="true">{DAY_STATUS[s].icon} </span>
              {DAY_STATUS[s].label}
            </span>
          </li>
        ))}
        <li className="rounded-card border border-border bg-surface p-3">
          <span className="block text-xl font-semibold tabular-nums text-warning">{late}</span>
          <span className="text-xs text-text-muted">Đi muộn</span>
        </li>
      </ul>
      {/* Bảng không có phần tử focus được ⇒ khung cuộn tự nhận focus để cuộn bằng bàn phím ở 360
          (axe scrollable-region-focusable); `relative` giữ `sr-only` bên trong khung (không kéo rộng trang). */}
      <div
        role="region"
        aria-label="Bảng chấm công hôm nay"
        tabIndex={0}
        className="relative overflow-x-auto"
      >
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">Chấm công từng người hôm nay</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Nhân viên
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
              <th scope="col" className="py-2 font-medium">
                Ghi chú
              </th>
            </tr>
          </thead>
          <tbody>
            {data.members.map(({ user, left, day }) => {
              const s = DAY_STATUS[day.status];
              const notes = [
                day.lateMin > 0 && `muộn ${duration(day.lateMin)}`,
                day.earlyMin > 0 && `về sớm ${duration(day.earlyMin)}`,
                day.leave && day.leave !== 'FULL' && `nghỉ ${LEAVE_PART_LABEL[day.leave]}`,
                day.inProgress && 'đang làm',
              ].filter(Boolean);
              return (
                <tr key={user.id} className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {user.fullName}
                    {left && <span className="font-normal text-text-muted"> (đã rời)</span>}
                  </th>
                  <td className={cn('py-2 pr-3', s.tone)}>
                    <span aria-hidden="true">{s.icon} </span>
                    {s.label}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {day.firstIn ? timeOfDay(day.firstIn, day.timezone, day.date) : '—'}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {day.lastOut ? timeOfDay(day.lastOut, day.timezone, day.date) : '—'}
                  </td>
                  <td className="py-2">{notes.length > 0 ? notes.join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
