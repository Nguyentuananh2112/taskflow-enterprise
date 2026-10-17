import { describe, expect, it } from 'vitest';

import { dateInTz, daysInMonth, localToIso, nextVnDateAnchor } from './clock';

// Harness Mốc 5 (test-spec-hr-extended §1.1): mốc theo NGÀY — đầu tháng, 31/12, hạn E (cuối tháng, năm nhuận),
// ngày đổi giờ Berlin. `from` cố định ⇒ kỳ vọng tất định.

const FROM = new Date('2026-10-17T05:00:00Z'); // 17/10/2026 12:00 VN

describe('nextVnDateAnchor', () => {
  it.each([
    ['12-31', '23:59:30', '2026-12-31T16:59:30.000Z'],
    ['*-01', '00:00:30', '2026-10-31T17:00:30.000Z'],
    ['01-01', '06:00:00', '2026-12-31T23:00:00.000Z'],
    ['03-L', '23:59:30', '2027-03-31T16:59:30.000Z'],
    ['02-L', '12:00:00', '2027-02-28T05:00:00.000Z'],
    ['02-29', '12:00:00', '2028-02-29T05:00:00.000Z'],
    ['10-18', '10:00:00', '2027-10-18T03:00:00.000Z'],
    ['10-19', '10:00:00', '2026-10-19T03:00:00.000Z'],
  ])('%s %s ⇒ %s', (day, hms, want) => {
    expect(nextVnDateAnchor(day, hms, { from: FROM })).toBe(want);
  });

  it('luôn ≥ hôm nay + 2 (như nextVnAnchor) — không bao giờ ở quá khứ', () => {
    const a = nextVnDateAnchor('*-L', '00:00:00', { from: FROM });
    expect(a).toBe('2026-10-30T17:00:00.000Z');
    expect(Date.parse(a)).toBeGreaterThan(FROM.getTime() + 86_400_000);
  });

  it('múi Europe/Berlin: ngày đổi giờ cuối tháng 10 (CET +1) và cuối tháng 3 (CEST +2)', () => {
    // 25/10/2026 là Chủ nhật đổi giờ; 10:00 Berlin = 09:00Z (sau đổi giờ, +1).
    expect(nextVnDateAnchor('10-25', '10:00:00', { tz: 'Europe/Berlin', from: FROM })).toBe(
      '2026-10-25T09:00:00.000Z',
    );
    expect(nextVnDateAnchor('03-28', '10:00:00', { tz: 'Europe/Berlin', from: FROM })).toBe(
      '2027-03-28T08:00:00.000Z',
    );
  });

  it('giờ không tồn tại (khe đổi giờ Berlin 28/03/2027 02:30) ⇒ ném lỗi', () => {
    expect(() => localToIso('2027-03-28', '02:30:00', 'Europe/Berlin')).toThrow(/không tồn tại/);
  });

  it.each(['13-01', '12-32', '1-1', '*-00', 'xx'])('day sai "%s" ⇒ ném lỗi', (day) => {
    expect(() => nextVnDateAnchor(day, '00:00:00', { from: FROM })).toThrow();
  });
});

describe('daysInMonth / dateInTz', () => {
  it('tháng 2 nhuận / không nhuận (hạn E — LP-07)', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
  it('ngày theo múi', () => {
    expect(dateInTz('2026-12-31T17:00:00Z', 'Asia/Ho_Chi_Minh')).toBe('2027-01-01');
    expect(dateInTz('2026-12-31T17:00:00Z', 'Europe/Berlin')).toBe('2026-12-31');
  });
});
