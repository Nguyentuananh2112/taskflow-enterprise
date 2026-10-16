'use client';

import { minutesToClock } from '@/entities/attendance';
import { useSchedules } from '@/entities/hr';
import { ScheduleForm, workdaysText } from '@/features/hr-schedule-edit';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { HolidayList } from './holiday-list';

type Props = Readonly<{ wsId: string; today: string; isOwner: boolean; viewerId: string | null }>;

/** Lịch mặc định khi chưa có phiên bản nào (A — DEFAULT_SCHEDULE; attendance-leave.md §0). */
const DEFAULT = {
  timezone: 'Asia/Ho_Chi_Minh',
  workdays: 0b0111111,
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
};
const vn = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Tab "Lịch & ngày lễ" (ADR-121): các phiên bản lịch (đổi lịch chỉ hiệu lực từ hôm nay — tháng cũ giữ
 * nguyên) + form phiên bản mới, và ngày lễ theo năm.
 */
export function HrCalendar({ wsId, today, isOwner }: Props) {
  const schedules = useSchedules(wsId, true);
  const list = schedules.data ?? [];
  const current = list.filter((s) => s.effectiveFrom <= today).at(-1) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="hr-schedule" className="flex flex-col gap-3">
        <h2 id="hr-schedule" className="text-base font-semibold">
          Lịch làm việc
        </h2>
        {schedules.isError ? (
          <EmptyState
            title="Không tải được lịch"
            action={<Button onClick={() => void schedules.refetch()}>Thử lại</Button>}
          />
        ) : schedules.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {list.length === 0 && <li>Đang dùng lịch mặc định: {describe(DEFAULT)}.</li>}
              {list.map((s) => (
                <li key={s.effectiveFrom}>
                  <strong>Từ {vn(s.effectiveFrom)}</strong>
                  {s === current && ' (đang áp dụng)'}
                  {s.effectiveFrom > today && ' (sắp áp dụng)'}: {describe(s)} ·{' '}
                  {s.createdBy.fullName}
                </li>
              ))}
            </ul>
            <ScheduleForm
              key={current?.effectiveFrom ?? 'default'}
              wsId={wsId}
              today={today}
              current={current ?? DEFAULT}
            />
          </>
        )}
      </section>
      <HolidayList wsId={wsId} today={today} isOwner={isOwner} />
    </div>
  );
}

function describe(s: typeof DEFAULT): string {
  const pause =
    s.breakStartMin < s.breakEndMin
      ? `, nghỉ trưa ${minutesToClock(s.breakStartMin)}–${minutesToClock(s.breakEndMin)}`
      : '';
  const grace = s.graceMin > 0 ? `, cho phép muộn ${s.graceMin} phút` : '';
  return `${workdaysText(s.workdays)}, ${minutesToClock(s.startMin)}–${minutesToClock(s.endMin)}${pause}${grace} (${s.timezone})`;
}
