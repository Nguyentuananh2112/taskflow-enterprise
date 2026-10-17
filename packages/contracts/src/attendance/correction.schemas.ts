import { z } from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import { Cursor, DateOnly, IsoDateTime, Uuid, Version, limitQuery } from '../common/primitives';
import { AttendanceKind } from '../hr/hr.schemas';
import {
  AttendanceDayDto,
  AttendanceEventDto,
  AttendanceTotalsDto,
  YearMonth,
} from './attendance.schemas';

// Đơn bổ sung giờ (Mốc 5, hr-extended.md ADR-129 — T-056) + xuất Excel bảng công (ADR-130). Cấp công ty: người gửi
// `attendance:self` (nhân viên đang làm), HR `hr:manage`; Admin không phải nhân viên ⇒ không gửi đơn.

export const CorrectionStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export type CorrectionStatus = z.infer<typeof CorrectionStatus>;

/** Giờ `HH:mm` theo LỊCH hiệu lực của `date` (như `AdjustAttendanceBody.time`). */
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm.');

/** Phút chốt ngày công (A#7): OUT trước 06:00 hôm sau vẫn thuộc `date`. */
export const CORRECTION_NEXT_DAY_BEFORE = '06:00';

/**
 * `POST attendance/corrections` — header `Idempotency-Key` (UUID, như check-in) bắt buộc. Strict: có `userId` ⇒ 400
 * (SEC-HR-45). `nextDay: true` chỉ cho OUT trước 06:00 (giờ chốt ngày công) ⇒ khác đi ⇒ 400. Lý do 1..500, chỉ người gửi
 * + HR đọc (có thể nhắc sức khỏe — B-H2): không vào thông báo, audit, log, `note` của lượt chấm, file xuất.
 * Luật nghiệp vụ (422 `details.rule`): `CORRECTION_DATE_OUT_OF_RANGE` (ngoài tháng này + tháng trước / trước ngày vào
 * nhiệm kỳ hiện tại / tương lai) · `OUTSIDE_RETENTION` · `CORRECTION_IN_FUTURE` · `CORRECTION_EVENT_EXISTS` (đã có lượt
 * cùng loại — không thay thế) · `CORRECTION_TIME_ORDER` (OUT phải sau giờ vào; IN phải trước giờ ra; chưa có IN ⇒
 * không xin OUT) · `CORRECTION_DAY_ON_LEAVE` (phép cả ngày đã duyệt). 409 `correction_pending_exists`: đã có đơn chờ
 * cùng ngày + loại. 429: 20 đơn/giờ.
 */
