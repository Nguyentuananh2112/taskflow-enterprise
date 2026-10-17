import * as z from 'zod';

import { http } from '@/shared/api';

/** Như `XLSX_CONTENT_TYPE` của attendance (T-056) — nhánh Mốc 4 chưa có contract đó. */
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
import {
  MyPayslipDto,
  MyPayslipSummaryDto,
  PayrollRunDto,
  PayrollRunListDto,
  PayrollSettingsDto,
  PayslipDto,
  RecalculatePreviewDto,
  SalaryProfileDto,
  SalaryProfileVersionDto,
  type CreatePayslipRevisionBody,
  type CreateSalaryProfileVersionBody,
  type PutPayslipBody,
} from '@taskflow/contracts/payroll';

const enc = encodeURIComponent;
const run = (period: string) => `/payroll/runs/${enc(period)}`;

/** Phiếu lương của chính mình (nhân viên — Admin không có, payroll.md §0). */
export const payslipApi = {
  list: () => http.get('/payslips', { schema: z.array(MyPayslipSummaryDto) }),
  get: (period: string) => http.get(`/payslips/${enc(period)}`, { schema: MyPayslipDto }),
  revision: (period: string, revision: number) =>
    http.get(`/payslips/${enc(period)}/revisions/${revision}`, { schema: MyPayslipDto }),
};

/** Bảng lương (`payroll:manage` — Kế toán / Admin). Luật self tuyệt đối: phiếu / hồ sơ của chính Kế toán ⇒ 403. */
export const payrollApi = {
  settings: () => http.get('/payroll/settings', { schema: PayrollSettingsDto }),
  putSettings: (seniorityPerYear: number, expectedVersion: number) =>
    http.put('/payroll/settings', {
      schema: PayrollSettingsDto,
      body: { seniorityPerYear, expectedVersion },
    }),
  profiles: () => http.get('/payroll/salary-profiles', { schema: z.array(SalaryProfileDto) }),
  addProfileVersion: (userId: string, body: CreateSalaryProfileVersionBody) =>
    http.post(`/payroll/salary-profiles/${enc(userId)}`, { schema: SalaryProfileVersionDto, body }),
  runs: () => http.get('/payroll/runs', { schema: PayrollRunListDto }),
  run: (period: string) => http.get(run(period), { schema: PayrollRunDto }),
  createRun: (period: string) => http.post(run(period), { schema: PayrollRunDto }),
  recalcPreview: (period: string) =>
    http.post(`${run(period)}/recalculate/preview`, { schema: RecalculatePreviewDto }),
  recalc: (period: string) => http.post(`${run(period)}/recalculate`, { schema: PayrollRunDto }),
  addMissing: (period: string) =>
    http.post(`${run(period)}/add-missing`, { schema: PayrollRunDto }),
  publish: (period: string) =>
    http.post(`${run(period)}/publish`, { schema: PayrollRunDto, body: { confirmed: true } }),
  payslip: (period: string, userId: string) =>
    http.get(`${run(period)}/payslips/${enc(userId)}`, { schema: PayslipDto }),
  putPayslip: (period: string, userId: string, body: PutPayslipBody) =>
    http.put(`${run(period)}/payslips/${enc(userId)}`, { schema: PayslipDto, body }),
  revise: (period: string, userId: string, body: CreatePayslipRevisionBody) =>
    http.post(`${run(period)}/payslips/${enc(userId)}/revisions`, { schema: PayslipDto, body }),
  exportXlsx: (period: string) =>
    http.download(`${run(period)}/export.xlsx`, { accept: XLSX_CONTENT_TYPE }),
};
