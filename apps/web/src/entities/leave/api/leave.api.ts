import * as z from 'zod';

import { http } from '@/shared/api';
import {
  LeaveBalanceDto,
  LeavePreviewDto,
  LeaveRequestDto,
  type SubmitLeaveBody,
} from '@taskflow/contracts/leave';

const base = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}`;

/** attendance-leave.md §5 (đơn của tôi + số phép). */
export const leaveApi = {
  mine: (wsId: string, cursor?: string) =>
    http.request('GET', `${base(wsId)}/leave-requests`, {
      schema: z.array(LeaveRequestDto),
      query: { mine: 1, cursor, limit: 50 },
    }),
  /** Đơn CHỜ DUYỆT của tôi — chỉ để đếm (lối tắt trên thẻ Chấm công, T-045). */
  minePending: (wsId: string) =>
    http.request('GET', `${base(wsId)}/leave-requests`, {
      schema: z.array(LeaveRequestDto),
      query: { mine: 1, status: 'PENDING', limit: 50 },
    }),
  create: (wsId: string, body: SubmitLeaveBody) =>
    http.post(`${base(wsId)}/leave-requests`, { schema: LeaveRequestDto, body }),
  cancel: (wsId: string, id: string, expectedVersion: number) =>
    http.post(`${base(wsId)}/leave-requests/${encodeURIComponent(id)}/cancel`, {
      schema: LeaveRequestDto,
      body: { expectedVersion },
    }),
  /** Xem trước số ngày (chỉ đọc; lỗi giống khi gửi). */
  preview: (wsId: string, q: Pick<SubmitLeaveBody, 'type' | 'startDate' | 'endDate' | 'dayPart'>) =>
    http.get(`${base(wsId)}/leave-requests/preview`, { schema: LeavePreviewDto, query: q }),
  myBalance: (wsId: string, year: number) =>
    http.get(`${base(wsId)}/leave-balances/me`, { schema: LeaveBalanceDto, query: { year } }),
};
