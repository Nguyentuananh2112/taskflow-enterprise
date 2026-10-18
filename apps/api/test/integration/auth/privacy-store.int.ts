// T-075 trên Postgres thật: cột quyền riêng tư trên `users` (CHECK cặp version ⇔ at), sự kiện chỉ-thêm
// `privacy_consent_events` ghi cùng transaction khi trạng thái ĐỔI (ack lặp giữ thời điểm đầu — soát B M1), user đã xóa
// ⇒ false, retention D16 xóa theo `at`; leave: rút đồng ý xóa lý do đơn PENDING (đơn đã quyết giữ).
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPrivacyStore } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-privacy.store';
import { PrismaLeaveRepository } from '../../../src/modules/leave/infrastructure/persistence/prisma/prisma-leave.repository';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const HASH = '$argon2id$v=19$m=47104,t=1,p=1$c2VlZC1zYWx0LXRlc3Q$ZmFrZS1oYXNoLWZvci10ZXN0LW9ubHk';
const AT = new Date('2026-11-01T00:00:00Z');
const LATER = new Date('2026-11-02T00:00:00Z');
const store = new PrismaPrivacyStore(() => testPrisma());
const ev = (at: Date) => ({ at, requestId: 'req-int' });

async function seed(name: string, deleted = false): Promise<string> {
  const u = await testPrisma().user.create({
    data: {
      email: `${name.toLowerCase()}-${randomUUID()}@example.com`,
      fullName: name,
      passwordHash: HASH,
      deletedAt: deleted ? AT : null,
    },
  });
  return u.id;
}
const events = (userId: string) =>
  testPrisma().privacyConsentEvent.findMany({
    where: { userId },
    orderBy: { at: 'asc' },
    select: { kind: true, value: true, noticeVersion: true, requestId: true },
  });

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe('PrismaPrivacyStore (T-075)', () => {
  it('ack: lần đầu ghi cột + sự kiện; ack lại cùng phiên bản ⇒ không ghi, giữ thời điểm đầu; bản mới ⇒ sự kiện mới', async () => {
    const mia = await seed('Mia');
    expect(await store.ack({ userId: mia, version: 1, ...ev(AT) })).toBe(true);
    expect(await store.ack({ userId: mia, version: 1, ...ev(LATER) })).toBe(true);
    expect(await store.get(mia)).toMatchObject({ ackVersion: 1, ackedAt: AT });
    await store.ack({ userId: mia, version: 2, ...ev(LATER) });
    expect(await events(mia)).toEqual([
      { kind: 'ACK', value: true, noticeVersion: 1, requestId: 'req-int' },
      { kind: 'ACK', value: true, noticeVersion: 2, requestId: 'req-int' },
    ]);
  });

  it('consent: chỉ ghi khi ĐỔI (true lặp không thêm); rút lại ⇒ sự kiện false; user đã xóa ⇒ false, không ghi', async () => {
    const mia = await seed('Mia');
    const gone = await seed('Gone', true);
    for (const consent of [true, true, false]) {
      await store.setLeaveReasonConsent({ userId: mia, consent, noticeVersion: 1, ...ev(AT) });
    }
    expect((await events(mia)).map((e) => [e.kind, e.value])).toEqual([
      ['LEAVE_REASON', true],
      ['LEAVE_REASON', false],
    ]);
    expect(await store.hasLeaveReasonConsent(mia)).toBe(false);
    expect(await store.ack({ userId: gone, version: 1, ...ev(AT) })).toBe(false);
    expect(
      await store.setLeaveReasonConsent({
        userId: gone,
        consent: true,
        noticeVersion: 1,
        ...ev(AT),
      }),
    ).toBe(false);
    expect(await events(gone)).toEqual([]);
  });

  it('CHECK: version ⇔ at; sự kiện ACK luôn true; notice_version > 0', async () => {
    const mia = await seed('Mia');
    await expect(
      testPrisma().user.update({ where: { id: mia }, data: { privacyAckVersion: 1 } }),
    ).rejects.toThrow(/users_privacy_ack_chk/);
    await expect(
      testPrisma().privacyConsentEvent.create({
        data: { userId: mia, kind: 'ACK', value: false, noticeVersion: 1, at: AT },
      }),
    ).rejects.toThrow(/privacy_consent_events_ack_true_chk/);
    await expect(
      testPrisma().privacyConsentEvent.create({
        data: { userId: mia, kind: 'LEAVE_REASON', value: true, noticeVersion: 0, at: AT },
      }),
    ).rejects.toThrow(/privacy_consent_events_notice_version_chk/);
  });

  it('retention D16: purgeEventsBefore xóa theo `at` (theo lô), giữ sự kiện mới', async () => {
    const mia = await seed('Mia');
    await store.ack({ userId: mia, version: 1, ...ev(new Date('2020-01-01T00:00:00Z')) });
    await store.setLeaveReasonConsent({ userId: mia, consent: true, noticeVersion: 1, ...ev(AT) });
    expect(await store.purgeEventsBefore(new Date('2021-12-01T00:00:00Z'), 10)).toBe(1);
    expect((await events(mia)).map((e) => e.kind)).toEqual(['LEAVE_REASON']);
  });
});

describe('PrismaLeaveRepository.clearPendingReasons (T-075 M2)', () => {
  it('chỉ đơn PENDING của chính người đó mất lý do; đơn đã duyệt / của người khác giữ', async () => {
    const mia = await seed('Mia');
    const vic = await seed('Vic');
    const row = (userId: string, status: 'PENDING' | 'APPROVED', reason: string) => ({
      id: randomUUID(),
      userId,
      type: 'ANNUAL' as const,
      startDate: new Date('2026-11-23T00:00:00Z'),
      endDate: new Date('2026-11-23T00:00:00Z'),
      dayPart: 'FULL' as const,
      reason,
      status,
      version: 1,
    });
    const rows = [row(mia, 'PENDING', 'a'), row(mia, 'APPROVED', 'b'), row(vic, 'PENDING', 'c')];
    for (const r of rows) await testPrisma().leaveRequest.create({ data: r });
    const repo = new PrismaLeaveRepository(() => testPrisma());
    expect(await repo.clearPendingReasons(mia)).toBe(1);
    const after = await testPrisma().leaveRequest.findMany({ select: { id: true, reason: true } });
    const byId = new Map(after.map((r) => [r.id, r.reason]));
    expect(rows.map((r) => byId.get(r.id))).toEqual([null, 'b', 'c']);
  });
});
