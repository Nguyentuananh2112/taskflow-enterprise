import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../../../../test/support';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IRefreshTokenPurger } from '../ports/refresh-token-purger.port';
import {
  PurgeExpiredRefreshTokensJob,
  REFRESH_TOKEN_PURGE_BATCH,
  REFRESH_TOKEN_RETENTION_AFTER_EXPIRY_MS,
} from './purge-expired-refresh-tokens.job';

const NOW = new Date('2026-12-01T00:00:00.000Z');

/** Purger giả: còn `remaining` dòng quá hạn; ghi lại cutoff/limit và số lô chạy TRONG transaction. */
class FakePurger implements IRefreshTokenPurger {
  readonly calls: { cutoff: Date; limit: number; inTx: boolean }[] = [];
  busy = false;
  constructor(
    public remaining: number,
    private readonly uow: { inTransaction: boolean },
  ) {}

  purgeExpired(cutoff: Date, limit: number): Promise<number | null> {
    this.calls.push({ cutoff, limit, inTx: this.uow.inTransaction });
    if (this.busy) return Promise.resolve(null);
    const n = Math.min(limit, this.remaining);
    this.remaining -= n;
    return Promise.resolve(n);
  }
}

/** UoW giả ghi nhận đang ở trong transaction hay không (lô phải chạy trong `run`). */
class TrackingUnitOfWork implements IUnitOfWork {
  inTransaction = false;

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.inTransaction = true;
    try {
      return await work();
    } finally {
      this.inTransaction = false;
    }
  }

  afterCommit(): void {}
}

function setup(remaining: number) {
  const uow = new TrackingUnitOfWork();
  const purger = new FakePurger(remaining, uow);
  const job = new PurgeExpiredRefreshTokensJob({ purger, uow, clock: new FakeClock(NOW) });
  return { job, purger };
}

describe('PurgeExpiredRefreshTokensJob (G2 S2, security.md §2.2)', () => {
  it('cutoff = now − 7 ngày; mỗi lô một transaction; lô cuối < batch ⇒ complete', async () => {
    const { job, purger } = setup(12);
    expect(await job.execute({ batchSize: 5 })).toEqual({
      deleted: 12,
      batches: 3,
      busy: false,
      complete: true,
    });
    expect(purger.calls).toHaveLength(3);
    for (const call of purger.calls) {
      expect(call.cutoff).toEqual(
        new Date(NOW.getTime() - REFRESH_TOKEN_RETENTION_AFTER_EXPIRY_MS),
      );
      expect(call).toMatchObject({ limit: 5, inTx: true });
    }
    expect(REFRESH_TOKEN_RETENTION_AFTER_EXPIRY_MS).toBe(7 * 24 * 3_600_000);
  });

  it('không còn gì ⇒ 1 lô rỗng, complete; mặc định batch 5000', async () => {
    const { job, purger } = setup(0);
    expect(await job.execute()).toEqual({ deleted: 0, batches: 1, busy: false, complete: true });
    expect(purger.calls[0]?.limit).toBe(REFRESH_TOKEN_PURGE_BATCH);
  });

  it('chạm trần số lô ⇒ dừng, chưa complete (lượt sau làm tiếp)', async () => {
    const { job, purger } = setup(100);
    expect(await job.execute({ batchSize: 10, maxBatches: 3 })).toEqual({
      deleted: 30,
      batches: 3,
      busy: false,
      complete: false,
    });
    expect(purger.remaining).toBe(70);
  });

  it('instance khác đang chạy lô ⇒ busy, dừng ngay', async () => {
    const { job, purger } = setup(10);
    purger.busy = true;
    expect(await job.execute()).toEqual({ deleted: 0, batches: 0, busy: true, complete: false });
    expect(purger.calls).toHaveLength(1);
  });

  it('signal hủy (graceful shutdown) ⇒ dừng TRƯỚC lô kế tiếp', async () => {
    const { job, purger } = setup(100);
    const abort = new AbortController();
    const original = purger.purgeExpired.bind(purger);
    purger.purgeExpired = async (cutoff, limit) => {
      const n = await original(cutoff, limit);
      abort.abort(); // shutdown trong lúc lô đầu chạy
      return n;
    };
    expect(await job.execute({ batchSize: 10, signal: abort.signal })).toMatchObject({
      deleted: 10,
      batches: 1,
      complete: false,
    });
    const aborted = new AbortController();
    aborted.abort();
    const fresh = setup(5);
    expect(await fresh.job.execute({ signal: aborted.signal })).toMatchObject({ batches: 0 });
    expect(fresh.purger.calls).toHaveLength(0);
  });
});
