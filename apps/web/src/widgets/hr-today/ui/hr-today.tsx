import type { AttendanceCompanyTodayDto, DayStatus } from '@taskflow/contracts/attendance';

import {
  DAY_STATUS,
  LEAVE_PART_LABEL,
  NOT_CHECKED_IN,
  dayStatusLabel,
  duration,
  timeOfDay,
} from '@/entities/attendance';
import { cn } from '@/shared/lib/cn';
import { EmptyState } from '@/shared/ui/empty-state';

type Props = Readonly<{ data: AttendanceCompanyTodayDto }>;

type Day = AttendanceCompanyTodayDto['members'][number]['day'];
type Bucket = Readonly<{
  key: string;
  label: string;
  icon: string;
  tone: string;
  match: (d: Day) => boolean;
}>;
const byStatus = (s: DayStatus): Bucket => ({
  key: s,
  ...DAY_STATUS[s],
  match: (d) => d.status === s,
});

/**
 * Thứ tự ô tổng: những gì HR cần xử lý trước (vắng, chưa chấm công, quên chấm ra) đứng đầu. PENDING tách đôi theo
 * `notCheckedInYet` (đã tới giờ vào ca mà chưa chấm ≠ chưa tới giờ — demo TL d9).
 */
const SUMMARY: readonly Bucket[] = [
  byStatus('ABSENT'),
  {
    key: 'NOT_CHECKED_IN',
    ...NOT_CHECKED_IN,
    match: (d) => d.status === 'PENDING' && d.notCheckedInYet,
  },
  byStatus('MISSING_OUT'),
  byStatus('PRESENT'),
  byStatus('ON_LEAVE'),
  { ...byStatus('PENDING'), match: (d) => d.status === 'PENDING' && !d.notCheckedInYet },
];

/**
 * Tab "Hôm nay" (§6): ai vào / muộn / vắng / nghỉ. Trạng thái bằng CHỮ + biểu tượng (không chỉ màu);
 * giờ theo `timezone` của lịch. Người đã rời nhưng có lượt chấm hôm nay vẫn hiện (gắn nhãn — R30).
 */
export function HrToday({ data }: Props) {
  const count = (b: Bucket) => data.members.filter((m) => b.match(m.day)).length;
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
      <ul
        aria-label="Tổng hợp hôm nay"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      >
        {SUMMARY.map((b) => (
          <li key={b.key} className="rounded-card border border-border bg-surface p-3">
            <span className={cn('block text-xl font-semibold tabular-nums', b.tone)}>
              {count(b)}
            </span>
            <span className="text-xs text-text-muted">
              <span aria-hidden="true">{b.icon} </span>
              {b.label}
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
              const s = dayStatusLabel(day);
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
