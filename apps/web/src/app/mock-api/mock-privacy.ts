import { PRIVACY_NOTICE_VERSION, type PrivacyDto } from '@taskflow/contracts/privacy';

// T-075 — trạng thái thông báo quyền riêng tư của từng người (như server G): phiên bản đã xác nhận + đồng ý xử lý lý do
// nghỉ. Mặc định CHƯA xác nhận, CHƯA đồng ý (server chặn `reason` của đơn nghỉ ⇒ 400 LEAVE_REASON_CONSENT_REQUIRED).

type State = {
  ackVersion: number | null;
  ackedAt: string | null;
  consent: boolean;
  consentAt: string | null;
};

const EMPTY: State = { ackVersion: null, ackedAt: null, consent: false, consentAt: null };

export class MockPrivacy {
  /** = PRIVACY_NOTICE_VERSION; test đổi để giả lập nội dung mới (người đã đọc phải đọc lại). */
  version = PRIVACY_NOTICE_VERSION;
  private readonly states = new Map<string, State>();

  get(userId: string): State {
    return this.states.get(userId) ?? EMPTY;
  }

  ack(userId: string, version = this.version): void {
    this.states.set(userId, {
      ...this.get(userId),
      ackVersion: version,
      ackedAt: new Date().toISOString(),
    });
  }

  setConsent(userId: string, consent: boolean): void {
    this.states.set(userId, {
      ...this.get(userId),
      consent,
      consentAt: new Date().toISOString(),
    });
  }

  toDto(userId: string, company: { name: string; privacyContact: string | null }): PrivacyDto {
    const s = this.get(userId);
    return {
      version: this.version,
      ackVersion: s.ackVersion,
      ackedAt: s.ackedAt,
      needsAck: s.ackVersion !== this.version,
      consentLeaveReason: s.consent,
      consentLeaveReasonAt: s.consentAt,
      companyName: company.name,
      privacyContact: company.privacyContact,
    };
  }
}
