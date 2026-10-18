import { describe, expect, it } from 'vitest';

import { FakeUnitOfWork } from '../../../../../test/support/fake-unit-of-work';
import { NO_PRIVACY_STATE, type IPrivacyStore, type PrivacyState } from '../ports/privacy.port';
import { PrivacyUseCases } from './privacy.use-cases';

const U = '00000000-0000-7000-8000-000000000001';
const at = new Date('2026-11-01T00:00:00Z');

/** Fake tối thiểu (application không import infrastructure — depcruise); `alive` = user còn. */
class FakePrivacyStore implements IPrivacyStore {
  rows = new Map<string, PrivacyState>();
  constructor(private readonly alive = true) {}
  get(userId: string) {
    return Promise.resolve(
      this.alive ? (this.rows.get(userId) ?? NO_PRIVACY_STATE) : NO_PRIVACY_STATE,
    );
  }
  ack(i: { userId: string; version: number; at: Date }) {
    if (!this.alive) return Promise.resolve(false);
    const cur = this.rows.get(i.userId) ?? NO_PRIVACY_STATE;
    this.rows.set(i.userId, { ...cur, ackVersion: i.version, ackedAt: i.at });
    return Promise.resolve(true);
  }
  setLeaveReasonConsent(i: { userId: string; consent: boolean; at: Date }) {
    if (!this.alive) return Promise.resolve(false);
    const cur = this.rows.get(i.userId) ?? NO_PRIVACY_STATE;
    this.rows.set(i.userId, { ...cur, consentLeaveReason: i.consent, consentLeaveReasonAt: i.at });
    return Promise.resolve(true);
  }
  async hasLeaveReasonConsent(userId: string) {
    return (await this.get(userId)).consentLeaveReason;
  }
  snapshot() {
    return new Map(this.rows);
  }
  restore(s: unknown) {
    this.rows = new Map(s as Map<string, PrivacyState>);
  }
}

function setup(version: number, store = new FakePrivacyStore()) {
  return {
    store,
    uc: new PrivacyUseCases({
      store,
      company: { info: () => Promise.resolve(null) },
      uow: new FakeUnitOfWork(store),
      clock: { now: () => at },
      version,
    }),
  };
}

describe('PrivacyUseCases (T-075)', () => {
  it('đổi nội dung (tăng phiên bản) ⇒ người đã xác nhận bản cũ lại needsAck; ack bản mới ⇒ hết', async () => {
    const { store, uc } = setup(1);
    await uc.ack(U, 1);
    expect((await uc.get(U)).needsAck).toBe(false);
    const v2 = setup(2, store).uc;
    expect(await v2.get(U)).toMatchObject({ version: 2, ackVersion: 1, needsAck: true });
    await expect(v2.ack(U, 1)).rejects.toMatchObject({
      details: { reason: 'privacy_version_outdated' },
    });
    expect((await v2.ack(U, 2)).needsAck).toBe(false);
  });

  it('user không còn ⇒ 401 khi ghi; đọc ⇒ trạng thái mặc định; chưa có công ty ⇒ companyName null', async () => {
    const { uc } = setup(1, new FakePrivacyStore(false));
    await expect(uc.ack(U, 1)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(uc.setLeaveReasonConsent(U, true)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await uc.get(U)).toMatchObject({
      ackVersion: null,
      consentLeaveReason: false,
      companyName: null,
    });
  });
});
