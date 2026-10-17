import type { ListEmployeesQuery } from '@taskflow/contracts/company';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { adminApi, employeesApi } from '../api/company.api';
import { companyKeys } from './query-keys';

const nextCursor = (last: {
  page?: { hasMore: boolean; nextCursor: string | null } | undefined;
}) => (last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined);

/** Danh sách nhân viên theo trạng thái + tìm (50/trang). `q` < 2 ký tự ⇒ không gửi (server 400). */
export function useEmployees(q: Pick<ListEmployeesQuery, 'status' | 'q'>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: companyKeys.employeeList(q),
    queryFn: ({ pageParam }) => employeesApi.list(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled,
    staleTime: 30_000,
  });
}

export function useAccessList(enabled: boolean) {
  return useQuery({
    queryKey: companyKeys.access(),
    queryFn: adminApi.access,
    enabled,
    staleTime: 30_000,
  });
}

export function useAdminWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: companyKeys.workspaces(),
    queryFn: adminApi.workspaces,
    enabled,
    staleTime: 30_000,
  });
}

export function useCompanyInfo(enabled: boolean) {
  return useQuery({
    queryKey: companyKeys.info(),
    queryFn: adminApi.company,
    enabled,
    staleTime: 60_000,
  });
}
