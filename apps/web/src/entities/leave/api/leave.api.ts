import * as z from 'zod';

import { http } from '@/shared/api';
import {
  LeaveBalanceDto,
  LeavePreviewDto,
  LeaveRequestDto,
  type SubmitLeaveBody,
} from '@taskflow/contracts/leave';

// Mốc 3.5 (ADR-136): nghỉ phép thuộc CÔNG TY — route gốc `/leave/…`, không còn `wsId`.
const requests = '/leave/requests';

/** attendance-leave.md §5, company-level.md §4 (đơn của tôi + số phép). */
export const leaveApi = {
  mine: (cursor?: string) =>
    http.request('GET', requests, {
      schema: z.array(LeaveRequestDto),
      query: { mine: 1, cursor, limit: 50 },
    }),
  /** Đơn CHỜ DUYỆT của tôi — chỉ để đếm (lối tắt trên thẻ Chấm công, T-045). */
  minePending: () =>
    http.request('GET', requests, {
      schema: z.array(LeaveRequestDto),
      query: { mine: 1, status: 'PENDING', limit: 50 },
    }),
  create: (body: SubmitLeaveBody) => http.post(requests, { schema: LeaveRequestDto, body }),
  cancel: (id: string, expectedVersion: number) =>
    http.post(`${requests}/${encodeURIComponent(id)}/cancel`, {
      schema: LeaveRequestDto,
      body: { expectedVersion },
    }),
  /** Xem trước số ngày (chỉ đọc; lỗi giống khi gửi). */
  preview: (q: Pick<SubmitLeaveBody, 'type' | 'startDate' | 'endDate' | 'dayPart'>) =>
    http.get(`${requests}/preview`, { schema: LeavePreviewDto, query: q }),
  myBalance: (year: number) =>
    http.get('/leave/balances/me', { schema: LeaveBalanceDto, query: { year } }),
};
