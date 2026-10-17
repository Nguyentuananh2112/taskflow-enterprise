import { describe, expect, it } from 'vitest';

import { isApproveReplay, nextCorrectionStatus, type CorrectionStatus } from './correction-request';
import {
  correctionWindowStart,
  decideCorrection,
  isValidCorrectionTime,
  type CorrectionAsk,
} from './correction-rules';
import { instantOf } from './local-time';
import type { DayEvent } from './summarize-day';
import type { WorkSchedule } from './work-schedule';

// T-056 (hr-extended ADR-129): luật gửi đơn bổ sung giờ (CR-01..05 — luật 6 ở DB) + máy trạng thái (CR-07).
const VN = 'Asia/Ho_Chi_Minh';
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const at = (date: string, time: string, tz = VN) => instantOf(date, hm(time), tz);
const ev = (kind: 'IN' | 'OUT', date: string, time: string, voided = false): DayEvent => ({
  kind,
  occurredAt: at(date, time),
  voidedAt: voided ? at(date, '23:00') : null,
});
const ask = (over: Partial<CorrectionAsk> = {}): CorrectionAsk => ({
  date: '2026-11-16',
  kind: 'OUT',
  minuteOfDay: hm('17:45'),
  nextDay: false,
  ...over,
});
// "Bây giờ" mặc định: T3 17/11/2026 10:00 giờ VN. Mia vào từ 05/01/2026.
const decide = (
  over: Partial<Parameters<typeof decideCorrection>[0]> & { a?: Partial<CorrectionAsk> } = {},
) =>
  decideCorrection({
    ask: ask(over.a),
    now: at('2026-11-17', '10:00'),
    schedules: [],
    tenureStart: '2026-01-05',
    retentionCutoff: null,
    events: [ev('IN', '2026-11-16', '08:00')],
    fullDayLeave: false,
    ...over,
  });
const reason = (d: ReturnType<typeof decideCorrection>) => (d.ok ? 'OK' : d.reason);

describe('correctionWindowStart — ngày 1 tháng trước', () => {
  it('giữa năm, tháng 1 (lùi năm), tháng 3 (tháng 2 nhuận / không nhuận không ảnh hưởng)', () => {
    expect(correctionWindowStart('2026-11-17')).toBe('2026-10-01');
    expect(correctionWindowStart('2026-01-31')).toBe('2025-12-01');
    expect(correctionWindowStart('2026-03-01')).toBe('2026-02-01');
    expect(correctionWindowStart('2026-10-01')).toBe('2026-09-01');
  });
});

