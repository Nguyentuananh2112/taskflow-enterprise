import { describe, expect, it } from 'vitest';

import { seniorityOf } from './seniority';

describe('seniorityOf (T-054 / ADR-125 — tháng tròn, ngày thuần)', () => {
  it.each([
    ['2026-01-15', '2026-01-15', 0, 0],
    ['2026-01-15', '2026-02-14', 0, 0],
    ['2026-01-15', '2026-02-15', 0, 1],
    ['2021-11-17', '2026-11-16', 4, 11],
    ['2021-11-17', '2026-11-17', 5, 0],
    // Ngày kỷ niệm kẹp vào cuối tháng ngắn.
    ['2026-01-31', '2026-02-28', 0, 1],
    ['2024-01-31', '2024-02-28', 0, 0],
    ['2024-01-31', '2024-02-29', 0, 1],
    ['2024-02-29', '2025-02-28', 1, 0],
    // Vào sau hôm nay ⇒ 0.
    ['2026-12-01', '2026-11-17', 0, 0],
  ])('%s → %s ⇒ %i năm %i tháng', (hire, today, years, months) => {
    expect(seniorityOf(hire, today)).toEqual({ years, months });
  });
});
