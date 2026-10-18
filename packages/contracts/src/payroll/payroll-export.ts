// Xuất bảng lương .xlsx (payroll.md §5.2, ADR-130; T-049) — tên file dựng từ kỳ đã validate, không tên người / công ty.

/** `bang-luong-2026-11.xlsx` */
export const payrollExportFileName = (period: string) => `bang-luong-${period}.xlsx`;
export const PAYROLL_EXPORT_FILE_PATTERN = /^bang-luong-\d{4}-\d{2}\.xlsx$/;
