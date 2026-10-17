import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../logging/logger';
import {
  FileSweepRegistry,
  FILES_SWEEP_FIRST_RUN_AFTER_MS,
  FILES_SWEEP_INTERVAL_MS,
  FilesSweepIncompleteError,
  filesSweepJob,
} from './files-sweep';
import { LocalFileStore } from './infrastructure/local-file-store';

const logger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }) as unknown as ILogger;

let root: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-sweep-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('files-sweep (ADR-141, mẫu T-033)', () => {
  it('bước tmp: chỉ xóa tệp tạm cũ hơn 1 giờ (lưới an toàn); log tổng kết chỉ số đếm', async () => {
    const store = await LocalFileStore.create(root);
    const tmp = path.join(root, 'tmp');
    await fsp.writeFile(path.join(tmp, 'old'), 'x');
    await fsp.writeFile(path.join(tmp, 'fresh'), 'x');
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);
    await fsp.utimes(path.join(tmp, 'old'), twoHoursAgo, twoHoursAgo);
    const log = logger();
    await filesSweepJob({
      store,
      registry: new FileSweepRegistry(),
      clock: { now: () => now },
      logger: log,
    }).run();
    expect(await fsp.readdir(tmp)).toEqual(['fresh']);
    expect(log.info).toHaveBeenCalledWith(
      { removed: { tmp: 1 }, failed: [], aborted: false },
      'files.sweep_summary',
    );
  });

  it('bước module đăng ký chạy theo thứ tự, nhận `now`; một bước lỗi không chặn bước sau nhưng lượt tính thất bại', async () => {
    const order: string[] = [];
    const registry = new FileSweepRegistry();
    registry.register({
      name: 'orphan-uploads',
      run: () => (order.push('a'), Promise.reject(new Error('db'))),
    });
    registry.register({
      name: 'avatars-left',
      run: ({ now }) => (order.push(now.toISOString()), Promise.resolve(3)),
    });
    const now = new Date('2026-10-18T08:00:00.000Z');
    const log = logger();
    const job = filesSweepJob({
      store: { purgeStaleTemp: () => Promise.resolve(0) },
      registry,
      clock: { now: () => now },
      logger: log,
    });
    await expect(job.run()).rejects.toBeInstanceOf(FilesSweepIncompleteError);
    expect(order).toEqual(['a', now.toISOString()]);
    expect(log.info).toHaveBeenCalledWith(
      { removed: { tmp: 0, 'avatars-left': 3 }, failed: ['orphan-uploads'], aborted: false },
      'files.sweep_summary',
    );
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('db"'); // không ghi message lỗi
  });

  it('signal đã hủy (graceful shutdown) ⇒ dừng giữa các bước', async () => {
    const ran = vi.fn(() => Promise.resolve(1));
    const registry = new FileSweepRegistry();
    registry.register({ name: 'x', run: ran });
    const controller = new AbortController();
    controller.abort();
    await filesSweepJob({
      store: { purgeStaleTemp: () => Promise.resolve(0) },
      registry,
      clock: { now: () => new Date() },
      logger: logger(),
    }).run(controller.signal);
    expect(ran).not.toHaveBeenCalled();
  });

  it('đăng ký trùng tên ⇒ ném', () => {
    const registry = new FileSweepRegistry();
    registry.register({ name: 'x', run: () => Promise.resolve(0) });
    expect(() => registry.register({ name: 'x', run: () => Promise.resolve(0) })).toThrow();
  });

  it('lịch: mặc định mỗi giờ + jitter, lượt đầu sau 60 s; FILES_SWEEP_INTERVAL_MS (test) ⇒ không jitter', () => {
    const base = {
      store: { purgeStaleTemp: () => Promise.resolve(0) },
      registry: new FileSweepRegistry(),
      clock: { now: () => new Date() },
      logger: logger(),
    };
    expect(filesSweepJob(base)).toMatchObject({
      name: 'files-sweep',
      intervalMs: FILES_SWEEP_INTERVAL_MS,
      firstRunAfterMs: FILES_SWEEP_FIRST_RUN_AFTER_MS,
    });
    expect(filesSweepJob({ ...base, intervalMs: 1_000 })).toMatchObject({
      intervalMs: 1_000,
      jitterMs: 0,
      firstRunAfterMs: 1_000,
    });
  });
});
