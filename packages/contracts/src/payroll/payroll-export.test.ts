import { describe, expect, it } from 'vitest';

import { PAYROLL_EXPORT_FILE_PATTERN, payrollExportFileName } from './payroll-export';

describe('payrollExportFileName', () => {
  it('chỉ từ kỳ — khớp mẫu web đọc từ Content-Disposition', () => {
    expect(payrollExportFileName('2026-11')).toBe('bang-luong-2026-11.xlsx');
    expect(payrollExportFileName('2026-11')).toMatch(PAYROLL_EXPORT_FILE_PATTERN);
  });
});
