import { addDays, daysBetween, type LocalDate } from './local-time';
import type { DayStatus } from './summarize-day';
import { employedOn, type Tenure } from './tenure';
import { effectiveSchedule, isWorkday, type WorkSchedule } from './work-schedule';

export type PayrollLeaveType = 'ANNUAL' | 'SICK' | 'PERSONAL_PAID' | 'UNPAID' | 'OTHER';

/** Phép đã duyệt theo NỬA ngày (phép cả ngày = 2 dòng) — đọc MỘT lần, có loại (payroll.md ADR-126). */
export interface PayrollLeaveHalf {
  date: LocalDate;
  part: 'AM' | 'PM';
  type: PayrollLeaveType;
}

/** Loại phép có lương (nửa có phép này = 1). SICK do BHXH chi trả, UNPAID / OTHER không lương ⇒ 0. */
export const PAID_LEAVE_TYPES: ReadonlySet<PayrollLeaveType> = new Set(['ANNUAL', 'PERSONAL_PAID']);

export type PayrollDaysResult =
  | { ok: true; halfDays: number; missingOutDates: LocalDate[]; sickDays: number }
  | { ok: false; reason: 'ATTENDANCE_RETENTION_EXPIRED' };

/**
 * Công tính lương của MỘT người trong `[from, to]` — số nguyên NỬA ngày (payroll.md ADR-126), hàm THUẦN. Mỗi ngày 2 nửa
 * AM/PM, mỗi nửa 0/1, trần 2:
 * - Ngoài mọi nhiệm kỳ EMPLOYEE (ngày, gồm hai đầu) ⇒ 0, kể cả có lượt chấm.
 * - Ngày không làm việc theo lịch hiệu lực của NGÀY đó (OFF / Chủ nhật — kể cả lễ rơi vào) ⇒ 0.
 * - Lễ rơi vào ngày làm việc ⇒ 2.
 * - Nửa có phép đã duyệt ⇒ theo loại phép (có lương 1, không 0) — PHÉP THẮNG lượt chấm; dòng trùng cùng nửa không cộng
 *   hai lần (có một dòng có lương ⇒ 1).
 * - Nửa không phép ⇒ 1 nếu ngày PRESENT (IN + OUT hợp lệ — đủ nửa dù làm ít giờ, muộn/sớm không trừ), còn lại 0
 *   (MISSING_OUT chỉ mất phần đi làm — nửa phép có lương của ngày đó vẫn giữ).
 * - Ngày trước mốc retention ⇒ `ATTENDANCE_RETENTION_EXPIRED` (không trả số thiếu).
 * `statusOf` là trạng thái ô ngày của `summarizeDay` cho cùng người (bên gọi dựng từ CÙNG danh sách phép đã đọc).
 */
export function payrollDaysOf(q: {
  from: LocalDate;
  to: LocalDate;
  statusOf: ReadonlyMap<LocalDate, DayStatus>;
  leaves: readonly PayrollLeaveHalf[];
  schedules: readonly WorkSchedule[];
  tenures: readonly Tenure[];
  retentionCutoff: LocalDate | null;
}): PayrollDaysResult {
  if (q.retentionCutoff !== null && q.from < q.retentionCutoff) {
    return { ok: false, reason: 'ATTENDANCE_RETENTION_EXPIRED' };
  }
  const paidHalf = new Map<string, boolean>();
  for (const l of q.leaves) {
    const k = `${l.date}|${l.part}`;
    paidHalf.set(k, (paidHalf.get(k) ?? false) || PAID_LEAVE_TYPES.has(l.type));
  }
  let halfDays = 0;
  const missingOutDates: LocalDate[] = [];
  // Ngày làm việc trong nhiệm kỳ có phép SICK (nửa hay cả ngày) — phiếu ghi chú "do BHXH chi trả".
  const sick = new Set(q.leaves.filter((l) => l.type === 'SICK').map((l) => l.date));
  let sickDays = 0;
  for (let i = 0; i <= daysBetween(q.from, q.to); i++) {
    const date = addDays(q.from, i);
    if (!employedOn(q.tenures, date)) continue;
    if (!isWorkday(effectiveSchedule(q.schedules, date), date)) continue;
    if (sick.has(date)) sickDays++;
    const status = q.statusOf.get(date);
    if (status === 'HOLIDAY') {
      halfDays += 2;
      continue;
    }
    if (status === 'MISSING_OUT') missingOutDates.push(date);
    for (const part of ['AM', 'PM'] as const) {
      const leave = paidHalf.get(`${date}|${part}`);
      if (leave !== undefined) halfDays += leave ? 1 : 0;
      else if (status === 'PRESENT') halfDays += 1;
    }
  }
  return { ok: true, halfDays, missingOutDates, sickDays };
}

/**
 * Công chuẩn `S` của kỳ: đếm TỪNG ngày theo lịch hiệu lực của ngày đó (đổi lịch giữa tháng ⇒ tổng hai đoạn), gồm ngày lễ
 * rơi vào ngày làm. Cùng `S` cho mọi người của kỳ. Lịch không có ngày làm nào ⇒ 0 — bên gọi (payroll) trả 422
 * `NO_WORKING_DAYS` (B L3: không ném RangeError để khỏi bị lẫn với lỗi miền số).
 */
export function standardDaysOf(q: {
  from: LocalDate;
  to: LocalDate;
  schedules: readonly WorkSchedule[];
}): number {
  let days = 0;
  for (let i = 0; i <= daysBetween(q.from, q.to); i++) {
    const date = addDays(q.from, i);
    if (isWorkday(effectiveSchedule(q.schedules, date), date)) days++;
  }
  return days;
}
