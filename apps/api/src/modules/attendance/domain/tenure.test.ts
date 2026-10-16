import { describe, expect, it } from 'vitest';

import { instantOf } from './local-time';
import { employedOn } from './tenure';

// test-spec-hr §1: SD-37..SD-40 (nhiệm kỳ ⇒ cờ `employed` của summarizeDay; SD-41..43 ở summarize-day.test).
const VN = 'Asia/Ho_Chi_Minh';
const at = (date: string, min: number) => instantOf(date, min, VN);

describe('employedOn', () => {
  const joined = [{ from: at('2026-11-15', 14 * 60), until: null }];

  it('SD-37 trước ngày gia nhập ⇒ ngoài nhiệm kỳ', () => {
    expect(employedOn(joined, '2026-11-14', VN)).toBe(false);
  });

  it('SD-38 chính ngày gia nhập (vào 14:00) ⇒ trong nhiệm kỳ; ngày sau cũng vậy', () => {
    expect(employedOn(joined, '2026-11-15', VN)).toBe(true);
    expect(employedOn(joined, '2027-03-01', VN)).toBe(true);
  });

  it('SD-39 ngày rời tính như thường, từ ngày kế tiếp ⇒ ngoài nhiệm kỳ', () => {
    const left = [{ from: at('2026-01-05', 480), until: at('2026-11-20', 17 * 60) }];
    expect(employedOn(left, '2026-11-20', VN)).toBe(true);
    expect(employedOn(left, '2026-11-21', VN)).toBe(false);
  });

  it('SD-39b biên múi giờ: rời 20/11 00:30 giờ VN (= 19/11 17:30Z) ⇒ ngày rời là 20/11 theo lịch', () => {
    const left = [{ from: at('2026-01-05', 480), until: new Date('2026-11-19T17:30:00Z') }];
    expect(employedOn(left, '2026-11-20', VN)).toBe(true);
    expect(employedOn(left, '2026-11-21', VN)).toBe(false);
    // Cùng thời điểm theo lịch UTC ⇒ ngày rời là 19/11.
    expect(employedOn(left, '2026-11-20', 'UTC')).toBe(false);
  });

  it('SD-40 rời rồi vào lại ⇒ khoảng giữa hai nhiệm kỳ ngoài nhiệm kỳ; không có nhiệm kỳ nào ⇒ false', () => {
    const twice = [
      { from: at('2026-01-05', 480), until: at('2026-06-10', 600) },
      { from: at('2026-09-01', 480), until: null },
    ];
    expect(employedOn(twice, '2026-06-10', VN)).toBe(true);
    expect(employedOn(twice, '2026-07-15', VN)).toBe(false);
    expect(employedOn(twice, '2026-09-01', VN)).toBe(true);
    expect(employedOn([], '2026-09-01', VN)).toBe(false);
  });
});
