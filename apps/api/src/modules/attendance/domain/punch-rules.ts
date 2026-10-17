import { toLocal, type LocalDate } from './local-time';
import { employedOn, type Tenure } from './tenure';
import { workDateFor, type PlacedEvent } from './work-date';
import { localToday, type WorkSchedule } from './work-schedule';

/** Lượt đã ghi của chính người chấm (đủ 2 ngày gần nhất, kể cả đã hủy), thứ tự bất kỳ. */
export interface PunchHistoryEvent extends PlacedEvent {
  source: 'WEB' | 'DEVICE' | 'ADJUSTMENT';
}

export type PunchSkipReason = 'ALREADY_CHECKED_IN' | 'NOT_CHECKED_IN' | 'NOT_EMPLOYED';

export type PunchDecision =
  { ok: true; workDate: LocalDate } | { ok: false; reason: PunchSkipReason };

/**
 * Luật chấm WEB của nhân viên (thuần — không I/O, không đọc đồng hồ). Bên gọi đọc lịch / lượt gần đây / nhiệm kỳ TRONG
 * transaction sau khóa `taskflow:attendance:punch:<user>` rồi gọi hàm này.
 * - IN: ngày công = ngày địa phương của `now` theo lịch; ngoài mọi nhiệm kỳ ⇒ `NOT_EMPLOYED` (chặn IN trước ngày đầu và
 *   IN 00:00–06:00 sau ngày cuối — A S1); đã có IN WEB còn hiệu lực ⇒ `ALREADY_CHECKED_IN`.
 * - OUT: ngày công theo luật 06:00 (`workDateFor`) — vẫn đóng được IN của ngày cuối nhiệm kỳ trước 06:00 hôm sau; không có
 *   IN còn hiệu lực ở ngày đó ⇒ `NOT_CHECKED_IN`. OUT lặp lại vẫn hợp lệ (lấy OUT muộn nhất).
 */
export function decidePunch(q: {
  kind: 'IN' | 'OUT';
  now: Date;
  schedules: readonly WorkSchedule[];
  recent: readonly PunchHistoryEvent[];
  tenures: readonly Tenure[];
}): PunchDecision {
  const { timezone } = localToday(q.schedules, q.now);
  const live = q.recent.filter((e) => e.voidedAt === null);
  if (q.kind === 'IN') {
    const workDate = toLocal(q.now, timezone).date;
    if (!employedOn(q.tenures, workDate)) return { ok: false, reason: 'NOT_EMPLOYED' };
    const already = live.some(
      (e) => e.kind === 'IN' && e.source === 'WEB' && e.workDate === workDate,
    );
    return already ? { ok: false, reason: 'ALREADY_CHECKED_IN' } : { ok: true, workDate };
  }
  const workDate = workDateFor('OUT', q.now, timezone, q.recent);
  return live.some((e) => e.kind === 'IN' && e.workDate === workDate)
    ? { ok: true, workDate }
    : { ok: false, reason: 'NOT_CHECKED_IN' };
}
