import { addDays, instantOf, toLocal, type LocalDate } from './local-time';
import type { DayEvent } from './summarize-day';
import { DAY_ROLLOVER_MIN } from './work-date';
import { effectiveSchedule, localToday, type WorkSchedule } from './work-schedule';

/** Đơn bổ sung giờ (hr-extended ADR-129): một lượt IN hoặc OUT xin thêm vào ngày công `date`. */
export interface CorrectionAsk {
  date: LocalDate;
  kind: 'IN' | 'OUT';
  /** Phút trong ngày 0..1439 (giờ địa phương theo lịch hiệu lực của `date`). */
  minuteOfDay: number;
  /** OUT sau nửa đêm (giờ < 06:00 hôm sau) — contract + CHECK DB chặn mọi tổ hợp khác. */
  nextDay: boolean;
}

export type CorrectionRejectReason =
  | 'CORRECTION_DATE_OUT_OF_RANGE'
  | 'OUTSIDE_RETENTION'
  | 'CORRECTION_IN_FUTURE'
  | 'CORRECTION_EVENT_EXISTS'
  | 'CORRECTION_TIME_ORDER'
  | 'CORRECTION_DAY_ON_LEAVE';

export type CorrectionDecision =
  { ok: true; occurredAt: Date } | { ok: false; reason: CorrectionRejectReason };

/** Ngày 1 của tháng TRƯỚC tháng chứa `date` (cửa sổ "tháng này + tháng trước" — người dùng chốt 17/10). */
export function correctionWindowStart(date: LocalDate): LocalDate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m === 1 ? `${String(y - 1)}-12-01` : `${String(y)}-${String(m - 1).padStart(2, '0')}-01`;
}

/**
 * Luật gửi (và kiểm LẠI lúc duyệt) đơn bổ sung giờ — hàm THUẦN, thứ tự đúng luật 1–5 của ADR-129 (luật 6 "một PENDING /
 * (user, ngày, loại)" là ràng buộc DB). Bên gọi đọc lịch, lượt của ngày `date`, ngày đầu nhiệm kỳ hiện tại, mốc retention
 * và phép cả ngày TRONG khóa `taskflow:attendance:punch:<user>`.
 * 1. `date ≤ hôm nay` và `date ≥ max(ngày 1 tháng trước, startDate)` ⇒ không thì `CORRECTION_DATE_OUT_OF_RANGE`;
 *    trước mốc retention ⇒ `OUTSIDE_RETENTION` (như ADJUSTMENT, T-047).
 * 2. Thời điểm xin ≤ `now` ⇒ không thì `CORRECTION_IN_FUTURE` (gồm OUT `nextDay`).
 * 3. Không thay thế: đã có IN hợp lệ ⇒ không xin IN; đã có OUT hợp lệ sau `firstIn` ⇒ không xin OUT.
 * 4. OUT xin phải SAU `firstIn` (không có IN ⇒ không xin OUT được — xin IN trước); IN xin phải TRƯỚC `lastOut`.
 * 5. Ngày có phép CẢ NGÀY đã duyệt ⇒ `CORRECTION_DAY_ON_LEAVE` (nửa ngày, lễ, ngày nghỉ vẫn được gửi).
 * So thứ tự lượt theo thời điểm (ms) như `summarizeDay`. `occurredAt` tính đúng như `AttendanceEventsUseCases.adjust`
 * (CR-08: duyệt tạo cùng lượt như HR thêm tay cùng tham số).
 */
export function decideCorrection(q: {
  ask: CorrectionAsk;
  now: Date;
  schedules: readonly WorkSchedule[];
  /** `start_date` của nhiệm kỳ EMPLOYEE hiện tại. */
  tenureStart: LocalDate;
  /** Ngày đầu còn dữ liệu chấm công (`IRetentionWindow.recordsCutoffDate`); `null` = job retention tắt. */
  retentionCutoff: LocalDate | null;
  /** Mọi lượt đã gán `workDate = ask.date` (kể cả đã hủy). */
  events: readonly DayEvent[];
  fullDayLeave: boolean;
}): CorrectionDecision {
  const { ask } = q;
  const today = toLocal(q.now, localToday(q.schedules, q.now).timezone).date;
  const earliest =
    correctionWindowStart(today) > q.tenureStart ? correctionWindowStart(today) : q.tenureStart;
  if (ask.date > today || ask.date < earliest) {
    return { ok: false, reason: 'CORRECTION_DATE_OUT_OF_RANGE' };
  }
  if (q.retentionCutoff !== null && ask.date < q.retentionCutoff) {
    return { ok: false, reason: 'OUTSIDE_RETENTION' };
  }

  const { timezone } = effectiveSchedule(q.schedules, ask.date);
  const occurredAt = instantOf(
    ask.nextDay ? addDays(ask.date, 1) : ask.date,
    ask.minuteOfDay,
    timezone,
  );
  if (occurredAt.getTime() > q.now.getTime()) return { ok: false, reason: 'CORRECTION_IN_FUTURE' };

  const live = q.events.filter((e) => e.voidedAt === null);
  const ms = (e: DayEvent) => e.occurredAt.getTime();
  const ins = live.filter((e) => e.kind === 'IN');
  const outs = live.filter((e) => e.kind === 'OUT');
  const firstIn = ins.length ? Math.min(...ins.map(ms)) : null;
  const at = occurredAt.getTime();

  if (ask.kind === 'IN') {
    if (firstIn !== null) return { ok: false, reason: 'CORRECTION_EVENT_EXISTS' };
    const lastOut = outs.length ? Math.max(...outs.map(ms)) : null;
    if (lastOut !== null && at >= lastOut) return { ok: false, reason: 'CORRECTION_TIME_ORDER' };
  } else {
    if (firstIn !== null && outs.some((e) => ms(e) > firstIn)) {
      return { ok: false, reason: 'CORRECTION_EVENT_EXISTS' };
    }
    if (firstIn === null || at <= firstIn) return { ok: false, reason: 'CORRECTION_TIME_ORDER' };
  }

  if (q.fullDayLeave) return { ok: false, reason: 'CORRECTION_DAY_ON_LEAVE' };
  return { ok: true, occurredAt };
}

/** Hình dạng hợp lệ của giờ xin (contract + CHECK DB): 0..1439; `nextDay` chỉ cho OUT trước 06:00 (A#7). */
export function isValidCorrectionTime(
  ask: Pick<CorrectionAsk, 'kind' | 'minuteOfDay' | 'nextDay'>,
) {
  if (!Number.isInteger(ask.minuteOfDay) || ask.minuteOfDay < 0 || ask.minuteOfDay > 1439)
    return false;
  return !ask.nextDay || (ask.kind === 'OUT' && ask.minuteOfDay < DAY_ROLLOVER_MIN);
}
