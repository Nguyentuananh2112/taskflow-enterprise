import { describe, expect, it } from 'vitest';

import { addDays, instantOf, type LocalDate } from './local-time';
import {
  scheduledMinutes,
  summarizeDay,
  type DayEvent,
  type DayInput,
  type LeavePart,
} from './summarize-day';
import type { WorkSchedule } from './work-schedule';

// test-spec-hr §1 (tầng U): bảng SD-*. Giờ trong bảng = giờ địa phương của lịch; `occurredAt` dựng
// bằng `instantOf` (VN = UTC+7). Mặc định: lịch S0, không lễ, không nghỉ, `now` = sau ngày đang xét.
const VN = 'Asia/Ho_Chi_Minh';
const S0: WorkSchedule = {
  effectiveFrom: '2026-01-01',
  timezone: VN,
  workdays: 0b0111111, // T2–T7
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
};
const MON = '2026-11-16';
const SAT = '2026-11-14';
const SUN = '2026-11-15';

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** `IN 07:55` vào ngày `date` (giờ của lịch). */
const ev = (
  kind: 'IN' | 'OUT',
  date: LocalDate,
  time: string,
  opts: { tz?: string; voided?: boolean } = {},
): DayEvent => ({
  kind,
  occurredAt: instantOf(date, hm(time), opts.tz ?? VN),
  voidedAt: opts.voided ? new Date('2026-11-20T00:00:00Z') : null,
});

function day(
  date: LocalDate,
  events: DayEvent[] = [],
  over: Partial<Omit<DayInput, 'date' | 'events'>> & { nowLocal?: string } = {},
) {
  const schedule = over.schedule ?? S0;
  const now = over.nowLocal
    ? instantOf(date, hm(over.nowLocal), schedule.timezone)
    : (over.now ?? instantOf(addDays(date, 2), 0, schedule.timezone));
  return summarizeDay({
    date,
    events,
    schedule,
    holiday: over.holiday ?? false,
    leave: over.leave ?? null,
    employed: over.employed ?? true,
    now,
  });
}
const g = (graceMin: number): WorkSchedule => ({ ...S0, graceMin });
const at = (date: LocalDate, time: string, tz = VN) => instantOf(date, hm(time), tz);

describe('summarizeDay — giờ làm, muộn, sớm (SD-01..SD-10)', () => {
  it('SD-01 đúng giờ ⇒ PRESENT, 480 phút, không muộn/sớm', () => {
    const r = day(MON, [ev('IN', MON, '07:55'), ev('OUT', MON, '17:35')]);
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 480, lateMin: 0, earlyMin: 0 });
    expect(r.flags).toEqual({ late: false, early: false, absentHalf: false, inProgress: false });
  });

  it('SD-02 grace 0, vào 08:01 ⇒ late, lateMin 1, worked 479', () => {
    const r = day(MON, [ev('IN', MON, '08:01'), ev('OUT', MON, '17:30')]);
    expect(r).toMatchObject({ status: 'PRESENT', lateMin: 1, workedMin: 479 });
    expect(r.flags.late).toBe(true);
  });

  it('SD-03 grace 5, vào 08:05 ⇒ KHÔNG late (5 không > 5), lateMin 0, worked 475', () => {
    const r = day(MON, [ev('IN', MON, '08:05'), ev('OUT', MON, '17:30')], { schedule: g(5) });
    expect(r).toMatchObject({ lateMin: 0, workedMin: 475 });
    expect(r.flags.late).toBe(false);
  });

  it('SD-04 grace 5, vào 08:06 ⇒ late, lateMin 6 (đo từ start, không trừ grace)', () => {
    const r = day(MON, [ev('IN', MON, '08:06'), ev('OUT', MON, '17:30')], { schedule: g(5) });
    expect(r).toMatchObject({ lateMin: 6 });
    expect(r.flags.late).toBe(true);
  });

  it('SD-05 vào trong giờ trưa 12:30 ⇒ worked 240 (13:30–17:30), lateMin 270', () => {
    const r = day(MON, [ev('IN', MON, '12:30'), ev('OUT', MON, '17:30')]);
    expect(r).toMatchObject({ workedMin: 240, lateMin: 270 });
  });

  it('SD-06 ra trước trưa 11:00 ⇒ worked 180, early, earlyMin 390', () => {
    const r = day(MON, [ev('IN', MON, '08:00'), ev('OUT', MON, '11:00')]);
    expect(r).toMatchObject({ workedMin: 180, earlyMin: 390 });
    expect(r.flags.early).toBe(true);
  });

  it('SD-07 chỉ IN, ngày đã qua ⇒ MISSING_OUT, lastOut null, worked 0', () => {
    const r = day(MON, [ev('IN', MON, '08:00')]);
    expect(r).toMatchObject({ status: 'MISSING_OUT', lastOut: null, workedMin: 0 });
    expect(r.flags.inProgress).toBe(false);
  });

  it('SD-08 chỉ IN, hôm nay 15:00 (trước end) ⇒ PRESENT + inProgress, KHÔNG early', () => {
    const r = day(MON, [ev('IN', MON, '08:00')], { nowLocal: '15:00' });
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 0 });
    expect(r.flags).toMatchObject({ inProgress: true, early: false });
  });

  it('SD-09 chỉ IN, hôm nay 17:31 ⇒ MISSING_OUT', () => {
    expect(day(MON, [ev('IN', MON, '08:00')], { nowLocal: '17:31' }).status).toBe('MISSING_OUT');
  });

  it('SD-10 OUT 2 lần ⇒ lấy OUT muộn nhất 17:40, worked 480, không early', () => {
    const r = day(MON, [ev('IN', MON, '08:00'), ev('OUT', MON, '12:00'), ev('OUT', MON, '17:40')]);
    expect(r.lastOut).toEqual(at(MON, '17:40'));
    expect(r).toMatchObject({ workedMin: 480, earlyMin: 0 });
    expect(r.flags.early).toBe(false);
  });
});

