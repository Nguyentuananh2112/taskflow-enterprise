import { describe, expect, it } from 'vitest';

import { PAYROLL_EXPORT_FILE_PATTERN, payrollExportFileName } from './payroll-export';

describe('payrollExportFileName', () => {
  it('chỉ từ kỳ — khớp mẫu web đọc từ Content-Disposition', () => {
    expect(payrollExportFileName('2026-11')).toBe('bang-luong-2026-11.xlsx');
    expect(payrollExportFileName('2026-11')).toMatch(PAYROLL_EXPORT_FILE_PATTERN);
  });

  it('mẫu neo hai đầu — không nhận tên có tiền tố / hậu tố', () => {
    for (const bad of [
      'x-bang-luong-2026-11.xlsx',
      'bang-luong-2026-11.xlsx.exe',
      'bang-luong-2026-1.xlsx',
    ]) {
      expect(bad).not.toMatch(PAYROLL_EXPORT_FILE_PATTERN);
    }
  });
});