describe('decideCorrection — luật gửi ADR-129', () => {
  it('hợp lệ (MISSING_OUT xin giờ ra) ⇒ occurredAt đúng như ADJUSTMENT cùng tham số', () => {
    expect(decide()).toEqual({ ok: true, occurredAt: at('2026-11-16', '17:45') });
  });

  it('CR-01 luật 1: hôm nay được; ngày mai ⇒ OUT_OF_RANGE', () => {
    const today = decide({
      a: { date: '2026-11-17', kind: 'IN', minuteOfDay: hm('08:00') },
      events: [],
    });
    expect(today).toEqual({ ok: true, occurredAt: at('2026-11-17', '08:00') });
    expect(
      reason(decide({ a: { date: '2026-11-18', kind: 'IN', minuteOfDay: hm('08:00') } })),
    ).toBe('CORRECTION_DATE_OUT_OF_RANGE');
  });

  it('CR-01 luật 1: cửa sổ tháng này + tháng trước — 01/10 được, 30/09 ⇒ OUT_OF_RANGE', () => {
    const inAsk = { kind: 'IN' as const, minuteOfDay: hm('08:00') };
    expect(reason(decide({ a: { ...inAsk, date: '2026-10-01' }, events: [] }))).toBe('OK');
    expect(reason(decide({ a: { ...inAsk, date: '2026-09-30' }, events: [] }))).toBe(
      'CORRECTION_DATE_OUT_OF_RANGE',
    );
  });

  it('CR-01 luật 1: trước start_date của nhiệm kỳ hiện tại ⇒ OUT_OF_RANGE; chính ngày start_date được', () => {
    const inAsk = { kind: 'IN' as const, minuteOfDay: hm('08:00') };
    const rehired = { tenureStart: '2026-11-03', events: [] };
    expect(reason(decide({ ...rehired, a: { ...inAsk, date: '2026-11-02' } }))).toBe(
      'CORRECTION_DATE_OUT_OF_RANGE',
    );
    expect(reason(decide({ ...rehired, a: { ...inAsk, date: '2026-11-03' } }))).toBe('OK');
    // start_date trước cửa sổ ⇒ cửa sổ thắng.
    expect(
      reason(
        decide({ events: [], tenureStart: '2026-01-05', a: { ...inAsk, date: '2026-09-30' } }),
      ),
    ).toBe('CORRECTION_DATE_OUT_OF_RANGE');
  });

  it('CR-01 luật 1: trước mốc retention ⇒ OUTSIDE_RETENTION; đúng mốc được', () => {
    const inAsk = { kind: 'IN' as const, minuteOfDay: hm('08:00') };
    expect(
      reason(
        decide({ retentionCutoff: '2026-10-10', events: [], a: { ...inAsk, date: '2026-10-09' } }),
      ),
    ).toBe('OUTSIDE_RETENTION');
    expect(
      reason(
        decide({ retentionCutoff: '2026-10-10', events: [], a: { ...inAsk, date: '2026-10-10' } }),
      ),
    ).toBe('OK');
  });

  it('"hôm nay" theo múi giờ lịch: 17/11 00:30 VN là 16/11 ở UTC ⇒ xin cho 17/11 vẫn được', () => {
    const now = at('2026-11-17', '00:30');
    expect(
      reason(
        decide({
          now,
          events: [],
          a: { date: '2026-11-17', kind: 'IN', minuteOfDay: hm('00:10') },
        }),
      ),
    ).toBe('OK');
  });

  it('CR-02 luật 2: thời điểm xin sau bây giờ ⇒ IN_FUTURE; đúng bằng bây giờ được', () => {
    const today = { date: '2026-11-17', kind: 'IN' as const };
    expect(reason(decide({ events: [], a: { ...today, minuteOfDay: hm('10:01') } }))).toBe(
      'CORRECTION_IN_FUTURE',
    );
    expect(reason(decide({ events: [], a: { ...today, minuteOfDay: hm('10:00') } }))).toBe('OK');
  });

  it('CR-02 luật 2: OUT nextDay 05:59 gửi lúc 05:58 hôm sau ⇒ IN_FUTURE; lúc 05:59 được', () => {
    const a = { date: '2026-11-16', minuteOfDay: hm('05:59'), nextDay: true };
    expect(reason(decide({ now: at('2026-11-17', '05:58'), a }))).toBe('CORRECTION_IN_FUTURE');
    expect(decide({ now: at('2026-11-17', '05:59'), a })).toEqual({
      ok: true,
      occurredAt: at('2026-11-17', '05:59'),
    });
  });

  it('CR-03 luật 3: đã có IN hợp lệ ⇒ không xin IN; IN đã hủy không tính', () => {
    const inAsk = { kind: 'IN' as const, minuteOfDay: hm('07:55') };
    expect(reason(decide({ a: inAsk }))).toBe('CORRECTION_EVENT_EXISTS');
    expect(reason(decide({ a: inAsk, events: [ev('IN', '2026-11-16', '08:00', true)] }))).toBe(
      'OK',
    );
  });

  it('CR-03 luật 3: đã có OUT hợp lệ SAU firstIn ⇒ không xin OUT; OUT trước IN / OUT đã hủy không chặn', () => {
    const withOut = [ev('IN', '2026-11-16', '08:00'), ev('OUT', '2026-11-16', '17:30')];
    expect(reason(decide({ events: withOut }))).toBe('CORRECTION_EVENT_EXISTS');
    const earlyOut = [ev('OUT', '2026-11-16', '07:00'), ev('IN', '2026-11-16', '08:00')];
    expect(reason(decide({ events: earlyOut }))).toBe('OK');
    const voidedOut = [ev('IN', '2026-11-16', '08:00'), ev('OUT', '2026-11-16', '17:30', true)];
    expect(reason(decide({ events: voidedOut }))).toBe('OK');
    // OUT cùng thời điểm với IN không phải "OUT sau firstIn" (so như summarizeDay: ms, chặt).
    const sameInstant = [ev('IN', '2026-11-16', '08:00'), ev('OUT', '2026-11-16', '08:00')];
    expect(reason(decide({ events: sameInstant }))).toBe('OK');
    // Chỉ có OUT mồ côi (chưa IN): xin OUT ⇒ TIME_ORDER (xin IN trước), không phải EVENT_EXISTS.
    const orphanOut = [ev('OUT', '2026-11-16', '17:30')];
    expect(reason(decide({ events: orphanOut, a: { minuteOfDay: hm('18:00') } }))).toBe(
      'CORRECTION_TIME_ORDER',
    );
  });

  it('CR-04 luật 4: OUT phải SAU firstIn (bằng ⇒ lỗi; firstIn = IN sớm nhất); chưa có IN ⇒ không xin OUT', () => {
    expect(reason(decide({ a: { minuteOfDay: hm('08:00') } }))).toBe('CORRECTION_TIME_ORDER');
    expect(reason(decide({ a: { minuteOfDay: hm('08:01') } }))).toBe('OK');
    const twoIns = [ev('IN', '2026-11-16', '09:00'), ev('IN', '2026-11-16', '08:00')];
    expect(reason(decide({ events: twoIns, a: { minuteOfDay: hm('08:30') } }))).toBe(
      'OK', // sau IN SỚM NHẤT (08:00), dù trước IN 09:00
    );
    expect(reason(decide({ events: [] }))).toBe('CORRECTION_TIME_ORDER');
  });

  it('CR-04 luật 4: IN phải TRƯỚC lastOut (OUT mồ côi muộn nhất); bằng ⇒ lỗi; không có OUT ⇒ được', () => {
    const orphan = [ev('OUT', '2026-11-16', '12:00'), ev('OUT', '2026-11-16', '17:30')];
    const inAt = (t: string) => ({ kind: 'IN' as const, minuteOfDay: hm(t) });
    expect(reason(decide({ events: orphan, a: inAt('17:30') }))).toBe('CORRECTION_TIME_ORDER');
    expect(reason(decide({ events: orphan, a: inAt('17:29') }))).toBe('OK');
    expect(reason(decide({ events: [], a: inAt('17:29') }))).toBe('OK');
  });

  it('CR-05 luật 5: phép cả ngày đã duyệt ⇒ DAY_ON_LEAVE (sau các luật trước)', () => {
    expect(reason(decide({ fullDayLeave: true }))).toBe('CORRECTION_DAY_ON_LEAVE');
    expect(reason(decide({ fullDayLeave: true, a: { date: '2026-11-18' } }))).toBe(
      'CORRECTION_DATE_OUT_OF_RANGE',
    );
  });

  it('múi giờ theo LỊCH hiệu lực của ngày xin (không theo máy)', () => {
    const berlin: WorkSchedule = {
      effectiveFrom: '2026-01-01',
      timezone: 'Europe/Berlin',
      workdays: 0b0111111,
      startMin: 480,
      endMin: 1050,
      breakStartMin: 720,
      breakEndMin: 810,
      graceMin: 0,
    };
    const d = decide({
      schedules: [berlin],
      now: at('2026-11-17', '10:00', 'Europe/Berlin'),
      events: [
        { kind: 'IN', occurredAt: at('2026-11-16', '08:00', 'Europe/Berlin'), voidedAt: null },
      ],
    });
    expect(d).toEqual({ ok: true, occurredAt: at('2026-11-16', '17:45', 'Europe/Berlin') });
  });
});

