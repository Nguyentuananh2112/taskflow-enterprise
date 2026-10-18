// payroll.md §5.3: gốc ['company', …] (ADR-139) — đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()`; mất
// `payroll:manage` (`company:access-changed`) ⇒ xóa nhánh ['company', 'payroll'] ngay.
export const payrollKeys = {
  all: () => ['company', 'payroll'] as const,
  settings: () => ['company', 'payroll', 'settings'] as const,
  profiles: () => ['company', 'payroll', 'profiles'] as const,
  runs: () => ['company', 'payroll', 'runs'] as const,
  run: (period: string) => ['company', 'payroll', 'runs', period] as const,
  payslip: (period: string, userId: string) =>
    ['company', 'payroll', 'runs', period, 'payslip', userId] as const,
};

export const payslipKeys = {
  all: () => ['company', 'payslips'] as const,
  list: () => ['company', 'payslips', 'list'] as const,
  one: (period: string) => ['company', 'payslips', period] as const,
  revision: (period: string, revision: number) =>
    ['company', 'payslips', period, 'revision', revision] as const,
};
