import { describe, expect, it } from 'vitest';

import { normalizeDueDate } from './task-fields';

/** Mã lỗi đầu tiên (`issues[0].code`) hoặc null nếu hợp lệ. */
function issueOf(raw: string): string | null {
  try {
    normalizeDueDate(raw);
    return null;
  } catch (err) {
    return (
      (err as { issues?: { code: string }[] }).issues?.[0]?.code ?? 'không phải ValidationError'
    );
  }
}

// F3 (mutation, report §4.2): luật hạn chót R4 khi lệnh KHÔNG đi qua Zod ở biên HTTP (T-15, T-16, T-27).
describe('normalizeDueDate', () => {
  it.each(['x2026-01-01', '2026-01-01x', ' 2026-01-01', '2026-01-01\n'])(
    'T-15: ký tự thừa đầu/cuối %j ⇒ lỗi định dạng',
    (raw) => {
      expect(issueOf(raw)).toBe('invalid_format');
    },
  );

  it.each(['2026-13-01', '2026-00-10', '2026-02-30'])(
    'T-16: ngày không có thật %s ⇒ lỗi định dạng',
    (raw) => {
      expect(issueOf(raw)).toBe('invalid_format');
    },
  );

  it('T-27: biên năm 2000 và 2100 hợp lệ; 1999 / 2101 bị từ chối', () => {
    expect(normalizeDueDate('2000-01-01')).toBe('2000-01-01');
    expect(normalizeDueDate('2100-12-31')).toBe('2100-12-31');
    expect(issueOf('1999-12-31')).toBe('too_big');
    expect(issueOf('2101-01-01')).toBe('too_big');
  });

  it('không có hạn ⇒ null', () => {
    expect(normalizeDueDate(null)).toBeNull();
    expect(normalizeDueDate(undefined)).toBeNull();
  });
});
