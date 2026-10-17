import type { AttendanceDayDto } from '@taskflow/contracts/attendance';

import { LEAVE_PART_LABEL } from './labels';
import { duration } from './time';

// "Bảng công của tôi" dạng lịch (T-046): câu chữ đời thường, giờ "8:02", lưới T2→CN, gộp ngày ngoài nhiệm kỳ.

/** "8:02" (không số 0 đầu) theo múi giờ của lịch. */
export function clockShort(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

const weekdayMon0 = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Lưới tuần T2→CN của tháng: mỗi tuần 7 ô, `null` = ô đệm ngoài tháng. `days` đã đủ mọi ngày, theo thứ tự. */
export function calendarWeeks<T extends { date: string }>(days: readonly T[]): (T | null)[][] {
  if (days.length === 0) return [];
  const cells: (T | null)[] = [
    ...Array.from({ length: weekdayMon0(days[0]?.date ?? '') }, () => null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

export type Tone = 'work' | 'late' | 'absent' | 'leave' | 'off' | 'holiday' | 'muted' | 'none';

export type DayText = Readonly<{
  /** Chữ chính trong ô ("Đi làm", "Đi muộn 37 phút", "Vắng", …); rỗng = ngày tương lai / ngoài nhiệm kỳ. */
  label: string;
  /** Dòng phụ ("8:02–17:35", tên lễ, "nửa ngày"). */
  detail: string | null;
  icon: string;
  tone: Tone;
}>;

const EMPTY: DayText = { label: '', detail: null, icon: '', tone: 'none' };

/** "37 phút", "2 giờ", "1 giờ 5 phút" — số phút lớn viết theo giờ cho dễ đọc. */
const minutesText = (n: number) => duration(n);

/** Ngày tương lai chỉ hiện điều ĐÃ BIẾT TRƯỚC (lễ, phép đã duyệt) — còn lại để trống, không "Chưa tới giờ". */
const PLANNED: ReadonlySet<AttendanceDayDto['status']> = new Set(['HOLIDAY', 'ON_LEAVE']);

/**
 * Câu chữ của một ngày cho người không rành IT. `today` = ngày của SERVER: ngày sau hôm nay chỉ hiện lễ / phép đã
 * duyệt, còn lại trống (không ghi "Chưa tới giờ"). NOT_EMPLOYED ⇒ trống ở đây — được gộp thành "Bạn bắt đầu làm từ dd/MM" (`employmentNote`).
 */
export function dayText(d: AttendanceDayDto, today: string): DayText {
  if (d.status === 'NOT_EMPLOYED') return EMPTY;
  if (d.date > today) {
    if (PLANNED.has(d.status)) return plannedText(d);
    // Phép nửa ngày ở tương lai: server để PENDING kèm `leave` AM/PM.
    if (d.leave)
      return { label: 'Nghỉ phép', detail: LEAVE_PART_LABEL[d.leave], icon: '☾', tone: 'leave' };
    return EMPTY;
  }
  const span =
    d.firstIn &&
    `${clockShort(d.firstIn, d.timezone)}–${d.lastOut ? clockShort(d.lastOut, d.timezone) : '…'}`;
  switch (d.status) {
    case 'PRESENT':
    case 'MISSING_OUT': {
      const forgot = d.status === 'MISSING_OUT' ? 'Quên chấm ra' : null;
      if (d.lateMin > 0) {
        // Vừa muộn vừa sớm: nhãn là "Đi muộn", phần "Về sớm" sang dòng phụ (ô lịch hẹp).
        const also = d.earlyMin > 0 ? `Về sớm ${minutesText(d.earlyMin)}` : null;
        const detail = [also, forgot ?? span].filter(Boolean).join(' · ') || null;
        return { label: `Đi muộn ${minutesText(d.lateMin)}`, detail, icon: '!', tone: 'late' };
      }
      if (d.earlyMin > 0)
        return {
          label: `Về sớm ${minutesText(d.earlyMin)}`,
          detail: forgot ?? span,
          icon: '!',
          tone: 'late',
        };
      return { label: 'Đi làm', detail: forgot ?? span, icon: '✓', tone: forgot ? 'late' : 'work' };
    }
    case 'ABSENT':
      return { label: 'Vắng', detail: null, icon: '✕', tone: 'absent' };
    case 'ON_LEAVE':
    case 'HOLIDAY':
      return plannedText(d);
    case 'OFF':
      return {
        label: weekdayMon0(d.date) === 6 ? 'Chủ nhật' : 'Ngày nghỉ',
        detail: null,
        icon: '–',
        tone: 'off',
      };
    case 'RETENTION_EXPIRED':
      // Dữ liệu đã quá thời hạn lưu (R27) — trung tính, không phải "Vắng".
      return { label: 'Ngoài thời hạn lưu', detail: null, icon: '⌛', tone: 'off' };
    case 'PENDING':
      // Chỉ còn HÔM NAY (tương lai đã xử lý ở trên): đã tới giờ vào ca mà chưa chấm ⇒ cảnh báo; chưa tới giờ ⇒ trung tính.
      return d.notCheckedInYet
        ? { label: 'Chưa chấm công', detail: null, icon: '!', tone: 'late' }
        : { label: 'Chưa tới giờ', detail: null, icon: '○', tone: 'muted' };
  }
}

function plannedText(d: AttendanceDayDto): DayText {
  if (d.status === 'HOLIDAY')
    return { label: 'Ngày lễ', detail: d.holidayName, icon: '★', tone: 'holiday' };
  return {
    label: 'Nghỉ phép',
    detail: d.leave && d.leave !== 'FULL' ? LEAVE_PART_LABEL[d.leave] : 'cả ngày',
    icon: '☾',
    tone: 'leave',
  };
}

const ddMm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * Ngày ngoài nhiệm kỳ liền ở ĐẦU tháng ⇒ "Bạn bắt đầu làm từ dd/MM"; liền ở CUỐI ⇒ "Bạn đã nghỉ làm từ dd/MM". `null`
 * khi cả tháng trong nhiệm kỳ (hoặc cả tháng ngoài nhiệm kỳ — không có ngày làm nào để nói).
 */
export function employmentNote(days: readonly AttendanceDayDto[]): {
  started: string | null;
  left: string | null;
} {
  const employed = days.filter((d) => d.status !== 'NOT_EMPLOYED');
  const first = employed[0];
  const last = employed.at(-1);
  if (!first || !last) return { started: null, left: null };
  const lastDay = days.at(-1);
  return {
    started: days[0]?.status === 'NOT_EMPLOYED' ? `Bạn bắt đầu làm từ ${ddMm(first.date)}` : null,
    left:
      lastDay?.status === 'NOT_EMPLOYED'
        ? `Bạn đã nghỉ làm từ ${ddMm(days[days.indexOf(last) + 1]?.date ?? lastDay.date)}`
        : null,
  };
}
