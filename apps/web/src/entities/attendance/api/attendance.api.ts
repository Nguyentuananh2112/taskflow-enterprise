import { http } from '@/shared/api';
import {
  AttendanceEventsDto,
  AttendanceMonthDto,
  AttendanceTodayDto,
} from '@taskflow/contracts/attendance';

// Mốc 3.5 (ADR-136): chấm công thuộc CÔNG TY — route gốc `/attendance/…`, không còn `wsId`.
const base = '/attendance';

/** attendance-leave.md §5, company-level.md §4. Giờ chấm do SERVER ghi nhận — client không gửi giờ (ADR-120). */
export const attendanceApi = {
  today: () => http.get(`${base}/me/today`, { schema: AttendanceTodayDto }),
  /** `idempotencyKey`: một key mỗi lần bấm; thử lại sau lỗi mạng dùng lại cùng key. */
  checkIn: (idempotencyKey: string) =>
    http.post(`${base}/check-in`, { schema: AttendanceTodayDto, idempotencyKey }),
  checkOut: (idempotencyKey: string) =>
    http.post(`${base}/check-out`, { schema: AttendanceTodayDto, idempotencyKey }),
  /** Lượt chấm của chính mình trong một ngày (gồm lượt đã hủy, có IP/UA — NĐ 13 Đ.14). */
  myEvents: (date: string) =>
    http.get(`${base}/me/events`, { schema: AttendanceEventsDto, query: { date } }),
  month: (month: string) =>
    http.get(`${base}/me`, { schema: AttendanceMonthDto, query: { month } }),
};
