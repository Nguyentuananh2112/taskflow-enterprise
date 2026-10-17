// T-043: logic điều phối của job retention trên store giả — thứ tự bước, mốc tính, lô, busy, abort.
// Hành vi SQL thật (biên ±1 ngày, PENDING, khóa giữa 2 instance) ở test/integration/maintenance/retention.int.ts.
import { describe, expect, it } from 'vitest';

import { FakeClock, FakeUnitOfWork } from '../../test/support';
import { RetentionJob, retentionSteps, type RetentionPolicy } from './retention-job';
import type { RetentionStores } from './retention-stores';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const B: RetentionPolicy = {
  clientInfoDays: 395,
  leaveReasonDays: 395,
  recordsDays: 730,
  notificationsDays: 180,
  hrAuditDays: 1826,
};

/** Mỗi lời gọi trả số dòng lấy lần lượt từ `remaining[bước]` (giới hạn bởi `limit`). */
function fakeStores(remaining: Record<string, number> = {}, locked = true) {
  const calls: { name: string; arg: unknown; limit: number }[] = [];
  const take = (name: string) => (arg: unknown, limit: number) => {
    calls.push({ name, arg, limit });
    const left = remaining[name] ?? 0;
    const n = Math.min(left, limit);
    remaining[name] = left - n;
    return Promise.resolve(n);
  };
  const stores: RetentionStores = {
    attendance: { scrubClientInfo: take('scrubClientInfo'), deleteEvents: take('deleteEvents') },
    leave: {
      scrubReasons: take('scrubReasons'),
      deleteRequestsBeforeYear: take('deleteRequestsBeforeYear'),
      deleteBalancesBeforeYear: take('deleteBalancesBeforeYear'),
    },
    company: {
      deleteDepartures: take('deleteDepartures'),
      deleteHrAuditLogs: take('deleteHrAuditLogs'),
      scrubHrAuditNotes: take('scrubHrAuditNotes'),
    },
    notifications: { deleteNotifications: take('deleteNotifications') },
    hrProfile: { deleteProfiles: take('deleteProfiles') },
    tryLock: () => Promise.resolve(locked),
  };
  return { stores, calls };
}

const job = (stores: RetentionStores) =>
  new RetentionJob({ stores, policy: B, uow: new FakeUnitOfWork(), clock: new FakeClock(NOW) });

describe('retentionSteps — mốc tính theo phương án B (NOW = 2026-12-01)', () => {
  it('xóa trước, scrub sau; mốc đúng từng bước', async () => {
    const { stores, calls } = fakeStores();
    for (const step of retentionSteps(stores, B, NOW)) await step.run(10);
    expect(calls.map((c) => [c.name, c.arg])).toEqual([
      ['deleteEvents', '2024-12-01'],
      ['deleteRequestsBeforeYear', 2024],
      ['deleteBalancesBeforeYear', 2024],
      // EP-10: D8 (hồ sơ) TRƯỚC D5 (departure là căn cứ giữ hồ sơ), cùng mốc ngày.
      ['deleteProfiles', '2024-12-01'],
      ['deleteDepartures', '2024-12-01'],
      ['deleteNotifications', new Date('2026-06-04T00:00:00.000Z')],
      ['deleteHrAuditLogs', new Date('2021-12-01T00:00:00.000Z')],
      ['scrubClientInfo', new Date('2025-11-01T00:00:00.000Z')],
      ['scrubReasons', '2025-11-01'],
      ['scrubHrAuditNotes', new Date('2025-11-01T00:00:00.000Z')],
    ]);
  });
});

describe('RetentionJob', () => {
  it('mỗi bước chạy tới khi lô < batchSize; đếm theo bước; complete', async () => {
    const { stores, calls } = fakeStores({ deleteEvents: 5, scrubReasons: 2 });
    const res = await job(stores).execute({ batchSize: 2 });
    expect(res).toMatchObject({ busy: false, complete: true });
    expect(res.rows).toMatchObject({ attendance_events: 5, leave_reasons: 2 });
    expect(calls.filter((c) => c.name === 'deleteEvents')).toHaveLength(3); // 2 + 2 + 1
    expect(calls.filter((c) => c.name === 'scrubReasons')).toHaveLength(2); // 2 + 0
  });

  it('không lấy được khóa ⇒ busy ngay, không gọi bước nào', async () => {
    const { stores, calls } = fakeStores({ deleteEvents: 5 }, false);
    expect(await job(stores).execute()).toMatchObject({ busy: true, batches: 0, complete: false });
    expect(calls).toEqual([]);
  });

  it('chạm maxBatches ⇒ dừng, chưa complete', async () => {
    const { stores } = fakeStores({ deleteEvents: 10 });
    expect(await job(stores).execute({ batchSize: 2, maxBatches: 3 })).toMatchObject({
      batches: 3,
      complete: false,
    });
  });

  it('signal hủy giữa lượt ⇒ dừng trước lô kế', async () => {
    const ctrl = new AbortController();
    const { stores, calls } = fakeStores({ deleteEvents: 10 });
    const original = { ...stores.attendance };
    stores.attendance.deleteEvents = (cutoff, limit) => {
      ctrl.abort();
      return original.deleteEvents(cutoff, limit);
    };
    expect(await job(stores).execute({ batchSize: 2, signal: ctrl.signal })).toMatchObject({
      batches: 1,
      complete: false,
    });
    expect(calls).toHaveLength(1);
  });
});
