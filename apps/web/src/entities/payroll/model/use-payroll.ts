import { useQuery } from '@tanstack/react-query';

import { payrollApi, payslipApi } from '../api/payroll.api';
import { payrollKeys, payslipKeys } from './query-keys';

// Số tiền ⇒ không giữ lâu trong cache (`gcTime` ngắn) và luôn lấy lại khi mở (staleTime 0).
const MONEY = { staleTime: 0, gcTime: 60_000 } as const;

export function useMyPayslips(enabled: boolean) {
  return useQuery({ queryKey: payslipKeys.list(), queryFn: payslipApi.list, enabled, ...MONEY });
}

export function useMyPayslip(period: string | null) {
  return useQuery({
    queryKey: payslipKeys.one(period ?? ''),
    queryFn: () => payslipApi.get(period ?? ''),
    enabled: period !== null,
    ...MONEY,
  });
}

export function useMyPayslipRevision(period: string, revision: number | null) {
  return useQuery({
    queryKey: payslipKeys.revision(period, revision ?? 0),
    queryFn: () => payslipApi.revision(period, revision ?? 0),
    enabled: revision !== null,
    ...MONEY,
  });
}

export function usePayrollRuns(enabled: boolean) {
  return useQuery({ queryKey: payrollKeys.runs(), queryFn: payrollApi.runs, enabled, ...MONEY });
}

export function usePayrollRun(period: string, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.run(period),
    queryFn: () => payrollApi.run(period),
    enabled,
    ...MONEY,
  });
}

export function usePayslipForEdit(period: string, userId: string) {
  return useQuery({
    queryKey: payrollKeys.payslip(period, userId),
    queryFn: () => payrollApi.payslip(period, userId),
    ...MONEY,
  });
}

export function useSalaryProfiles(enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.profiles(),
    queryFn: payrollApi.profiles,
    enabled,
    ...MONEY,
  });
}

export function usePayrollSettings(enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.settings(),
    queryFn: payrollApi.settings,
    enabled,
    ...MONEY,
  });
}