describe('isValidCorrectionTime', () => {
  it('0..1439 nguyên; nextDay chỉ OUT < 06:00', () => {
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: 0, nextDay: false })).toBe(true);
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: 1439, nextDay: false })).toBe(true);
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: 1440, nextDay: false })).toBe(false);
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: -1, nextDay: false })).toBe(false);
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: 1.5, nextDay: false })).toBe(false);
    expect(isValidCorrectionTime({ kind: 'OUT', minuteOfDay: 359, nextDay: true })).toBe(true);
    expect(isValidCorrectionTime({ kind: 'OUT', minuteOfDay: 360, nextDay: true })).toBe(false);
    expect(isValidCorrectionTime({ kind: 'IN', minuteOfDay: 60, nextDay: true })).toBe(false);
  });
});

describe('CR-07 máy trạng thái', () => {
  const all: CorrectionStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
  it('chỉ PENDING chuyển được: cancel ⇒ CANCELLED, approve ⇒ APPROVED, reject ⇒ REJECTED; còn lại null', () => {
    const table = all.map((s) => [
      s,
      nextCorrectionStatus(s, 'cancel'),
      nextCorrectionStatus(s, 'approve'),
      nextCorrectionStatus(s, 'reject'),
    ]);
    expect(table).toEqual([
      ['PENDING', 'CANCELLED', 'APPROVED', 'REJECTED'],
      ['APPROVED', null, null, null],
      ['REJECTED', null, null, null],
      ['CANCELLED', null, null, null],
    ]);
  });

  it('CR-10 replay approve: cùng người + cùng expectedVersion (version = expected + 1) ⇒ true; khác ⇒ false', () => {
    const done = { status: 'APPROVED' as const, decidedById: 'hana', version: 2 };
    expect(isApproveReplay(done, { deciderId: 'hana', expectedVersion: 1 })).toBe(true);
    expect(isApproveReplay(done, { deciderId: 'ivy', expectedVersion: 1 })).toBe(false);
    expect(isApproveReplay(done, { deciderId: 'hana', expectedVersion: 2 })).toBe(false);
    expect(
      isApproveReplay({ ...done, status: 'REJECTED' }, { deciderId: 'hana', expectedVersion: 1 }),
    ).toBe(false);
  });
});
