import { describe, expect, it } from 'vitest';

import { instantOf } from './local-time';
import { employedOn, tenureOnLocalDays } from './tenure';

// test-spec-hr §1: SD-37..SD-40 (nhiệm kỳ ⇒ cờ `employed` của summarizeDay; SD-41..43 ở summarize-day.test).
// ADR-133 (A C1): nhiệm kỳ bằng NGÀY, gồm cả ngày đầu và ngày cuối.
const VN = 'Asia/Ho_Chi_Minh';

describe('employedOn', () => {
  const joined = [{ from: '2026-11-15', until: null }];

  it('SD-37 trước ngày đầu ⇒ ngoài nhiệm kỳ', () => {
    expect(employedOn(joined, '2026-11-14')).toBe(false);
  });

  it('SD-38 chính ngày đầu ⇒ trong nhiệm kỳ; ngày sau cũng vậy', () => {
    expect(employedOn(joined, '2026-11-15')).toBe(true);
    expect(employedOn(joined, '2027-03-01')).toBe(true);
  });

  it('SD-39 ngày cuối tính như thường, từ ngày kế tiếp ⇒ ngoài nhiệm kỳ (không lệch 1 ngày — A C1)', () => {
    const left = [{ from: '2026-01-05', until: '2026-11-20' }];
    expect(employedOn(left, '2026-11-20')).toBe(true);
    expect(employedOn(left, '2026-11-21')).toBe(false);
    expect(employedOn(left, '2026-01-04')).toBe(false);
  });

  it('SD-39c nhiệm kỳ một ngày (nâng lên Admin ngay ngày vào) ⇒ chỉ ngày đó', () => {
    const oneDay = [{ from: '2026-11-15', until: '2026-11-15' }];
    expect(employedOn(oneDay, '2026-11-15')).toBe(true);
    expect(employedOn(oneDay, '2026-11-14')).toBe(false);
    expect(employedOn(oneDay, '2026-11-16')).toBe(false);
  });

  it('SD-40 nghỉ rồi nhận lại ⇒ khoảng giữa hai nhiệm kỳ ngoài nhiệm kỳ; không có nhiệm kỳ nào ⇒ false', () => {
    const twice = [
      { from: '2026-01-05', until: '2026-06-10' },
      { from: '2026-09-01', until: null },
    ];
    expect(employedOn(twice, '2026-06-10')).toBe(true);
    expect(employedOn(twice, '2026-07-15')).toBe(false);
    expect(employedOn(twice, '2026-08-31')).toBe(false);
    expect(employedOn(twice, '2026-09-01')).toBe(true);
    expect(employedOn([], '2026-09-01')).toBe(false);
  });
});

describe('tenureOnLocalDays (tạm — nhiệm kỳ ws instant)', () => {
  it('SD-39b biên múi giờ: rời 20/11 00:30 giờ VN (= 19/11 17:30Z) ⇒ ngày cuối 20/11 theo lịch VN, 19/11 theo UTC', () => {
    const t = { from: instantOf('2026-01-05', 480, VN), until: new Date('2026-11-19T17:30:00Z') };
    expect(tenureOnLocalDays(t, VN)).toEqual({ from: '2026-01-05', until: '2026-11-20' });
    expect(tenureOnLocalDays(t, 'UTC').until).toBe('2026-11-19');
    expect(tenureOnLocalDays({ ...t, until: null }, VN).until).toBeNull();
  });
});
