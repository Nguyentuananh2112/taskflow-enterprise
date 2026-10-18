'use client';

import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';

import { clockShort, LEAVE_PART_LABEL } from '@/entities/attendance';
import { CheckButtons } from '@/features/attendance-check';

type Props = Readonly<{ today: AttendanceTodayDto }>;

const longDay = (t: AttendanceTodayDto) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: t.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).format(new Date(t.serverNow));

/**
 * Câu trạng thái hôm nay bằng lời thường (T-046). Ngày lễ / ngày nghỉ CÓ lượt chấm (TL #A1) ⇒ "Đang làm" / "Đã chấm ra"
 * kèm nhãn "ngày lễ" / "ngày nghỉ".
 */
export function statusText(t: AttendanceTodayDto): string {
  if (t.isHoliday && !t.firstIn)
    return `Hôm nay nghỉ lễ${t.holidayName ? `: ${t.holidayName}` : ''}`;
  if (t.leave === 'FULL') return 'Hôm nay bạn nghỉ phép cả ngày';
  if (!t.isWorkday && !t.firstIn) return 'Hôm nay không phải ngày làm';
  if (t.isHoliday || !t.isWorkday) {
    const day = t.isHoliday ? `ngày lễ${t.holidayName ? `: ${t.holidayName}` : ''}` : 'ngày nghỉ';
    return `${t.inProgress ? 'Đang làm' : 'Đã chấm ra'} · ${day}`;
  }
  const extra = [
    t.late && 'đi muộn',
    t.early && 'về sớm',
    t.leave && `nghỉ ${LEAVE_PART_LABEL[t.leave]}`,
  ].filter(Boolean);
  const base = t.firstIn
    ? t.inProgress
      ? 'Đang làm'
      : 'Đã chấm ra'
    : t.notCheckedInYet
      ? 'Bạn chưa chấm công'
      : 'Chưa tới giờ vào ca';
  return extra.length > 0 ? `${base} · ${extra.join(' · ')}` : base;
}

/** Ô "Hôm nay" nổi bật trên Bảng công của tôi (T-046): trạng thái, giờ vào / ra, nút chấm công dùng chung với thẻ. */
export function TodayBox({ today: t }: Props) {
  return (
    <section
      aria-labelledby="today-box"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border-2 border-primary bg-surface p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="today-box" className="text-base font-semibold first-letter:uppercase">
          Hôm nay, {longDay(t)}
        </h2>
        <p className="text-lg font-medium">{statusText(t)}</p>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-base">
        <dt>Giờ vào</dt>
        <dd className="font-semibold tabular-nums">
          {t.firstIn ? clockShort(t.firstIn, t.timezone) : '—'}
        </dd>
        <dt>Giờ ra</dt>
        <dd className="font-semibold tabular-nums">
          {t.lastOut ? clockShort(t.lastOut, t.timezone) : '—'}
        </dd>
      </dl>
      <div className="sm:ml-auto">
        <CheckButtons today={t} />
      </div>
    </section>
  );
}
