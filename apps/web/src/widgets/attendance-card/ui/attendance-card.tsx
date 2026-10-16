'use client';

import Link from 'next/link';

import {
  DAY_STATUS,
  LEAVE_PART_LABEL,
  minutesToClock,
  timeOfDay,
  useAttendanceToday,
  useServerClock,
} from '@/entities/attendance';
import { CheckButtons } from '@/features/attendance-check';
import { cn } from '@/shared/lib/cn';
import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { Alert } from '@/shared/ui/alert';
import { Skeleton } from '@/shared/ui/skeleton';

type Props = Readonly<{ wsId: string; enabled: boolean }>;

const clockFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
const dayFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/** Ngày làm, chưa vào, không nghỉ cả ngày, không lễ ⇒ nhắc (KHÔNG tự chấm — §6). */
const needsReminder = (t: AttendanceTodayDto) =>
  t.isWorkday && !t.isHoliday && t.leave !== 'FULL' && !t.firstIn && t.status !== 'ABSENT';

/** Thẻ Chấm công đầu trang danh sách dự án (attendance-leave.md §6). Ẩn với VIEWER (`enabled`). */
export function AttendanceCard({ wsId, enabled }: Props) {
  const today = useAttendanceToday(wsId, enabled);
  const clock = useServerClock(today.data?.serverNow, today.dataUpdatedAt);
  if (!enabled) return null;
  if (!today.data) {
    return today.isError ? null : (
      <div
        role="status"
        aria-busy="true"
        aria-label="Đang tải chấm công"
        className="rounded-card border border-border p-4"
      >
        <Skeleton className="h-16" />
      </div>
    );
  }
  const t = today.data;
  const status = DAY_STATUS[t.status];
  return (
    <section
      aria-labelledby="attendance-heading"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card"
    >
      {needsReminder(t) && <Alert tone="info">Bạn chưa chấm vào hôm nay.</Alert>}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 id="attendance-heading" className="text-base font-semibold">
            Chấm công
          </h2>
          <p className="text-sm text-text-muted">
            {clock === null ? '' : dayFormat(t.timezone).format(clock)}
          </p>
          <p className="font-mono text-2xl tabular-nums" aria-label="Giờ hiện tại theo máy chủ">
            {clock === null ? '--:--:--' : clockFormat(t.timezone).format(clock)}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-text-muted">Ca</dt>
          <dd>
            {t.isHoliday
              ? `Ngày lễ${t.holidayName ? `: ${t.holidayName}` : ''}`
              : t.schedule
                ? `${minutesToClock(t.schedule.startMin)}–${minutesToClock(t.schedule.endMin)}`
                : 'Hôm nay không phải ngày làm việc'}
          </dd>
          <dt className="text-text-muted">Trạng thái</dt>
          <dd className={cn('font-medium', status.tone)}>
            <span aria-hidden="true">{status.icon} </span>
            {t.inProgress ? 'Đang làm' : status.label}
            {t.late && ' · đi muộn'}
            {t.early && ' · về sớm'}
            {t.leave && t.leave !== 'FULL' && ` · nghỉ ${LEAVE_PART_LABEL[t.leave]}`}
          </dd>
          <dt className="text-text-muted">Vào / Ra</dt>
          <dd>
            {t.firstIn ? timeOfDay(t.firstIn, t.timezone, t.date) : '—'} /{' '}
            {t.lastOut ? timeOfDay(t.lastOut, t.timezone, t.date) : '—'}
          </dd>
        </dl>
        <div className="flex items-center gap-3 sm:ml-auto">
          <CheckButtons wsId={wsId} today={t} />
          <Link href={`/w/${wsId}/attendance`} className="text-sm text-primary hover:underline">
            Bảng công của tôi
          </Link>
        </div>
      </div>
    </section>
  );
}
