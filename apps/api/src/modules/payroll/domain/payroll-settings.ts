/**
 * Dòng `payroll_settings` DUY NHẤT (CHECK id = 1 — payroll.md §3) và giá trị mặc định — CÙNG giá trị với INSERT của
 * migration `…_payroll`. Một nguồn cho migration-mirror (seed, store bộ nhớ, tự tạo lại khi thiếu).
 */
export const PAYROLL_SETTINGS_ID = 1;
export const DEFAULT_SENIORITY_PER_YEAR = 500_000;
