import * as z from 'zod';

import { IsoDateTime } from '../common';

// T-075 — Thông báo quyền riêng tư (data-retention.md §5 + đoạn Mốc 4 / Mốc 6; TL chốt thay Q3/Q4 của R27).

/**
 * Phiên bản NỘI DUNG thông báo đang hiện hành. Đổi nội dung (thêm / sửa đoạn) ⇒ TĂNG số này trong cùng commit ⇒ mọi
 * người phải xác nhận lại (ackVersion < version).
 */
export const PRIVACY_NOTICE_VERSION = 1;

/** Đầu mối liên hệ về dữ liệu cá nhân (cài đặt công ty) — chữ tự do (tên, email, số điện thoại), ≤ 200 ký tự. */
export const PRIVACY_CONTACT_MAX = 200;
export const PrivacyContact = z.string().trim().max(PRIVACY_CONTACT_MAX);

/** `GET /me/privacy` — mọi người đang thuộc công ty (kể cả Admin: không phải nhân viên nhưng dùng chat / avatar). */
export const PrivacyDto = z.object({
  /** = `PRIVACY_NOTICE_VERSION` của server. */
  version: z.int().min(1),
  /** Phiên bản mình đã xác nhận; null = chưa từng. */
  ackVersion: z.int().min(1).nullable(),
  ackedAt: IsoDateTime.nullable(),
  /** `ackVersion !== version` ⇒ web hiện thông báo + nút "Tôi đã đọc". */
  needsAck: z.boolean(),
  /** Đồng ý để công ty xử lý LÝ DO NGHỈ (nếu ghi). false ⇒ API từ chối trường `reason` của đơn nghỉ (400). */
  consentLeaveReason: z.boolean(),
  consentLeaveReasonAt: IsoDateTime.nullable(),
  /** Bên kiểm soát dữ liệu = tên công ty; null khi chưa có dòng `companies`. */
  companyName: z.string().nullable(),
  /** null ⇒ web hiện "liên hệ quản trị viên". */
  privacyContact: z.string().nullable(),
});
export type PrivacyDto = z.infer<typeof PrivacyDto>;

/** `POST /me/privacy/ack` — `version` = phiên bản người dùng ĐANG XEM; khác bản hiện hành ⇒ 409 (tải lại nội dung). */
export const AckPrivacyBody = z.strictObject({ version: z.int().min(1) });
export type AckPrivacyBody = z.infer<typeof AckPrivacyBody>;

/**
 * `PUT /me/privacy/consent`. Rút lại (`false`) ⇒ CÙNG transaction xóa (NULL) lý do của các đơn nghỉ ĐANG CHỜ DUYỆT
 * của chính mình (NĐ 13 Đ.12 — dừng xử lý tiếp); đơn đã quyết giữ tới hạn D3 (13 tháng).
 */
export const PrivacyConsentBody = z.strictObject({ leaveReason: z.boolean() });
export type PrivacyConsentBody = z.infer<typeof PrivacyConsentBody>;

/** Response của `PUT /me/privacy/consent`: như PrivacyDto + số đơn PENDING vừa bị xóa lý do (0 khi đồng ý). */
export const PrivacyConsentResultDto = PrivacyDto.extend({
  clearedPendingReasons: z.int().min(0),
});
export type PrivacyConsentResultDto = z.infer<typeof PrivacyConsentResultDto>;
