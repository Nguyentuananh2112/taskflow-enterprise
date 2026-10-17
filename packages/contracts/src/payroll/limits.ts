// Mốc 4 (payroll.md ADR-125): trần số + tên mục của phiếu lương — KHÔNG import gì, để payroll.schemas (zod) và
// payslip-math (hàm thuần) cùng dùng mà không tạo vòng import (lint:deps no-circular).

/** Trần tiền một ô / một dòng (contract `MoneyVnd`). */
export const MAX_MONEY_VND = 1_000_000_000_000;
/** Trần số dòng gõ tay trên một phiếu. */
export const MAX_PAYSLIP_LINES = 50;
/** 31 ngày × 2 nửa. */
export const MAX_HALF_DAYS = 62;
/** Mục của phiếu: (1) thu nhập, (2) thưởng, (3) giảm trừ — `PayslipSection` (zod) dựng từ danh sách này. */
export const PAYSLIP_SECTIONS = ['INCOME', 'BONUS', 'DEDUCTION'] as const;
