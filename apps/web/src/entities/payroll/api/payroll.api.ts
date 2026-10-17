import * as z from 'zod';

import { http } from '@/shared/api';
import {
  MyPayslipListDto,
  PayrollRunDto,
  PayrollRunsDto,
  PayrollSettingsDto,
  PayslipDto,
  RecalcPreviewDto,
  SalaryProfileRowDto,
  SalaryProfileVersionDto,
  type CreateRevisionBody,
  type CreateSalaryProfileBody,
  type PutPayslipBody,
  XLSX_CONTENT_TYPE,
} from '@/shared/api/pending-contracts/payroll';

const enc = encodeURIComponent;
const run = (period: string) => `/payroll/runs/${enc(period)}`;

/** Phiếu lương của chính mình (nhân viên — Admin không có, payroll.md §0). */
export const payslipApi = {
  list: () => http.get('/payslips', { schema: MyPayslipListDto }),
  get: (period: string) => http.get(`/payslips/${enc(period)}`, { schema: PayslipDto }),
  revision: (period: string, revision: number) =>
    http.get(`/payslips/${enc(period)}/revisions/${revision}`, { schema: PayslipDto }),
};

/** Bảng lương (`payroll:manage` — Kế toán / Admin). Luật self tuyệt đối: phiếu / hồ sơ của chính Kế toán ⇒ 403. */
export const payrollApi = {
  settings: () => http.get('/payroll/settings', { schema: PayrollSettingsDto }),
  putSettings: (seniorityPerYear: number, expectedVersion: number) =>
    http.put('/payroll/settings', {
      schema: PayrollSettingsDto,
      body: { seniorityPerYear, expectedVersion },
    }),
  profiles: () => http.get('/payroll/salary-profiles', { schema: z.array(SalaryProfileRowDto) }),
  addProfileVersion: (userId: string, body: CreateSalaryProfileBody) =>
    http.post(`/payroll/salary-profiles/${enc(userId)}`, { schema: SalaryProfileVersionDto, body }),
  runs: () => http.get('/payroll/runs', { schema: PayrollRunsDto }),
  run: (period: string) => http.get(run(period), { schema: PayrollRunDto }),
  createRun: (period: string) => http.post(run(period), { schema: PayrollRunDto }),
  recalcPreview: (period: string) =>
    http.post(`${run(period)}/recalculate/preview`, { schema: RecalcPreviewDto }),
  recalc: (period: string) => http.post(`${run(period)}/recalculate`, { schema: PayrollRunDto }),
  addMissing: (period: string) =>
    http.post(`${run(period)}/add-missing`, { schema: PayrollRunDto }),
  publish: (period: string) =>
    http.post(`${run(period)}/publish`, { schema: PayrollRunDto, body: { confirmed: true } }),
  payslip: (period: string, userId: string) =>
    http.get(`${run(period)}/payslips/${enc(userId)}`, { schema: PayslipDto }),
  putPayslip: (period: string, userId: string, body: PutPayslipBody) =>
    http.put(`${run(period)}/payslips/${enc(userId)}`, { schema: PayslipDto, body }),
  revise: (period: string, userId: string, body: CreateRevisionBody) =>
    http.post(`${run(period)}/payslips/${enc(userId)}/revisions`, { schema: PayslipDto, body }),
  exportXlsx: (period: string) =>
    http.download(`${run(period)}/export.xlsx`, { accept: XLSX_CONTENT_TYPE }),
};
