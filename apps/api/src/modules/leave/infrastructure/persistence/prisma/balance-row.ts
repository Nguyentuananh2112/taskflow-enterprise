import type { LeaveBalanceRecord } from '../../../application/ports/leave.ports';
import { halfDaysFromDecimal } from '../../../domain/leave-balance';

type Dec = { toString(): string };

/** Cột cần đọc của `leave_balances` (T-057: `entitled_days` / `carried_over_days` NULL được). */
export const BALANCE_SELECT = {
  entitledDays: true,
  adjustmentDays: true,
  carriedOverDays: true,
} as const;

/** Dòng DB ⇒ record domain (nửa ngày). NULL giữ nguyên nghĩa: theo chính sách / chưa chụp (ADR-131). */
export function balanceFromRow(row: {
  entitledDays: Dec | null;
  adjustmentDays: Dec;
  carriedOverDays: Dec | null;
}): LeaveBalanceRecord {
  return {
    entitled: row.entitledDays === null ? null : halfDaysFromDecimal(row.entitledDays),
    adjustment: halfDaysFromDecimal(row.adjustmentDays),
    carried: row.carriedOverDays === null ? null : halfDaysFromDecimal(row.carriedOverDays),
  };
}
