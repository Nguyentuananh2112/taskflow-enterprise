import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, instantOf, minutesFrom, toLocal, weekdayOf } from './local-time';
import { DAY_ROLLOVER_MIN, workDateFor, type PlacedEvent } from './work-date';
import {
  DEFAULT_SCHEDULE,
  effectiveSchedule,
  isWorkday,
  scheduleFor,
  type WorkSchedule,
} from './work-schedule';

// test-spec-hr §1: phần gán `workDate` (SD-11, SD-11b, SD-12, SD-32) + quy đổi múi giờ + phiên bản lịch.
// Giờ chốt ngày công 06:00 (giờ của lịch) — TL chốt phương án (b), thiết kế §4 @3a6c7fe.
const VN = 'Asia/Ho_Chi_Minh';
const MON = '2026-11-16';
const TUE = '2026-11-17';
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const at = (date: string, time: string, tz = VN) => instantOf(date, hm(time), tz);
const placed = (kind: 'IN' | 'OUT', date: string, time: string, workDate = date): PlacedEvent => ({
  kind,
  occurredAt: at(date, time),
  workDate,
  voidedAt: null,
});

describe('workDateFor — ngày công của một lượt mới', () => {
  it('SD-32 IN theo ngày của múi giờ lịch, không theo UTC: 16/11 18:30Z = 17/11 01:30 VN ⇒ 17/11', () => {
    expect(workDateFor('IN', new Date('2026-11-16T18:30:00Z'), VN, [])).toBe(TUE);
  });

  it('SD-11 OUT 00:30 hôm sau, IN còn mở ⇒ gắn vào ngày của IN (16/11)', () => {
    expect(workDateFor('OUT', at(TUE, '00:30'), VN, [placed('IN', MON, '08:00')])).toBe(MON);
  });

  it('SD-11b sau OUT 00:30 (gắn 16/11), sáng 17/11 lại IN ⇒ IN mở ngày 17/11; OUT chiều thuộc 17/11', () => {
    const prev = [placed('IN', MON, '08:00'), placed('OUT', TUE, '00:30', MON)];
    expect(workDateFor('IN', at(TUE, '08:00'), VN, prev)).toBe(TUE);
    const withTueIn = [...prev, placed('IN', TUE, '08:00')];
    expect(workDateFor('OUT', at(TUE, '17:30'), VN, withTueIn)).toBe(TUE);
  });

  it('SD-12 OUT mồ côi: IN 15/11 (quá giờ chốt) ⇒ OUT 01:00 ngày 17/11 thuộc 17/11', () => {
    expect(workDateFor('OUT', at(TUE, '01:00'), VN, [placed('IN', '2026-11-15', '08:00')])).toBe(
      TUE,
    );
  });

  it('giờ chốt 06:00: OUT 05:59 hôm sau ⇒ ngày của IN; 06:00 ⇒ ngày mới (mồ côi)', () => {
    expect(DAY_ROLLOVER_MIN).toBe(360);
    const prev = [placed('IN', MON, '08:00')];
    expect(workDateFor('OUT', at(TUE, '05:59'), VN, prev)).toBe(MON);
    expect(workDateFor('OUT', at(TUE, '06:00'), VN, prev)).toBe(TUE);
  });

  it('IN đã đóng (OUT 17:30 cùng ngày) ⇒ OUT 00:30 hôm sau KHÔNG gắn vào (không còn IN mở) ⇒ mồ côi', () => {
    const prev = [placed('IN', MON, '08:00'), placed('OUT', MON, '17:30')];
    expect(workDateFor('OUT', at(TUE, '00:30'), VN, prev)).toBe(TUE);
  });

  it('cùng ngày bấm OUT lại sau khi đã OUT ⇒ vẫn thuộc ngày đó (lấy lượt muộn nhất)', () => {
    const prev = [placed('IN', MON, '08:00'), placed('OUT', MON, '12:00')];
    expect(workDateFor('OUT', at(MON, '17:40'), VN, prev)).toBe(MON);
  });

  it('IN bị hủy không được tính là IN mở; lượt sau thời điểm OUT bị bỏ qua', () => {
    const voided = { ...placed('IN', MON, '08:00'), voidedAt: new Date('2026-11-16T05:00:00Z') };
    expect(workDateFor('OUT', at(TUE, '00:30'), VN, [voided])).toBe(TUE);
    const future = placed('IN', TUE, '08:00');
    expect(workDateFor('OUT', at(TUE, '00:30'), VN, [placed('IN', MON, '08:00'), future])).toBe(
      MON,
    );
  });

  it('không có IN nào ⇒ OUT thuộc ngày hiện tại', () => {
    expect(workDateFor('OUT', at(MON, '17:30'), VN, [])).toBe(MON);
  });
});