describe('summarizeDay — qua nửa đêm (SD-11, SD-11b, SD-12 phần tính công; gán workDate ở work-date.test)', () => {
  it('SD-11 OUT 00:30 hôm sau đã gắn vào 16/11 ⇒ 16/11 worked 480, không early', () => {
    const r = day(MON, [ev('IN', MON, '08:00'), ev('OUT', addDays(MON, 1), '00:30')]);
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 480, earlyMin: 0 });
  });

  it('SD-12 OUT mồ côi (không IN) ⇒ ngày đó ABSENT, lastOut là giờ thô', () => {
    const tue = addDays(MON, 1);
    const r = day(tue, [ev('OUT', tue, '01:00')]);
    expect(r.status).toBe('ABSENT');
    expect(r.lastOut).toEqual(at(tue, '01:00'));
    expect(r.workedMin).toBe(0);
  });
});

describe('summarizeDay — nghỉ phép (SD-13..SD-18)', () => {
  const leave = (part: LeavePart) => ({ leave: part });

  it('SD-13 nghỉ AM + vào 13:25 ⇒ mốc bắt đầu 13:30, không late, worked 240', () => {
    const r = day(MON, [ev('IN', MON, '13:25'), ev('OUT', MON, '17:30')], leave('AM'));
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 240, lateMin: 0 });
    expect(r.flags.late).toBe(false);
  });

  it('SD-14 nghỉ AM, grace 5, vào 13:36 ⇒ late, lateMin 6 (so với 13:30)', () => {
    const r = day(MON, [ev('IN', MON, '13:36'), ev('OUT', MON, '17:30')], {
      leave: 'AM',
      schedule: g(5),
    });
    expect(r).toMatchObject({ lateMin: 6 });
    expect(r.flags.late).toBe(true);
  });

  it('SD-15 nghỉ PM + làm AM 08:00–12:00 ⇒ mốc kết thúc 12:00, không early, worked 240', () => {
    const r = day(MON, [ev('IN', MON, '08:00'), ev('OUT', MON, '12:00')], leave('PM'));
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 240, earlyMin: 0 });
    expect(r.flags.early).toBe(false);
  });

  it('SD-16 nghỉ nửa ngày, vắng nửa kia ⇒ ABSENT + absentHalf', () => {
    for (const part of ['AM', 'PM'] as const) {
      const r = day(MON, [], leave(part));
      expect(r.status).toBe('ABSENT');
      expect(r.flags.absentHalf).toBe(true);
    }
  });

  it('SD-17 nghỉ cả ngày ⇒ ON_LEAVE, worked 0', () => {
    expect(day(MON, [], leave('FULL'))).toMatchObject({ status: 'ON_LEAVE', workedMin: 0 });
  });

  it('SD-18 nghỉ cả ngày nhưng vẫn chấm ⇒ ON_LEAVE, giờ thô vẫn trả', () => {
    const r = day(MON, [ev('IN', MON, '08:00'), ev('OUT', MON, '17:30')], leave('FULL'));
    expect(r).toMatchObject({ status: 'ON_LEAVE', workedMin: 0 });
    expect(r.firstIn).toEqual(at(MON, '08:00'));
    expect(r.lastOut).toEqual(at(MON, '17:30'));
  });
});

