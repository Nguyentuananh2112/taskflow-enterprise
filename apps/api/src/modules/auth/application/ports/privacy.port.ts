// T-075 — thông báo quyền riêng tư (data-retention.md §5). Cột trên bảng `users` (của auth); tách khỏi
// IUserRepository vì không thuộc aggregate User (như avatar_version — T-068). Mỗi lần đổi còn ghi một sự kiện
// CHỈ THÊM (`privacy_consent_events`) cùng transaction — bằng chứng đồng ý (NĐ 13/2023 Đ.11; soát B M1, TL chốt).

export interface PrivacyState {
  ackVersion: number | null;
  ackedAt: Date | null;
  consentLeaveReason: boolean;
  consentLeaveReasonAt: Date | null;
}

export const NO_PRIVACY_STATE: PrivacyState = {
  ackVersion: null,
  ackedAt: null,
  consentLeaveReason: false,
  consentLeaveReasonAt: null,
};

/** Ngữ cảnh bằng chứng của một lần ghi. */
export interface ConsentEvidence {
  /** Giờ THẬT. */
  at: Date;
  /** `X-Request-Id` của request (đối chiếu log); null ngoài HTTP. */
  requestId: string | null;
}

export interface IPrivacyStore {
  /** User đã xóa / không có ⇒ trạng thái mặc định (chưa xác nhận, chưa đồng ý). */
  get(userId: string): Promise<PrivacyState>;
  /**
   * Xác nhận phiên bản `version`. Đã xác nhận ĐÚNG phiên bản này ⇒ không ghi gì (giữ thời điểm LẦN ĐẦU — B). Khác ⇒
   * cập nhật cột + thêm sự kiện ACK cùng transaction. `false` ⇒ user không còn.
   */
  ack(input: { userId: string; version: number } & ConsentEvidence): Promise<boolean>;
  /**
   * Đồng ý / rút lại xử lý lý do nghỉ. Giá trị không đổi ⇒ không ghi gì. Đổi ⇒ cột + sự kiện LEAVE_REASON (kèm phiên bản
   * thông báo đang hiện hành) cùng transaction. `false` ⇒ user không còn.
   */
  setLeaveReasonConsent(
    input: { userId: string; consent: boolean; noticeVersion: number } & ConsentEvidence,
  ): Promise<boolean>;
  /** Cho module leave (`ILeaveReasonConsent` — khớp cấu trúc): đã đồng ý xử lý lý do nghỉ. */
  hasLeaveReasonConsent(userId: string): Promise<boolean>;
  /** Retention D16 (5 năm kể từ `at`): xóa tối đa `limit` sự kiện `at < cutoff`; trả số đã xóa. */
  purgeEventsBefore(cutoff: Date, limit: number): Promise<number>;
}

/** Rút đồng ý ⇒ xóa lý do của đơn nghỉ ĐANG CHỜ của chính người đó (leave hiện thực — NĐ 13 Đ.12, TL). */
export interface IPendingLeaveReasons {
  clearPendingReasons(userId: string): Promise<number>;
}

/** Bên kiểm soát dữ liệu = tên công ty + đầu mối liên hệ (cài đặt công ty — company nối ở composition). */
export interface IPrivacyCompanyInfo {
  info(): Promise<{ name: string; privacyContact: string | null } | null>;
}
