import { addDays, minutesFrom, toLocal, type LocalDate } from './local-time';

/**
 * Giờ chốt ngày công (thiết kế §4, TL chốt phương án (b)): lượt OUT xảy ra TRƯỚC 06:00 (giờ của lịch) của
 * ngày kế tiếp `workDate` của một lượt IN còn mở ⇒ thuộc `workDate` đó (làm muộn qua nửa đêm). Hằng số
 * domain ở v1 — chưa có ca đêm; muốn đổi thì thêm cột vào `WorkSchedule` kèm ADR.
 */
export const DAY_ROLLOVER_MIN = 6 * 60;

export interface PlacedEvent {
  kind: 'IN' | 'OUT';
  occurredAt: Date;
  workDate: LocalDate;
  voidedAt: Date | null;
}

/**
 * `workDate` cho một lượt mới. IN ⇒ luôn là ngày địa phương của thời điểm ghi. OUT ⇒ ngày của lượt IN
 * CÒN MỞ gần nhất (chưa có OUT nào sau nó trong cùng `workDate`, chưa bị hủy) nếu OUT xảy ra trước giờ
 * chốt của ngày kế tiếp; không có ⇒ ngày địa phương (OUT mồ côi, hiển thị thô).
 *
 * `previous`: các lượt đã ghi của CÙNG người (đủ ít nhất 2 ngày gần nhất), thứ tự bất kỳ.
 */
export function workDateFor(
  kind: 'IN' | 'OUT',
  occurredAt: Date,
  timezone: string,
  previous: readonly PlacedEvent[],
): LocalDate {
  const today = toLocal(occurredAt, timezone).date;
  if (kind === 'IN') return today;
  const live = previous.filter((e) => e.voidedAt === null && e.occurredAt <= occurredAt);
  const lastIn = live
    .filter((e) => e.kind === 'IN')
    .reduce<PlacedEvent | null>((a, e) => (!a || e.occurredAt > a.occurredAt ? e : a), null);
  if (!lastIn) return today;
  const closed = live.some(
    (e) => e.kind === 'OUT' && e.workDate === lastIn.workDate && e.occurredAt > lastIn.occurredAt,
  );
  // "Còn mở" = chưa OUT. Đã có OUT sau IN cùng ngày ⇒ bấm OUT lại vẫn thuộc ngày đó (lượt muộn nhất
  // được tính — thiết kế §4) miễn còn trước giờ chốt.
  const cutoff = minutesFrom(addDays(lastIn.workDate, 1), occurredAt, timezone);
  const beforeCutoff = lastIn.workDate === today || cutoff < DAY_ROLLOVER_MIN;
  if (!beforeCutoff) return today;
  return closed && lastIn.workDate !== today ? today : lastIn.workDate;
}
