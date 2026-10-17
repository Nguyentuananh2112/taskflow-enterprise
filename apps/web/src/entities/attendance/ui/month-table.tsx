import type { AttendanceMonthDto } from '@taskflow/contracts/attendance';

import { cn } from '@/shared/lib/cn';

import { clockShort, dayText, employmentNote } from '../lib/calendar';
import { dayLabel, duration } from '../lib/time';
import { TONE, TONE_ICON } from './calendar-tone';

type Props = Readonly<{
  month: AttendanceMonthDto;
  caption: string;
  /** Bấm ngày ⇒ xem chi tiết (giờ vào/ra + lượt chấm). */
  onSelectDay?: (date: string) => void;
  /** "Hôm nay" THEO SERVER (múi giờ của lịch) — đánh dấu hàng; ngày sau đó để trống. */
  today?: string | undefined;
}>;

const COLUMNS = ['Ngày', 'Trạng thái', 'Giờ vào', 'Giờ ra', 'Số giờ làm'] as const;

/**
 * Bảng công tháng dạng DANH SÁCH (T-046 — cùng câu chữ với lịch): tiêu đề cột + tiêu đề HÀNG (ngày), trạng thái bằng CHỮ +
 * biểu tượng `aria-hidden`; ngày ngoài nhiệm kỳ gộp thành MỘT dòng; ngày tương lai để trống. Giờ "8:02" theo lịch.
 */
export function MonthTable({ month, caption, onSelectDay, today = '9999-12-31' }: Props) {
  const note = employmentNote(month.days);
  const days = month.days.filter((d) => d.status !== 'NOT_EMPLOYED');
  const noteRow = (text: string) => (
    <tr className="border-b border-border">
      <td colSpan={COLUMNS.length} className="py-2 text-base font-medium">
        {text}
      </td>
    </tr>
  );
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-base">
        <caption className="mb-2 text-left text-base font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-sm">
            {COLUMNS.map((c) => (
              <th key={c} scope="col" className="py-2 pr-3 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {note.started && noteRow(note.started)}
          {days.map((d) => {
            const text = dayText(d, today);
            const future = d.date > today;
            const isToday = d.date === today;
            return (
              <tr
                key={d.date}
                aria-current={isToday ? 'date' : undefined}
                className={cn(
                  'border-b border-border',
                  !d.isWorkday && 'bg-bg-subtle',
                  isToday && 'font-semibold',
                  future && 'text-text-muted',
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
                  {isToday && (
                    <span aria-hidden="true" className="text-text-muted">
                      {' '}
                      · hôm nay
                    </span>
                  )}
                </th>
                <td className="py-2 pr-3">
                  {text.label && (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn('font-semibold', TONE[text.tone].icon)}
                      >
                        {TONE_ICON[text.tone]}{' '}
                      </span>
                      {text.label}
                      {text.detail && !d.firstIn && <span> · {text.detail}</span>}
                    </>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {d.firstIn ? clockShort(d.firstIn, d.timezone) : future ? '' : '—'}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {d.lastOut ? clockShort(d.lastOut, d.timezone) : future ? '' : '—'}
                </td>
                <td className="py-2 pr-3">
                  {d.workedMin > 0 ? duration(d.workedMin) : future ? '' : '—'}
                </td>
              </tr>
            );
          })}
          {note.left && noteRow(note.left)}
        </tbody>
      </table>
    </div>
  );
}