describe('local-time — quy đổi theo múi giờ IANA', () => {
  it('toLocal / instantOf khứ hồi ở VN và qua 2 ngày đổi giờ của Europe/Berlin', () => {
    for (const [date, time, tz] of [
      [MON, '08:00', VN],
      ['2026-03-29', '07:55', 'Europe/Berlin'],
      ['2026-03-29', '17:35', 'Europe/Berlin'],
      ['2026-10-25', '07:55', 'Europe/Berlin'],
      ['2026-10-25', '17:35', 'Europe/Berlin'],
    ] as const) {
      expect(toLocal(at(date, time, tz), tz)).toEqual({ date, minute: hm(time) });
    }
    // 08:00 CEST (29/03, sau khi đổi giờ) = 06:00Z; 08:00 CET (25/10, sau khi lùi giờ) = 07:00Z.
    expect(at('2026-03-29', '08:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    expect(at('2026-10-25', '08:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
  });

  it('minutesFrom: OUT sau nửa đêm vẫn đo từ 00:00 của workDate (≥ 1440); trước ngày ⇒ âm', () => {
    expect(minutesFrom(MON, at(TUE, '00:30'), VN)).toBe(1470);
    expect(minutesFrom(TUE, at(MON, '23:00'), VN)).toBe(-60);
  });

  it('daysBetween / addDays / weekdayOf (0 = thứ Hai … 6 = Chủ nhật)', () => {
    expect(daysBetween(MON, TUE)).toBe(1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf(MON)).toBe(0);
    expect(weekdayOf('2026-11-15')).toBe(6);
  });
});

describe('work-schedule — ngày làm + phiên bản hiệu lực (SD-29)', () => {
  const S0: WorkSchedule = {
    effectiveFrom: '2026-01-01',
    timezone: VN,
    workdays: 0b0111111,
    startMin: 480,
    endMin: 1050,
    breakStartMin: 720,
    breakEndMin: 810,
    graceMin: 0,
  };
  const S1: WorkSchedule = { ...S0, effectiveFrom: MON, startMin: 510 };

  it('T2–T7 là ngày làm, Chủ nhật thì không', () => {
    expect(isWorkday(S0, MON)).toBe(true);
    expect(isWorkday(S0, '2026-11-14')).toBe(true);
    expect(isWorkday(S0, '2026-11-15')).toBe(false);
  });

  it('phiên bản hiệu lực = effectiveFrom lớn nhất ≤ ngày; trước phiên bản đầu ⇒ null; thứ tự mảng không quan trọng', () => {
    expect(scheduleFor([S1, S0], '2026-11-13')).toBe(S0);
    expect(scheduleFor([S1, S0], MON)).toBe(S1);
    expect(scheduleFor([S0, S1], '2026-12-01')).toBe(S1);
    expect(scheduleFor([S0, S1], '2025-12-31')).toBeNull();
  });

  it('DEFAULT_SCHEDULE: chưa có phiên bản nào ≤ ngày ⇒ lịch mặc định T2–T7 08:00–17:30, nghỉ 12:00–13:30, grace 0, VN', () => {
    expect(effectiveSchedule([], MON)).toBe(DEFAULT_SCHEDULE);
    expect(effectiveSchedule([S1], '2026-11-13')).toBe(DEFAULT_SCHEDULE);
    expect(effectiveSchedule([S1], MON)).toBe(S1);
    expect(DEFAULT_SCHEDULE).toMatchObject({
      timezone: VN,
      workdays: 0b0111111,
      startMin: 480,
      endMin: 1050,
      breakStartMin: 720,
      breakEndMin: 810,
      graceMin: 0,
    });
    expect(Object.isFrozen(DEFAULT_SCHEDULE)).toBe(true);
  });
});
