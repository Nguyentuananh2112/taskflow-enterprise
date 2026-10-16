import { minutesFrom, type LocalDate } from './local-time';
import { isWorkday, type WorkSchedule } from './work-schedule';

/**
 * Thứ tự ưu tiên (thiết kế §4, A#6; TL chốt NOT_EMPLOYED): NOT_EMPLOYED (ngoài nhiệm kỳ VÀ không có lượt
 * chưa hủy) > HOLIDAY > OFF > ON_LEAVE > PRESENT/MISSING_OUT > ABSENT > PENDING.
 */
export type DayStatus =
  | 'NOT_EMPLOYED'
  | 'HOLIDAY'
  | 'OFF'
  | 'ON_LEAVE'
  | 'PRESENT'
  | 'MISSING_OUT'
  | 'ABSENT'
  | 'PENDING';

export type LeavePart = 'FULL' | 'AM' | 'PM';

export interface DayEvent {
  kind: 'IN' | 'OUT';
  occurredAt: Date;
  voidedAt: Date | null;
}

export interface DayInput {
  /** `workDate` đang xét; `events` là các lượt ĐÃ được gán `workDate` này (xem `workDateFor`). */
  date: LocalDate;
  events: readonly DayEvent[];
  schedule: WorkSchedule;
  holiday: boolean;
  leave: LeavePart | null;
  /**
   * Ngày nằm trong một nhiệm kỳ thành viên (từ ngày gia nhập tới ngày rời, gồm cả hai) — lớp gọi tính từ
   * `IMembershipTenurePort` để hàm vẫn thuần. Ngoài nhiệm kỳ mà vẫn có lượt chấm ⇒ tính như thường.
   */
  employed: boolean;
  now: Date;
}

export interface DaySummary {
  status: DayStatus;
  /** IN hợp lệ sớm nhất. */
  firstIn: Date | null;
  /** OUT hợp lệ muộn nhất SAU `firstIn`; không có IN ⇒ OUT muộn nhất (giờ thô, OUT mồ côi). */
  lastOut: Date | null;
  workedMin: number;
  lateMin: number;
  earlyMin: number;
  flags: { late: boolean; early: boolean; absentHalf: boolean; inProgress: boolean };
}

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Bảng công một ngày của một người — hàm THUẦN (không đọc đồng hồ, không I/O), test theo bảng SD-*
 * của test-spec-hr §1. Giờ làm = giao của `[firstIn, lastOut]` với ca `[start, end]` trừ phần giao với
 * nghỉ trưa (phút). Không tính OT. Nghỉ AM ⇒ ca bắt đầu ở `breakEnd`; nghỉ PM ⇒ ca kết thúc ở `breakStart`.
 */
export function summarizeDay(input: DayInput): DaySummary {
  const { date, schedule, leave } = input;
  const tz = schedule.timezone;
  const live = input.events.filter((e) => e.voidedAt === null);
  const at = (e: DayEvent) => minutesFrom(date, e.occurredAt, tz);
  // Chọn / so thứ tự lượt theo THỜI ĐIỂM (ms), không theo phút: OUT cùng phút với IN vẫn là "sau IN" (E2E-HR-01,
  // F) và hai lượt cùng phút không phụ thuộc thứ tự mảng. Phút chỉ dùng để tính giờ làm / muộn / sớm.
  const ms = (e: DayEvent) => e.occurredAt.getTime();
  const earliest = (list: DayEvent[]) =>
    list.reduce<DayEvent | null>((a, e) => (!a || ms(e) < ms(a) ? e : a), null);
  const latest = (list: DayEvent[]) =>
    list.reduce<DayEvent | null>((a, e) => (!a || ms(e) > ms(a) ? e : a), null);

  const firstIn = earliest(live.filter((e) => e.kind === 'IN'));
  const outs = live.filter((e) => e.kind === 'OUT');
  const lastOut = firstIn ? latest(outs.filter((e) => ms(e) > ms(firstIn))) : latest(outs);
  const base: DaySummary = {
    status: 'PENDING',
    firstIn: firstIn?.occurredAt ?? null,
    lastOut: lastOut?.occurredAt ?? null,
    workedMin: 0,
    lateMin: 0,
    earlyMin: 0,
    flags: { late: false, early: false, absentHalf: false, inProgress: false },
  };

  // Trước khi gia nhập / sau khi rời: không phải ngày công, 0 ở mọi tổng (bảng HR, CSV) — trừ khi có dữ liệu.
  if (!input.employed && live.length === 0) return { ...base, status: 'NOT_EMPLOYED' };
  if (input.holiday) return { ...base, status: 'HOLIDAY' };
  if (!isWorkday(schedule, date)) return { ...base, status: 'OFF' };
  if (leave === 'FULL') return { ...base, status: 'ON_LEAVE' };

  const start = leave === 'AM' ? schedule.breakEndMin : schedule.startMin;
  const end = leave === 'PM' ? schedule.breakStartMin : schedule.endMin;
  const now = minutesFrom(date, input.now, tz);
  /** Ca đã kết thúc theo `now` (biên: đúng giờ kết thúc vẫn chưa — SD-26b). */
  const shiftOver = now > end;

  if (!firstIn) {
    if (!shiftOver) return { ...base, status: 'PENDING' };
    return { ...base, status: 'ABSENT', flags: { ...base.flags, absentHalf: leave !== null } };
  }

  const inMin = at(firstIn);
  const late = inMin - start > schedule.graceMin;
  // Chặn trong ca: muộn tối đa bằng cả ca (vào sau giờ kết thúc), về sớm tính từ max(OUT, start) — nếu
  // không, OUT 01:00 cho earlyMin 990 > độ dài ca. Bất biến: worked + late + early ≤ end − start.
  const lateMin = late ? Math.min(inMin, end) - start : 0;
  if (!lastOut) {
    const status: DayStatus = shiftOver ? 'MISSING_OUT' : 'PRESENT';
    return {
      ...base,
      status,
      lateMin,
      flags: { ...base.flags, late, inProgress: status === 'PRESENT' },
    };
  }

  const outMin = at(lastOut);
  const worked =
    overlap(inMin, outMin, start, end) -
    overlap(
      inMin,
      outMin,
      Math.max(start, schedule.breakStartMin),
      Math.min(end, schedule.breakEndMin),
    );
  const early = outMin < end;
  return {
    ...base,
    status: 'PRESENT',
    workedMin: worked,
    lateMin,
    earlyMin: early ? end - Math.max(outMin, start) : 0,
    flags: { ...base.flags, late, early },
  };
}

/** Phút trong ngày tối đa của ca (để kiểm đặc tính: `workedMin` không vượt). */
export function scheduledMinutes(schedule: WorkSchedule): number {
  return (
    schedule.endMin -
    schedule.startMin -
    overlap(schedule.startMin, schedule.endMin, schedule.breakStartMin, schedule.breakEndMin)
  );
}
