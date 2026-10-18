import {
  NO_PRIVACY_STATE,
  type IPrivacyStore,
  type PrivacyState,
} from '../../../application/ports/privacy.port';
import type { DbProvider } from './db';

/** T-075: cột quyền riêng tư trên `users` (user đã xóa ⇒ coi như không có). */
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

  async ack(input: { userId: string; version: number; at: Date }): Promise<boolean> {
    const { count } = await this.db().user.updateMany({
      where: { id: input.userId, deletedAt: null },
      data: { privacyAckVersion: input.version, privacyAckAt: input.at },
    });
    return count === 1;
  }

  async setLeaveReasonConsent(input: { userId: string; consent: boolean; at: Date }) {
    const { count } = await this.db().user.updateMany({
      where: { id: input.userId, deletedAt: null },
      data: { consentLeaveReason: input.consent, consentLeaveReasonAt: input.at },
    });
    return count === 1;
  }

  async hasLeaveReasonConsent(userId: string): Promise<boolean> {
    return (await this.get(userId)).consentLeaveReason;
  }
}
