import {
  NO_PRIVACY_STATE,
  type ConsentEvidence,
  type IPrivacyStore,
  type PrivacyState,
} from '../../../application/ports/privacy.port';
import type { DbProvider } from './db';

/** T-075: cột quyền riêng tư trên `users` (user đã xóa ⇒ coi như không có) + sự kiện chỉ-thêm (bằng chứng). */
export class PrismaPrivacyStore implements IPrivacyStore {
  constructor(private readonly db: DbProvider) {}

  async get(userId: string): Promise<PrivacyState> {
    const row = await this.db().user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        privacyAckVersion: true,
        privacyAckAt: true,
        consentLeaveReason: true,
        consentLeaveReasonAt: true,
      },
    });
    if (!row) return NO_PRIVACY_STATE;
    return {
      ackVersion: row.privacyAckVersion,
      ackedAt: row.privacyAckAt,
      consentLeaveReason: row.consentLeaveReason,
      consentLeaveReasonAt: row.consentLeaveReasonAt,
    };
  }

  async ack(input: { userId: string; version: number } & ConsentEvidence): Promise<boolean> {
    // Chỉ ghi khi phiên bản ĐỔI (giữ thời điểm xác nhận đầu tiên của một phiên bản).
    const { count } = await this.db().user.updateMany({
      where: {
        id: input.userId,
        deletedAt: null,
        OR: [{ privacyAckVersion: null }, { privacyAckVersion: { not: input.version } }],
      },
      data: { privacyAckVersion: input.version, privacyAckAt: input.at },
    });
    if (count === 1) {
      await this.#event(input.userId, 'ACK', true, input.version, input);
      return true;
    }
    return this.#alive(input.userId);
  }

  async setLeaveReasonConsent(
    input: { userId: string; consent: boolean; noticeVersion: number } & ConsentEvidence,
  ): Promise<boolean> {
    const { count } = await this.db().user.updateMany({
      where: { id: input.userId, deletedAt: null, consentLeaveReason: !input.consent },
      data: { consentLeaveReason: input.consent, consentLeaveReasonAt: input.at },
    });
    if (count === 1) {
      await this.#event(input.userId, 'LEAVE_REASON', input.consent, input.noticeVersion, input);
      return true;
    }
    return this.#alive(input.userId);
  }

  async hasLeaveReasonConsent(userId: string): Promise<boolean> {
    return (await this.get(userId)).consentLeaveReason;
  }

  purgeEventsBefore(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM privacy_consent_events WHERE id IN (
        SELECT id FROM privacy_consent_events WHERE at < ${cutoff} ORDER BY at, id LIMIT ${limit})`;
  }

  async #alive(userId: string): Promise<boolean> {
    const u = await this.db().user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    return u !== null;
  }

  async #event(
    userId: string,
    kind: 'ACK' | 'LEAVE_REASON',
    value: boolean,
    noticeVersion: number,
    e: ConsentEvidence,
  ): Promise<void> {
    await this.db().privacyConsentEvent.create({
      data: { userId, kind, value, noticeVersion, at: e.at, requestId: e.requestId },
    });
  }
}
