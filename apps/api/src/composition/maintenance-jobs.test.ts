import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeClock, FakeUnitOfWork, SpyLogger } from '../../test/support';
import { PurgeRunBusyError } from '../modules/workspace/infrastructure/jobs/exclusive-purge-run';
import {
  MaintenanceScheduler,
  maintenanceEnabled,
  purgeWorkspacesJob,
  type ScheduledJob,
} from './maintenance-jobs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const job = (run: ScheduledJob['run']): ScheduledJob => ({
  name: 'demo',
  intervalMs: 60_000,
  jitterMs: 10_000,
  run,
});

describe('MaintenanceScheduler (T-033)', () => {
  it('hẹn lượt đầu sau interval + jitter; lượt sau chỉ hẹn khi lượt trước XONG (không chồng lượt)', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const slow = job(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      runs += 1;
      await new Promise((r) => setTimeout(r, 200_000)); // dài hơn cả chu kỳ
      active -= 1;
    });
    const s = new MaintenanceScheduler([slow], { logger: new SpyLogger(), random: () => 0.5 });
    s.start();
    await vi.advanceTimersByTimeAsync(64_999);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(200_000 + 65_000);
    expect(runs).toBe(2);
    expect(maxActive).toBe(1);
    const stopping = s.stop(1_000); // lượt 2 còn chạy ⇒ stop chờ tối đa 1 s (timer giả)
    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
  });

  it('job ném lỗi ⇒ log maintenance.run_failed (chỉ tên/mã lỗi), lượt sau vẫn chạy', async () => {
    const logger = new SpyLogger();
    let runs = 0;
    const failing = job(() => {
      runs += 1;
      return Promise.reject(
        Object.assign(new Error('chi tiết truy vấn bí mật'), { code: 'P2010' }),
      );
    });
    const s = new MaintenanceScheduler([failing], { logger, random: () => 0 });
    s.start();
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(runs).toBe(2);
    const failed = logger.entries.find((e) => e.msg === 'maintenance.run_failed');
    expect(failed?.data).toMatchObject({ job: 'demo', errName: 'Error', errCode: 'P2010' });
    expect(JSON.stringify(logger.entries)).not.toContain('chi tiết truy vấn bí mật');
    await s.stop(1_000);
  });

  it('stop(): không bắt đầu lượt mới; chờ lượt đang chạy nhưng không quá timeout', async () => {
    const logger = new SpyLogger();
    let runs = 0;
    let finished = false;
    const long = job(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 30_000));
      finished = true;
    });
    const s = new MaintenanceScheduler([long], { logger, random: () => 0 });
    s.start();
    await vi.advanceTimersByTimeAsync(60_000); // lượt 1 đang chạy
    const stopping = s.stop(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(finished).toBe(false);
    expect(logger.messages('warn')).toContain('maintenance.stop_timeout');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runs).toBe(1);
    await s.runNow(long);
    expect(runs).toBe(1);
  });

  it('stop() khi không có lượt nào đang chạy ⇒ xong ngay, hủy timer đã hẹn', async () => {
    let runs = 0;
    const s = new MaintenanceScheduler([job(() => Promise.resolve(void (runs += 1)))], {
      logger: new SpyLogger(),
    });
    s.start();
    await s.stop(1_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runs).toBe(0);
  });
});

describe('purgeWorkspacesJob', () => {
  const deps = (purge: () => Promise<boolean>) => {
    const logger = new SpyLogger();
    return {
      logger,
      job: purgeWorkspacesJob({
        workspaces: { listPurgeable: () => Promise.resolve(['ws-1', 'ws-2']) } as never,
        purger: { purge },
        uow: new FakeUnitOfWork(),
        clock: new FakeClock(),
        logger,
        intervalMs: 3_600_000,
        jitterMs: 0,
      }),
    };
  };

  it('ghi tổng kết purged/skipped', async () => {
    const { job: j, logger } = deps(() => Promise.resolve(true));
    await j.run();
    expect(logger.entries.find((e) => e.msg === 'maintenance.purge_summary')?.data).toMatchObject({
      purged: 2,
      skipped: 0,
    });
  });

  it('instance khác đang giữ khóa lô ⇒ bỏ lượt (info), không coi là lỗi', async () => {
    const { job: j, logger } = deps(() => Promise.reject(new PurgeRunBusyError()));
    await expect(j.run()).resolves.toBeUndefined();
    expect(logger.messages('info')).toContain('maintenance.purge_skipped_busy');
  });

  it('lỗi khác ⇒ ném tiếp (scheduler log run_failed)', async () => {
    const { job: j } = deps(() => Promise.reject(new Error('db down')));
    await expect(j.run()).rejects.toThrow('db down');
  });
});

describe('maintenanceEnabled', () => {
  it('mặc định bật ở staging/production, tắt ở local/test; env ghi đè', () => {
    expect(maintenanceEnabled('production', undefined)).toBe(true);
    expect(maintenanceEnabled('staging', undefined)).toBe(true);
    expect(maintenanceEnabled('local', undefined)).toBe(false);
    expect(maintenanceEnabled('test', undefined)).toBe(false);
    expect(maintenanceEnabled('production', false)).toBe(false);
    expect(maintenanceEnabled('local', true)).toBe(true);
  });
});