describe('summarizeDay — lễ, OFF, vắng, chưa tới (SD-19..SD-26b, SD-34)', () => {
  it('SD-19 ngày lễ trùng thứ 7 (ngày làm) ⇒ HOLIDAY', () => {
    expect(day(SAT, [], { holiday: true }).status).toBe('HOLIDAY');
  });

  it('SD-20 ngày lễ có chấm ⇒ HOLIDAY + giờ thô, không tính công', () => {
    const r = day(SAT, [ev('IN', SAT, '08:00'), ev('OUT', SAT, '12:00')], { holiday: true });
    expect(r).toMatchObject({ status: 'HOLIDAY', workedMin: 0 });
    expect(r.firstIn).toEqual(at(SAT, '08:00'));
  });

  it('SD-21 lễ + nghỉ cả ngày ⇒ HOLIDAY (HOLIDAY > ON_LEAVE)', () => {
    expect(day(SAT, [], { holiday: true, leave: 'FULL' }).status).toBe('HOLIDAY');
  });

  it('SD-22 Chủ nhật có chấm ⇒ OFF + giờ thô', () => {
    const r = day(SUN, [ev('IN', SUN, '09:00'), ev('OUT', SUN, '11:00')]);
    expect(r).toMatchObject({ status: 'OFF', workedMin: 0 });
    expect(r.lastOut).toEqual(at(SUN, '11:00'));
  });

  it('SD-23 ngày làm đã qua, không gì ⇒ ABSENT (không absentHalf)', () => {
    const r = day(MON);
    expect(r.status).toBe('ABSENT');
    expect(r.flags.absentHalf).toBe(false);
  });

  it('SD-24 tương lai ⇒ PENDING', () => {
    expect(day(MON, [], { now: at(addDays(MON, -1), '10:00') }).status).toBe('PENDING');
  });

  it('SD-25 hôm nay 07:30, chưa IN ⇒ PENDING', () => {
    expect(day(MON, [], { nowLocal: '07:30' }).status).toBe('PENDING');
  });

  it('SD-26 hôm nay 17:31, chưa IN ⇒ ABSENT; SD-26b đúng 17:30 ⇒ PENDING (chỉ ABSENT khi now > end)', () => {
    expect(day(MON, [], { nowLocal: '17:31' }).status).toBe('ABSENT');
    expect(day(MON, [], { nowLocal: '17:30' }).status).toBe('PENDING');
  });

  it('SD-43 ngoài nhiệm kỳ, không lượt ⇒ NOT_EMPLOYED (thắng HOLIDAY / OFF / ON_LEAVE); 0 phút, không cờ', () => {
    for (const over of [{}, { holiday: true }, { leave: 'FULL' as const }]) {
      expect(day(MON, [], { ...over, employed: false })).toEqual({
        status: 'NOT_EMPLOYED',
        firstIn: null,
        lastOut: null,
        workedMin: 0,
        lateMin: 0,
        earlyMin: 0,
        flags: { late: false, early: false, absentHalf: false, inProgress: false },
      });
    }
    expect(day(SUN, [], { employed: false }).status).toBe('NOT_EMPLOYED');
    expect(day(MON, [], { employed: true }).status).toBe('ABSENT');
  });

  it('SD-41 có lượt ngoài nhiệm kỳ ⇒ tính như thường; SD-42 chỉ lượt đã hủy ⇒ NOT_EMPLOYED', () => {
    const live = day(MON, [ev('IN', MON, '08:00'), ev('OUT', MON, '17:30')], { employed: false });
    expect(live).toMatchObject({ status: 'PRESENT', workedMin: 480 });
    expect(day(MON, [ev('OUT', MON, '17:30')], { employed: false }).status).toBe('ABSENT');
    expect(day(MON, [ev('IN', MON, '08:00', { voided: true })], { employed: false }).status).toBe(
      'NOT_EMPLOYED',
    );
  });

  it('SD-34 Chủ nhật + nghỉ cả ngày ⇒ OFF (OFF > ON_LEAVE)', () => {
    expect(day(SUN, [], { leave: 'FULL' }).status).toBe('OFF');
  });
});

