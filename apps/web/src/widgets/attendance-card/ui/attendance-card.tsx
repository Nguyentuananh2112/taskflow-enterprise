'use client';

import {
  dayStatusLabel,
  LEAVE_PART_LABEL,
  minutesToClock,
  timeOfDay,
  useAttendanceToday,
  useServerClock,
} from '@/entities/attendance';
import { CheckButtons } from '@/features/attendance-check';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

import { CARD_FRAME, CardNote, CardSkeleton } from './card-frame';

type Props = Readonly<{ enabled: boolean }>;

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

/**
 * Thẻ Chấm công GỌN ở trang chính (ADR-139): giờ server, ca, trạng thái, Vào/Ra, một nút. Ẩn với Admin (`enabled` =
 * `attendance:self`). Lối tắt Bảng công / Xin nghỉ nằm ngoài thẻ (`HomeShortcuts`).
 */
export function AttendanceCard({ enabled }: Props) {
  const today = useAttendanceToday(enabled);
  const clock = useServerClock(today.data?.serverNow, today.dataUpdatedAt);
  if (!enabled) return null;
  if (!today.data) {
    return today.isError ? (
      // Cùng khung ⇒ "Thử lại" thành công không đẩy nội dung bên dưới.
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
          <CheckButtons today={t} />
        </div>
      </div>
    </section>
  );
}