export const SubmitCorrectionBody = z
  .strictObject({
    date: DateOnly,
    kind: AttendanceKind,
    time: ClockTime,
    nextDay: z.boolean().default(false),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((b) => !b.nextDay || (b.kind === 'OUT' && b.time < CORRECTION_NEXT_DAY_BEFORE), {
    path: ['nextDay'],
    error: 'Chỉ giờ ra trước 06:00 hôm sau mới chọn "ra sau nửa đêm".',
  });
export type SubmitCorrectionBody = z.infer<typeof SubmitCorrectionBody>;

export const CorrectionParams = z.object({ requestId: Uuid });
export type CorrectionParams = z.infer<typeof CorrectionParams>;

/**
 * `GET attendance/corrections` — `mine=1` (`attendance:self`): đơn của mình; không có `mine` (`hr:manage`): mọi đơn của
 * công ty, mới nhất trước, lọc `status` (mặc định mọi trạng thái).
 */
export const ListCorrectionsQuery = z.strictObject({
  mine: z.literal('1').optional(),
  status: CorrectionStatus.optional(),
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListCorrectionsQuery = z.infer<typeof ListCorrectionsQuery>;

/** `POST attendance/corrections/:requestId/cancel` (người gửi, PENDING). Đơn của người khác ⇒ 404. */
export const CancelCorrectionBody = z.strictObject({ expectedVersion: Version });
export type CancelCorrectionBody = z.infer<typeof CancelCorrectionBody>;

/**
 * `POST attendance/corrections/:requestId/approve|reject` (`hr:manage`, KHÁC người gửi — tự duyệt ⇒ 403). `note` không
 * bắt buộc. Approve kiểm LẠI luật gửi + 422 `REQUESTER_NOT_EMPLOYEE` (người gửi đã nghỉ / thành Admin ⇒ chỉ còn từ chối);
 * 409 `invalid_transition` / `VERSION_CONFLICT`. Lặp approve cùng người duyệt + cùng `expectedVersion` sau khi đã
 * APPROVED ⇒ 200 trạng thái hiện tại, không thêm lượt.
 */
export const DecideCorrectionBody = z.strictObject({
  expectedVersion: Version,
  note: z.string().trim().min(1).max(500).optional(),
});
export type DecideCorrectionBody = z.infer<typeof DecideCorrectionBody>;

export const CorrectionDto = z.object({
  id: Uuid,
  userId: Uuid,
  user: UserRefDto,
  date: DateOnly,
  kind: AttendanceKind,
  /** `HH:mm` theo lịch của `date`; `nextDay` ⇒ giờ của sáng hôm sau (web hiện "00:30 (+1)"). */
  time: ClockTime,
  nextDay: z.boolean(),
  status: CorrectionStatus,
  decidedBy: UserRefDto.nullable(),
  decidedAt: IsoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  /** Lượt ADJUSTMENT tạo khi duyệt; khác null ⇔ APPROVED. */
  createdEventId: Uuid.nullable(),
  version: Version,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /**
   * Chỉ người gửi + `hr:manage` (B-H2) — người khác THIẾU HẲN trường; `null` sau hạn lưu lý do (13 tháng, retention D9).
   */
  reason: z.string().nullable().optional(),
  /** Ô ngày `date` của người gửi HIỆN TẠI (giờ vào / ra đang có, trạng thái) — HR đối chiếu trước khi duyệt. */
  day: AttendanceDayDto,
});
export type CorrectionDto = z.infer<typeof CorrectionDto>;

/** Kết quả approve (200): đơn + lượt ADJUSTMENT + ô ngày và tổng tháng đã tính lại (như `AttendanceEventChangeDto`). */
export const CorrectionApprovedDto = z.object({
  request: CorrectionDto,
  event: AttendanceEventDto,
  day: AttendanceDayDto,
  totals: AttendanceTotalsDto,
});
export type CorrectionApprovedDto = z.infer<typeof CorrectionApprovedDto>;

// ---------- Xuất Excel bảng công tháng (ADR-130) ----------

/**
 * `GET attendance/export.xlsx?month=YYYY-MM` (`hr:manage`) — `month` sai mẫu ⇒ 400; tháng chưa bắt đầu ⇒ 422
 * `PERIOD_NOT_STARTED`; > 1 000 người ⇒ 422 `EXPORT_TOO_LARGE` (trước header, không byte nào); 429 chung hạn mức CSV
 * (20/giờ/user) + 2 export đồng thời/công ty. Lỗi giữa stream ⇒ server hủy socket ⇒ `fetch` reject (không lưu file cụt).
 * Tên file đọc từ `Content-Disposition` (`Access-Control-Expose-Headers`).
 */
export const AttendanceExportXlsxQuery = z.strictObject({ month: YearMonth });
export type AttendanceExportXlsxQuery = z.infer<typeof AttendanceExportXlsxQuery>;

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `bang-cong-2026-10.xlsx` — dựng từ tham số đã validate, không tên người / công ty. */
export const attendanceExportFileName = (month: string) => `bang-cong-${month}.xlsx`;
export const ATTENDANCE_EXPORT_FILE_PATTERN = /^bang-cong-\d{4}-\d{2}\.xlsx$/;
