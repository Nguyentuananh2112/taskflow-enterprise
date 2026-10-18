import { randomUUID } from 'node:crypto';

import {
  NO_PRIVACY_STATE,
  type ConsentEvidence,
  type IPrivacyStore,
  type PrivacyState,
} from '../../../application/ports/privacy.port';

export interface PrivacyEventRow {
  id: string;
  userId: string;
  kind: 'ACK' | 'LEAVE_REASON';
  value: boolean;
  noticeVersion: number;
  at: Date;
  requestId: string | null;
}

/**
 * T-075 bản InMemory (local/test) — cùng hợp đồng với Prisma. `exists` = user còn (chưa xóa); composition nối từ
 * repository user. Snapshot / restore cho rollback của UoW (cả sự kiện).
 */
export class InMemoryPrivacyStore implements IPrivacyStore {
  #rows = new Map<string, PrivacyState>();
  #events: PrivacyEventRow[] = [];

  constructor(
    private readonly exists: (userId: string) => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  /** Cho test: sự kiện chỉ-thêm theo thứ tự ghi. */
  events(): readonly PrivacyEventRow[] {
    return [...this.#events];
  }

  async get(userId: string): Promise<PrivacyState> {
    if (!(await this.exists(userId))) return NO_PRIVACY_STATE;
    return { ...(this.#rows.get(userId) ?? NO_PRIVACY_STATE) };
  }

  async ack(input: { userId: string; version: number } & ConsentEvidence): Promise<boolean> {
    if (!(await this.exists(input.userId))) return false;
    const cur = this.#rows.get(input.userId) ?? NO_PRIVACY_STATE;
    if (cur.ackVersion === input.version) return true; // giữ thời điểm đầu
    this.#rows.set(input.userId, { ...cur, ackVersion: input.version, ackedAt: input.at });
    this.#event(input.userId, 'ACK', true, input.version, input);
    return true;
  }

  async setLeaveReasonConsent(
    input: { userId: string; consent: boolean; noticeVersion: number } & ConsentEvidence,
  ): Promise<boolean> {
    if (!(await this.exists(input.userId))) return false;
    const cur = this.#rows.get(input.userId) ?? NO_PRIVACY_STATE;
    if (cur.consentLeaveReason === input.consent) return true;
    this.#rows.set(input.userId, {
      ...cur,
      consentLeaveReason: input.consent,
      consentLeaveReasonAt: input.at,
    });
    this.#event(input.userId, 'LEAVE_REASON', input.consent, input.noticeVersion, input);
    return true;
  }

  async hasLeaveReasonConsent(userId: string): Promise<boolean> {
    return (await this.get(userId)).consentLeaveReason;
  }

  /** Như Prisma: giữ sự kiện MỚI NHẤT của mỗi (user, kind) — bằng chứng trạng thái hiện tại (soát B M1). */
  purgeEventsBefore(cutoff: Date, limit: number): Promise<number> {
    const newer = (e: PrivacyEventRow) =>
      this.#events.some(
        (n) =>
          n.userId === e.userId &&
          n.kind === e.kind &&
          (n.at > e.at || (n.at.getTime() === e.at.getTime() && n.id > e.id)),
      );
    const doomed = new Set(
      [...this.#events]
        .filter((e) => e.at < cutoff && newer(e))
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .slice(0, limit)
        .map((e) => e.id),
    );
    this.#events = this.#events.filter((e) => !doomed.has(e.id));
    return Promise.resolve(doomed.size);
  }

  #event(
    userId: string,
    kind: PrivacyEventRow['kind'],
    value: boolean,
    noticeVersion: number,
    e: ConsentEvidence,
  ): void {
    this.#events.push({
      id: randomUUID(),
      userId,
      kind,
      value,
      noticeVersion,
      at: e.at,
      requestId: e.requestId,
    });
  }

  snapshot(): unknown {
    return { rows: new Map(this.#rows), events: [...this.#events] };
  }

  restore(snapshot: unknown): void {
    const s = snapshot as { rows: Map<string, PrivacyState>; events: PrivacyEventRow[] };
    this.#rows = new Map(s.rows);
    this.#events = [...s.events];
  }
}