describe('summarizeDay — hủy lượt, OUT trước IN, đổi lịch, múi giờ (SD-27..SD-33)', () => {
  it('SD-27 lượt bị hủy bị bỏ qua ⇒ firstIn 08:10, late 10', () => {
    const r = day(MON, [
      ev('IN', MON, '07:50', { voided: true }),
      ev('IN', MON, '08:10'),
      ev('OUT', MON, '17:30'),
    ]);
    expect(r.firstIn).toEqual(at(MON, '08:10'));
    expect(r).toMatchObject({ lateMin: 10 });
    expect(r.flags.late).toBe(true);
  });

  it('SD-28 chỉ OUT, ngày đã qua ⇒ ABSENT + giờ thô (OUT mồ côi)', () => {
    const r = day(MON, [ev('OUT', MON, '17:30')]);
    expect(r).toMatchObject({ status: 'ABSENT', firstIn: null, workedMin: 0 });
    expect(r.lastOut).toEqual(at(MON, '17:30'));
  });

  it('SD-29 đổi lịch giữa tháng: S1 (08:30) từ 16/11 ⇒ 13/11 muộn 20, 16/11 không muộn', () => {
    const S1: WorkSchedule = { ...S0, effectiveFrom: MON, startMin: 510 };
    const fri = '2026-11-13';
    const before = day(fri, [ev('IN', fri, '08:20'), ev('OUT', fri, '17:30')]);
    const after = day(MON, [ev('IN', MON, '08:20'), ev('OUT', MON, '17:30')], { schedule: S1 });
    expect(before).toMatchObject({ lateMin: 20 });
    expect(before.flags.late).toBe(true);
    expect(after.flags.late).toBe(false);
  });

  it('SD-30 DST mùa xuân Europe/Berlin 29/03 (CEST), lịch cả CN ⇒ worked 480, không late', () => {
    const BER: WorkSchedule = { ...S0, timezone: 'Europe/Berlin', workdays: 0b1111111 };
    const d = '2026-03-29';
    const r = day(
      d,
      [ev('IN', d, '07:55', { tz: BER.timezone }), ev('OUT', d, '17:35', { tz: BER.timezone })],
      {
        schedule: BER,
      },
    );
    expect(r).toMatchObject({ status: 'PRESENT', workedMin: 480, lateMin: 0, earlyMin: 0 });
  });

  it('SD-31 DST mùa thu Europe/Berlin 25/10 (CET) ⇒ worked 480, không early', () => {
    const BER: WorkSchedule = { ...S0, timezone: 'Europe/Berlin', workdays: 0b1111111 };
    const d = '2026-10-25';
    const r = day(
      d,
      [ev('IN', d, '07:55', { tz: BER.timezone }), ev('OUT', d, '17:35', { tz: BER.timezone })],
      {
        schedule: BER,
      },
    );
    expect(r).toMatchObject({ workedMin: 480, earlyMin: 0 });
    expect(r.flags.early).toBe(false);
  });

  it('SD-33 OUT trước IN ⇒ lastOut chỉ tính OUT SAU firstIn ⇒ MISSING_OUT', () => {
    const r = day(MON, [ev('OUT', MON, '07:00'), ev('IN', MON, '08:00')]);
    expect(r).toMatchObject({ status: 'MISSING_OUT', lastOut: null });
  });
});

describe('summarizeDay — chặn muộn/sớm trong ca (A, ngoài bảng SD)', () => {
  it('vào sau giờ kết thúc ⇒ lateMin = cả ca (570), không hơn', () => {
    const r = day(MON, [ev('IN', MON, '18:00'), ev('OUT', MON, '19:00')]);
    expect(r).toMatchObject({ workedMin: 0, lateMin: 570, earlyMin: 0 });
  });

  it('IN/OUT đều trước giờ bắt đầu ⇒ earlyMin = cả ca (570), không phải end − OUT', () => {
    const r = day(MON, [ev('IN', MON, '00:30'), ev('OUT', MON, '01:00')]);
    expect(r).toMatchObject({ workedMin: 0, lateMin: 0, earlyMin: 570 });
    expect(r.flags.early).toBe(true);
  });
});

describe('summarizeDay — đặc tính chung (vòng ngẫu nhiên có seed, thay cho property-based)', () => {
  // Bộ sinh số giả ngẫu nhiên cố định (mulberry32) ⇒ lặp lại được khi đỏ.
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const max = scheduledMinutes(S0);
  // Spec ghi `worked + late + early ≤ end − start − break` nhưng late/early đo theo giờ ĐỒNG HỒ nên có thể
  // chứa giờ nghỉ trưa (chính SD-05: 240 + 270 = 510 > 480) ⇒ bất biến đúng là `≤ end − start`.
  const span = S0.endMin - S0.startMin;

  it('0 ≤ workedMin ≤ giờ ca; worked + late + early ≤ end − start khi có IN/OUT; không phụ thuộc thứ tự events', () => {
    const rand = rng(20261117);
    for (let i = 0; i < 500; i += 1) {
      const n = 1 + Math.floor(rand() * 5);
      const events: DayEvent[] = Array.from({ length: n }, () => ({
        kind: rand() < 0.5 ? 'IN' : 'OUT',
        occurredAt: instantOf(MON, Math.floor(rand() * 1440), VN),
        voidedAt: rand() < 0.1 ? new Date(0) : null,
      }));
      const r = day(MON, events);
      expect(r.workedMin).toBeGreaterThanOrEqual(0);
      expect(r.workedMin).toBeLessThanOrEqual(max);
      if (r.status === 'PRESENT') {
        expect(r.workedMin + r.lateMin + r.earlyMin).toBeLessThanOrEqual(span);
      }
      expect(day(MON, [...events].reverse())).toEqual(r);
    }
  });
});
