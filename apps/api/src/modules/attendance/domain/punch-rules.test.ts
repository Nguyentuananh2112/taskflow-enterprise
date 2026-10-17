import { describe, expect, it } from 'vitest';

import { instantOf } from './local-time';
import { decidePunch, type PunchHistoryEvent } from './punch-rules';
import { DEFAULT_SCHEDULE, type WorkSchedule } from './work-schedule';

// T-063 (company-level.md ADR-136): luật chấm WEB thuần — dùng chung cho mọi route chấm của nhân viên.
const VN = 'Asia/Ho_Chi_Minh';
const MON = '2026-11-16';
const TUE = '2026-11-17';
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const at = (date: string, time: string, tz = VN) => instantOf(date, hm(time), tz);
const ev = (
  kind: 'IN' | 'OUT',
  date: string,
  time: string,
  extra: Partial<PunchHistoryEvent> = {},
): PunchHistoryEvent => ({
  kind,
  source: 'WEB',
  occurredAt: at(date, time),
  workDate: date,
  voidedAt: null,
  ...extra,
});
const always = [{ from: '2020-01-01', until: null }];
const decide = (
  kind: 'IN' | 'OUT',
  now: Date,
  recent: PunchHistoryEvent[] = [],
  tenures: { from: string; until: string | null }[] = always,
  schedules: WorkSchedule[] = [],
) => decidePunch({ kind, now, schedules, recent, tenures });

describe('decidePunch — IN', () => {
  it('lần đầu trong ngày ⇒ ghi, ngày công = ngày địa phương theo lịch', () => {
    expect(decide('IN', at(TUE, '08:05'))).toEqual({ ok: true, workDate: TUE });
  });

  it('đã có IN WEB còn hiệu lực cùng ngày ⇒ ALREADY_CHECKED_IN; IN đã hủy / IN của nguồn khác / IN hôm qua thì không', () => {
    expect(decide('IN', at(TUE, '09:00'), [ev('IN', TUE, '08:00')])).toEqual({
      ok: false,
      reason: 'ALREADY_CHECKED_IN',
    });
    for (const recent of [
      [ev('IN', TUE, '08:00', { voidedAt: at(TUE, '08:30') })],
      [ev('IN', TUE, '08:00', { source: 'ADJUSTMENT' })],
      [ev('IN', MON, '08:00')],
    ]) {
      expect(decide('IN', at(TUE, '09:00'), recent)).toEqual({ ok: true, workDate: TUE });
    }
  });

  it('A S1: ngoài nhiệm kỳ ⇒ NOT_EMPLOYED — trước ngày đầu, và 00:00–06:00 sau ngày cuối (khi vẫn còn quyền vào)', () => {
    expect(decide('IN', at(MON, '08:00'), [], [{ from: TUE, until: null }])).toEqual({
      ok: false,
      reason: 'NOT_EMPLOYED',
    });
    expect(decide('IN', at(TUE, '08:00'), [], [{ from: TUE, until: null }])).toEqual({
      ok: true,
      workDate: TUE,
    });
    expect(decide('IN', at(TUE, '01:00'), [], [{ from: '2026-01-05', until: MON }])).toEqual({
      ok: false,
      reason: 'NOT_EMPLOYED',
    });
    expect(decide('IN', at(MON, '23:59'), [], [{ from: '2026-01-05', until: MON }])).toEqual({
      ok: true,
      workDate: MON,
    });
    expect(decide('IN', at(TUE, '08:00'), [], [])).toEqual({ ok: false, reason: 'NOT_EMPLOYED' });
  });

  it('OUT mồ côi (không IN) cùng ngày không chặn IN — chỉ lượt IN mới tính "đã vào"', () => {
    expect(decide('IN', at(TUE, '08:00'), [ev('OUT', TUE, '07:00')])).toEqual({
      ok: true,
      workDate: TUE,
    });
  });

  it('NOT_EMPLOYED được kiểm trước ALREADY_CHECKED_IN', () => {
    expect(
      decide('IN', at(TUE, '09:00'), [ev('IN', TUE, '08:00')], [{ from: MON, until: MON }]),
    ).toEqual({ ok: false, reason: 'NOT_EMPLOYED' });
  });

  it('ngày công theo múi giờ của LỊCH: 23:30 VN = 01:30 Tokyo hôm sau', () => {
    const tokyo = { ...DEFAULT_SCHEDULE, effectiveFrom: '2026-01-01', timezone: 'Asia/Tokyo' };
    expect(decide('IN', at(TUE, '23:30'), [], always, [tokyo])).toEqual({
      ok: true,
      workDate: '2026-11-18',
    });
  });
});

describe('decidePunch — OUT', () => {
  it('có IN còn hiệu lực cùng ngày ⇒ ghi; OUT lặp lại (đã ra) vẫn ghi', () => {
    expect(decide('OUT', at(TUE, '17:30'), [ev('IN', TUE, '08:00')])).toEqual({
      ok: true,
      workDate: TUE,
    });
    expect(
      decide('OUT', at(TUE, '17:45'), [ev('IN', TUE, '08:00'), ev('OUT', TUE, '17:30')]),
    ).toEqual({ ok: true, workDate: TUE });
  });

  it('không có IN / IN đã hủy ⇒ NOT_CHECKED_IN', () => {
    expect(decide('OUT', at(TUE, '17:30'))).toEqual({ ok: false, reason: 'NOT_CHECKED_IN' });
    expect(
      decide('OUT', at(TUE, '17:30'), [ev('IN', TUE, '08:00', { voidedAt: at(TUE, '09:00') })]),
    ).toEqual({ ok: false, reason: 'NOT_CHECKED_IN' });
  });

  it('luật 06:00: OUT 05:59 hôm sau đóng IN của ngày cuối nhiệm kỳ (không kiểm nhiệm kỳ cho OUT); 06:00 ⇒ ngày mới', () => {
    const lastDay = [{ from: '2026-01-05', until: MON }];
    expect(decide('OUT', at(TUE, '05:59'), [ev('IN', MON, '20:00')], lastDay)).toEqual({
      ok: true,
      workDate: MON,
    });
    expect(decide('OUT', at(TUE, '06:00'), [ev('IN', MON, '20:00')], lastDay)).toEqual({
      ok: false,
      reason: 'NOT_CHECKED_IN',
    });
  });

  it('chỉ lượt IN mở được OUT: OUT mồ côi trước đó cùng ngày ⇒ vẫn NOT_CHECKED_IN', () => {
    expect(decide('OUT', at(TUE, '17:30'), [ev('OUT', TUE, '07:00')])).toEqual({
      ok: false,
      reason: 'NOT_CHECKED_IN',
    });
  });

  it('IN của nguồn ADJUSTMENT cũng mở được OUT (chỉ IN mới phân biệt nguồn WEB)', () => {
    expect(
      decide('OUT', at(TUE, '17:30'), [ev('IN', TUE, '08:00', { source: 'ADJUSTMENT' })]),
    ).toEqual({ ok: true, workDate: TUE });
  });
});
