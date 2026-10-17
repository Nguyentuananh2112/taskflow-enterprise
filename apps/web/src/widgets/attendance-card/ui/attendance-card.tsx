'use client';

import {
  dayStatusLabel,
  LEAVE_PART_LABEL,
  minutesToClock,
  timeOfDay,
  useAttendanceToday,
  useServerClock,
} from '@/entities/attendance';
import { usePermission } from '@/entities/workspace';
import { CheckButtons } from '@/features/attendance-check';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

import { AttendanceShortcuts } from './attendance-shortcuts';
import { CARD_FRAME, CardNote, CardSkeleton } from './card-frame';

type Props = Readonly<{
  wsId: string;
  enabled: boolean;
  /**
   * Quyền chưa biết (workspace đang tải) ⇒ vẫn giữ chỗ bằng skeleton — tránh thẻ "xuất hiện" sau đó đẩy danh sách
   * dự án xuống (E2E-HR-14, demo TL d9). Biết là VIEWER ⇒ không có thẻ.
   */
  pending?: boolean;
}>;

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

/** Thẻ Chấm công đầu trang danh sách dự án (attendance-leave.md §6). Ẩn với VIEWER (`enabled`). */
export function AttendanceCard({ wsId, enabled, pending = false }: Props) {
  const today = useAttendanceToday(wsId, enabled);
  const clock = useServerClock(today.data?.serverNow, today.dataUpdatedAt);
  const canManageHr = usePermission(wsId).can('hr:manage');
  if (!enabled) return pending ? <CardSkeleton /> : null;
  if (!today.data) {
    return today.isError ? (
      // Cùng khung ⇒ "Thử lại" thành công không đẩy danh sách dự án.
      <div className={`${CARD_FRAME} justify-center`}>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Không tải được chấm công.
          <Button variant="secondary" size="sm" onClick={() => void today.refetch()}>
            Thử lại
          </Button>
        </p>
      </div>
    ) : (
      <CardSkeleton />
    );
  }
  const t = today.data;
  const status = dayStatusLabel(t);
  return (
    <section aria-labelledby="attendance-heading" className={CARD_FRAME}>
      <CardNote today={t} />
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 id="attendance-heading" className="text-base font-semibold">
            Chấm công
          </h2>
          <p className="text-sm text-text-muted">
            {clock === null ? '' : dayFormat(t.timezone).format(clock)}
          </p>
          <p className="font-mono text-2xl tabular-nums">
            <span className="sr-only">Giờ hiện tại theo máy chủ: </span>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 whitespace-nowrap sm:ml-auto">
          <CheckButtons wsId={wsId} today={t} />
        </div>
      </div>
      <AttendanceShortcuts wsId={wsId} today={t.date} canManageHr={canManageHr} />
    </section>
  );
}
