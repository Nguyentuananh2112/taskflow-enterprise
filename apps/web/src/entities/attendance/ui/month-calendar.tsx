'use client';

import type { AttendanceDayDto, AttendanceMonthDto } from '@taskflow/contracts/attendance';
import { useState } from 'react';

import { cn } from '@/shared/lib/cn';

import { calendarWeeks, dayText, employmentNote } from '../lib/calendar';
import { TONE, TONE_ICON } from './calendar-tone';
import { useGridKeys } from './use-grid-keys';

const WEEKDAYS = [
  ['T2', 'Thứ hai'],
  ['T3', 'Thứ ba'],
  ['T4', 'Thứ tư'],
  ['T5', 'Thứ năm'],
  ['T6', 'Thứ sáu'],
  ['T7', 'Thứ bảy'],
  ['CN', 'Chủ nhật'],
] as const;

type Props = Readonly<{
  month: AttendanceMonthDto;
  caption: string;
  /** "Hôm nay" THEO SERVER — ô có `aria-current="date"`; ngày sau đó để trống. */
  today: string;
  onSelectDay: (date: string) => void;
}>;

const dayNumber = (date: string) => Number(date.slice(8));
const fullDate = (date: string) => `${dayNumber(date)}/${Number(date.slice(5, 7))}`;

/**
 * Bảng công dạng LỊCH tháng (T-046): bảng có tiêu đề cột T2…CN; mỗi ngày là một nút (màu + biểu tượng + chữ ngắn) mở chi
 * tiết. Màn hẹp: ô chỉ còn biểu tượng + số ngày, tên truy cập vẫn đủ câu. Phím mũi tên đi trong lưới.
 */
export function MonthCalendar({ month, caption, today, onSelectDay }: Props) {
  const weeks = calendarWeeks(month.days);
  const days = month.days;
  const note = employmentNote(days);
  const start = Math.max(
    0,
    days.findIndex((d) => d.date === today),
  );
  const [active, setActive] = useState<number | null>(null);
  const { register, onKeyDown } = useGridKeys(days.length);
  const focusIndex = active ?? start;
  return (
    <div className="flex flex-col gap-3">
      {note.started && <p className="text-base font-medium">{note.started}</p>}
      <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
        <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(([short, long]) => (
              <th key={short} scope="col" abbr={long} className="py-1 text-center font-medium">
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={week.find(Boolean)?.date ?? w}>
              {week.map((d, i) =>
                d ? (
                  <DayCell
                    key={d.date}
                    day={d}
                    today={today}
                    tabbable={days.indexOf(d) === focusIndex}
                    buttonRef={register(days.indexOf(d))}
                    onKeyDown={onKeyDown(days.indexOf(d))}
                    onFocus={() => setActive(days.indexOf(d))}
                    onSelect={() => onSelectDay(d.date)}
                  />
                ) : (
                  <td key={`pad-${w}-${i}`} aria-hidden="true" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {note.left && <p className="text-base font-medium">{note.left}</p>}
      <ul aria-label="Chú thích" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {Object.entries(TONE).flatMap(([tone, t]) =>
          t.legend
            ? [
                <li key={tone} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn('font-semibold', t.icon)}>
                    {TONE_ICON[tone as keyof typeof TONE_ICON]}
                  </span>
                  {t.legend}
                </li>,
              ]
            : [],
        )}
      </ul>
    </div>
  );
}

type CellProps = Readonly<{
  day: AttendanceDayDto;
  today: string;
  tabbable: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onSelect: () => void;
}>;

function DayCell({ day, today, tabbable, buttonRef, onKeyDown, onFocus, onSelect }: CellProps) {
  const text = dayText(day, today);
  const tone = TONE[text.tone];
  const isToday = day.date === today;
  const future = day.date > today;
  const name = [`Ngày ${fullDate(day.date)}`, isToday && 'hôm nay', text.label, text.detail]
    .filter(Boolean)
    .join(', ');
  return (
    <td aria-current={isToday ? 'date' : undefined} className="h-full p-0 align-top">
      <button
        ref={buttonRef}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-label={name}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onClick={onSelect}
        className={cn(
          'flex h-full min-h-12 w-full flex-col items-start gap-0.5 rounded-control border border-l-4 border-border p-1.5 text-left sm:min-h-20',
          tone.cell,
          future && 'opacity-60',
          isToday && 'ring-2 ring-primary',
        )}
      >
        <span className={cn('text-base tabular-nums', isToday && 'font-bold')}>
          {dayNumber(day.date)}
        </span>
        {text.label && (
          <span className="flex items-start gap-1">
            <span aria-hidden="true" className={cn('font-semibold', tone.icon)}>
              {TONE_ICON[text.tone]}
            </span>
            <span className="hidden leading-tight sm:inline">{text.label}</span>
          </span>
        )}
        {text.detail && (
          <span className="hidden text-xs leading-tight tabular-nums sm:inline">{text.detail}</span>
        )}
      </button>
    </td>
  );
}
