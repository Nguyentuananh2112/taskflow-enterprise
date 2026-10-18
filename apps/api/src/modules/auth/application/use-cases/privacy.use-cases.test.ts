import { describe, expect, it, vi } from 'vitest';

import { FakeUnitOfWork } from '../../../../../test/support/fake-unit-of-work';
import {
  NO_PRIVACY_STATE,
  type ConsentEvidence,
  type IPrivacyStore,
  type PrivacyState,
} from '../ports/privacy.port';
import { PrivacyUseCases } from './privacy.use-cases';

const U = '00000000-0000-7000-8000-000000000001';
const at = new Date('2026-11-01T00:00:00Z');

/** Fake tối thiểu (application không import infrastructure — depcruise); `alive` = user còn. */
class FakePrivacyStore implements IPrivacyStore {
  rows = new Map<string, PrivacyState>();
  events: { kind: string; value: boolean; noticeVersion: number; requestId: string | null }[] = [];
  constructor(private readonly alive = true) {}
  get(userId: string) {
    return Promise.resolve(
      this.alive ? (this.rows.get(userId) ?? NO_PRIVACY_STATE) : NO_PRIVACY_STATE,
    );
  }
  ack(i: { userId: string; version: number } & ConsentEvidence) {
    if (!this.alive) return Promise.resolve(false);
    const cur = this.rows.get(i.userId) ?? NO_PRIVACY_STATE;
    if (cur.ackVersion === i.version) return Promise.resolve(true);
    this.rows.set(i.userId, { ...cur, ackVersion: i.version, ackedAt: i.at });
    this.events.push({
      kind: 'ACK',
      value: true,
      noticeVersion: i.version,
      requestId: i.requestId,
    });
    return Promise.resolve(true);
  }
  setLeaveReasonConsent(
    i: { userId: string; consent: boolean; noticeVersion: number } & ConsentEvidence,
  ) {
    if (!this.alive) return Promise.resolve(false);
    const cur = this.rows.get(i.userId) ?? NO_PRIVACY_STATE;
    this.rows.set(i.userId, { ...cur, consentLeaveReason: i.consent, consentLeaveReasonAt: i.at });
    this.events.push({
      kind: 'LEAVE_REASON',
      value: i.consent,
      noticeVersion: i.noticeVersion,
      requestId: i.requestId,
    });
    return Promise.resolve(true);
  }
  async hasLeaveReasonConsent(userId: string) {
    return (await this.get(userId)).consentLeaveReason;
  }
  purgeEventsBefore() {
    return Promise.resolve(0);
  }
  snapshot() {
    return { rows: new Map(this.rows), events: [...this.events] };
  }
  restore(s: unknown) {
    const x = s as { rows: Map<string, PrivacyState>; events: FakePrivacyStore['events'] };
    this.rows = new Map(x.rows);
    this.events = [...x.events];
  }
}

function setup(version: number, store = new FakePrivacyStore()) {
  const pending = { clearPendingReasons: vi.fn(() => Promise.resolve(2)) };
  return {
    store,
    pending,
    uc: new PrivacyUseCases({
      store,
      company: { info: () => Promise.resolve(null) },
      pendingLeaveReasons: pending,
      uow: new FakeUnitOfWork(store),
      clock: { now: () => at },
      requestId: () => 'req-1',
      version,
    }),
  };
}

describe('PrivacyUseCases (T-075)', () => {
  it('đổi nội dung (tăng phiên bản) ⇒ người đã xác nhận bản cũ lại needsAck; ack bản mới ⇒ hết; sự kiện có request id', async () => {
    const { store, uc } = setup(1);
    await uc.ack(U, 1);
    await uc.ack(U, 1); // lặp ⇒ không thêm sự kiện
    expect((await uc.get(U)).needsAck).toBe(false);
    const v2 = setup(2, store).uc;
    expect(await v2.get(U)).toMatchObject({ version: 2, ackVersion: 1, needsAck: true });
    await expect(v2.ack(U, 1)).rejects.toMatchObject({
      details: { reason: 'privacy_version_outdated' },
    });
    expect((await v2.ack(U, 2)).needsAck).toBe(false);
    expect(store.events).toEqual([
      { kind: 'ACK', value: true, noticeVersion: 1, requestId: 'req-1' },
      { kind: 'ACK', value: true, noticeVersion: 2, requestId: 'req-1' },
    ]);
  });

  it('rút đồng ý ⇒ xóa lý do đơn PENDING (số đơn trong response); đồng ý ⇒ không đụng đơn', async () => {
    const { pending, uc } = setup(1);
    expect((await uc.setLeaveReasonConsent(U, true)).clearedPendingReasons).toBe(0);
    expect(pending.clearPendingReasons).not.toHaveBeenCalled();
    const off = await uc.setLeaveReasonConsent(U, false);
    expect([off.consentLeaveReason, off.clearedPendingReasons]).toEqual([false, 2]);
    expect(pending.clearPendingReasons).toHaveBeenCalledWith(U);
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
