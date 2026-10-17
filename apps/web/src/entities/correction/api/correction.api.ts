import {
  CorrectionApprovedDto,
  CorrectionDto,
  type CorrectionStatus,
  type DecideCorrectionBody,
  type SubmitCorrectionBody,
} from '@taskflow/contracts/attendance';
import * as z from 'zod';

import { http } from '@/shared/api';

const base = '/attendance/corrections';
const enc = encodeURIComponent;

/** Đơn bổ sung giờ (ADR-129, hr-extended §4). Người gửi: `attendance:self`; duyệt / từ chối: `hr:manage`. */
export const correctionApi = {
  /** `idempotencyKey`: MỘT key cho mỗi lần mở form — bấm lại / thử lại sau lỗi mạng không tạo đơn thứ hai. */
  submit: (body: SubmitCorrectionBody, idempotencyKey: string) =>
    http.post(base, { schema: CorrectionDto, body, idempotencyKey }),
  mine: (cursor?: string) =>
    http.request('GET', base, {
      schema: z.array(CorrectionDto),
      query: { mine: '1', cursor, limit: 50 },
    }),
  list: (status: CorrectionStatus | undefined, cursor?: string) =>
    http.request('GET', base, {
      schema: z.array(CorrectionDto),
      query: { status, cursor, limit: 50 },
    }),
  cancel: (id: string, expectedVersion: number) =>
    http.post(`${base}/${enc(id)}/cancel`, { schema: CorrectionDto, body: { expectedVersion } }),
  approve: (id: string, body: DecideCorrectionBody) =>
    http.post(`${base}/${enc(id)}/approve`, { schema: CorrectionApprovedDto, body }),
  reject: (id: string, body: DecideCorrectionBody) =>
    http.post(`${base}/${enc(id)}/reject`, { schema: CorrectionDto, body }),
};
