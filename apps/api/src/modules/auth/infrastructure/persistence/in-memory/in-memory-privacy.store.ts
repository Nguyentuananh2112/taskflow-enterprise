import {
  NO_PRIVACY_STATE,
  type IPrivacyStore,
  type PrivacyState,
} from '../../../application/ports/privacy.port';

/**
 * T-075 bản InMemory (local/test) — cùng hợp đồng với Prisma. `exists` = user còn (chưa xóa); composition nối từ
 * repository user. Snapshot / restore cho rollback của UoW.
 */
export class InMemoryPrivacyStore implements IPrivacyStore {
  #rows = new Map<string, PrivacyState>();

  constructor(
    private readonly exists: (userId: string) => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  async get(userId: string): Promise<PrivacyState> {
    if (!(await this.exists(userId))) return NO_PRIVACY_STATE;
    return { ...(this.#rows.get(userId) ?? NO_PRIVACY_STATE) };
  }

  async ack(input: { userId: string; version: number; at: Date }): Promise<boolean> {
    if (!(await this.exists(input.userId))) return false;
    const cur = this.#rows.get(input.userId) ?? NO_PRIVACY_STATE;
    this.#rows.set(input.userId, { ...cur, ackVersion: input.version, ackedAt: input.at });
    return true;
  }

  async setLeaveReasonConsent(input: { userId: string; consent: boolean; at: Date }) {
    if (!(await this.exists(input.userId))) return false;
    const cur = this.#rows.get(input.userId) ?? NO_PRIVACY_STATE;
    this.#rows.set(input.userId, {
      ...cur,
      consentLeaveReason: input.consent,
      consentLeaveReasonAt: input.at,
    });
    return true;
  }

  async hasLeaveReasonConsent(userId: string): Promise<boolean> {
    return (await this.get(userId)).consentLeaveReason;
  }

  snapshot(): unknown {
    return new Map(this.#rows);
  }

  restore(snapshot: unknown): void {
    this.#rows = new Map(snapshot as Map<string, PrivacyState>);
  }
}
