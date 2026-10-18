// T-075 — thông báo quyền riêng tư (data-retention.md §5). Cột trên bảng `users` (của auth); tách khỏi
// IUserRepository vì không thuộc aggregate User (như avatar_version — T-068).

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

export interface IPrivacyStore {
  /** User đã xóa / không có ⇒ trạng thái mặc định (chưa xác nhận, chưa đồng ý). */
  get(userId: string): Promise<PrivacyState>;
  /** Ghi phiên bản đã xác nhận + thời điểm. `false` ⇒ user không còn. */
  ack(input: { userId: string; version: number; at: Date }): Promise<boolean>;
  /** Đổi đồng ý xử lý lý do nghỉ; `at` = lúc đổi (cả khi rút lại). `false` ⇒ user không còn. */
  setLeaveReasonConsent(input: { userId: string; consent: boolean; at: Date }): Promise<boolean>;
  /** Cho module leave (`ILeaveReasonConsent` — khớp cấu trúc): đã đồng ý xử lý lý do nghỉ. */
  hasLeaveReasonConsent(userId: string): Promise<boolean>;
}

/** Bên kiểm soát dữ liệu = tên công ty + đầu mối liên hệ (cài đặt công ty — company nối ở composition). */
export interface IPrivacyCompanyInfo {
  info(): Promise<{ name: string; privacyContact: string | null } | null>;
}
