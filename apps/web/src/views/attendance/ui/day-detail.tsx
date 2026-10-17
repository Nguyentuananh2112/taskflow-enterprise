'use client';

import type { AttendanceDayDto } from '@taskflow/contracts/attendance';

import {
  EventsList,
  clockShort,
  dayLabel,
  dayText,
  duration,
  useMyAttendanceEvents,
} from '@/entities/attendance';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

type Props = Readonly<{
  wsId: string;
  day: AttendanceDayDto | null;
  /** Mọi ngày của tháng đang xem — "Ngày trước / Ngày sau" không vượt khỏi tháng. */
  days: readonly AttendanceDayDto[];
  today: string;
  onSelectDay: (date: string) => void;
  onClose: () => void;
}>;

/** Panel chi tiết một ngày (T-046): Giờ vào / Giờ ra / Số giờ làm bằng lời thường + lượt chấm của chính mình. */
export function DayDetail({ wsId, day, days, today, onSelectDay, onClose }: Props) {
  const events = useMyAttendanceEvents(wsId, day?.date ?? null);
  const text = day ? dayText(day, today) : null;
  const index = day ? days.findIndex((d) => d.date === day.date) : -1;
  const prev = index > 0 ? days[index - 1] : undefined;
  const next = index >= 0 ? days[index + 1] : undefined;
  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => !open && onClose()}
      title={day ? `Ngày ${dayLabel(day.date)}` : 'Chi tiết ngày'}
      titleClassName="text-2xl"
      // Lỡ bấm nhầm ô ⇒ đổi ngày ngay trong dialog; cũng để xem lần lượt từng ngày (demo TL d9).
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="secondary"
            disabled={!prev}
            onClick={() => prev && onSelectDay(prev.date)}
          >
            ‹ Ngày trước
          </Button>
          <Button
            variant="secondary"
            disabled={!next}
            onClick={() => next && onSelectDay(next.date)}
          >
            Ngày sau ›
          </Button>
        </div>
      }
      {...(text?.label
        ? { description: [text.label, text.detail].filter(Boolean).join(' · ') }
        : {})}
    >
      {day && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
          <dt>Giờ vào</dt>
          <dd className="font-semibold tabular-nums">
            {day.firstIn ? clockShort(day.firstIn, day.timezone) : '—'}
          </dd>
          <dt>Giờ ra</dt>
          <dd className="font-semibold tabular-nums">
            {day.lastOut ? clockShort(day.lastOut, day.timezone) : '—'}
          </dd>
          <dt>Số giờ làm</dt>
          <dd className="font-semibold">{day.workedMin > 0 ? duration(day.workedMin) : '—'}</dd>
        </dl>
      )}
      <h3 className="text-sm font-semibold">Lượt chấm</h3>
      {events.data && day ? (
        <EventsList data={events.data} date={day.date} />
      ) : events.isError ? (
        <p className="text-sm text-danger">Không tải được lượt chấm.</p>
      ) : (
        <p role="status" className="text-sm text-text-muted">
          Đang tải…
        </p>
      )}
    </Dialog>
  );
}
