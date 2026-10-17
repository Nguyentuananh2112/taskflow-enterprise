export * from './payroll.schemas';
// TẠM (E, khi gộp T-048 + T-049): `PayslipSection` / `PayslipLineInput` trùng tên giữa hai file — tên ở schemas (Zod)
// thắng; phía math export đích danh tới khi A/B chốt tên.
export {
  MAX_HALF_DAYS,
  MAX_MONEY_VND,
  MAX_PAYSLIP_LINES,
  completedYears,
  computePayslip,
  daysInMonth,
  periodLastDay,
  salaryByDays,
  seniorityAllowanceOf,
  type PayslipInput,
  type PayslipTotals,
} from './payslip-math';
