import { http } from '@/shared/api';
import {
  AttendanceEventsDto,
  AttendanceMonthDto,
  AttendanceTodayDto,
} from '@taskflow/contracts/attendance';

const base = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}/attendance`;

/** attendance-leave.md §5. Giờ chấm do SERVER ghi nhận — client không gửi giờ (ADR-120). */
export const attendanceApi = {
  today: (wsId: string) => http.get(`${base(wsId)}/me/today`, { schema: AttendanceTodayDto }),
  /** `idempotencyKey`: một key mỗi lần bấm; thử lại sau lỗi mạng dùng lại cùng key. */
  checkIn: (wsId: string, idempotencyKey: string) =>
    http.post(`${base(wsId)}/check-in`, { schema: AttendanceTodayDto, idempotencyKey }),
  checkOut: (wsId: string, idempotencyKey: string) =>
    http.post(`${base(wsId)}/check-out`, { schema: AttendanceTodayDto, idempotencyKey }),
  /** Lượt chấm của chính mình trong một ngày (gồm lượt đã hủy, có IP/UA — NĐ 13 Đ.14). */
  myEvents: (wsId: string, date: string) =>
    http.get(`${base(wsId)}/me/events`, { schema: AttendanceEventsDto, query: { date } }),
  month: (wsId: string, month: string) =>
    http.get(`${base(wsId)}/me`, { schema: AttendanceMonthDto, query: { month } }),
};
