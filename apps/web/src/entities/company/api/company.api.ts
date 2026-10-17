import {
  AccessDto,
  CompanyDto,
  EmployeeDto,
  HireEmployeeResponse,
  OffboardingResponse,
  ReissueActivationResponse,
  type HireEmployeeBody,
  type ListEmployeesQuery,
  type ScheduleOffboardingBody,
  type SetAccessBody,
  type UpdateCompanyBody,
} from '@taskflow/contracts/company';
import * as z from 'zod';

import { http } from '@/shared/api';
import { AdminWorkspaceWithMembersDto } from '@/shared/api/pending-contracts/company';

const enc = encodeURIComponent;

/** Nhân viên (`hr:manage` — company-level.md §4, ADR-137). Token kích hoạt chỉ có trong response thêm / tạo lại link. */
export const employeesApi = {
  list: (q: Pick<ListEmployeesQuery, 'status' | 'q'>, cursor?: string) =>
    http.request('GET', '/hr/employees', {
      schema: z.array(EmployeeDto),
      query: { status: q.status, q: q.q, cursor, limit: 50 },
    }),
  hire: (body: HireEmployeeBody) =>
    http.post('/hr/employees', { schema: HireEmployeeResponse, body }),
  reissueLink: (userId: string) =>
    http.post(`/hr/employees/${enc(userId)}/activation-link`, {
      schema: ReissueActivationResponse,
    }),
  scheduleOffboarding: (userId: string, body: ScheduleOffboardingBody) =>
    http.put(`/hr/employees/${enc(userId)}/offboarding`, { schema: OffboardingResponse, body }),
  cancelOffboarding: (userId: string) =>
    http.delete(`/hr/employees/${enc(userId)}/offboarding`, { schema: EmployeeDto }),
};

/** Quản trị (`company:admin` / `company:grant` — ADR-134). */
export const adminApi = {
  access: () => http.get('/admin/access', { schema: z.array(AccessDto) }),
  setAccess: (userId: string, body: SetAccessBody) =>
    http.put(`/admin/access/${enc(userId)}`, { schema: AccessDto, body }),
  workspaces: () =>
    http.get('/admin/workspaces', { schema: z.array(AdminWorkspaceWithMembersDto) }),
  assignOwner: (workspaceId: string, userId: string) =>
    http.post(`/admin/workspaces/${enc(workspaceId)}/owner`, {
      schema: AdminWorkspaceWithMembersDto,
      body: { userId },
    }),
  archive: (workspaceId: string) =>
    http.post(`/admin/workspaces/${enc(workspaceId)}/archive`, {
      schema: AdminWorkspaceWithMembersDto,
    }),
  company: () => http.get('/company', { schema: CompanyDto }),
  updateCompany: (body: UpdateCompanyBody) => http.patch('/company', { schema: CompanyDto, body }),
};
