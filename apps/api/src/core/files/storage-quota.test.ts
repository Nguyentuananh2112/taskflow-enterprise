import { describe, expect, it, vi } from 'vitest';

import { StorageFullError } from '../errors';
import { MediaResolverRegistry } from './media-resolver-registry';
import { StorageQuota } from './storage-quota';
import type { FileKey } from './domain/file-key';

describe('StorageQuota — STORAGE_FULL (ADR-141, SEC-CH-14)', () => {
  it('đo + cộng ngay sau commit; vượt trần ⇒ 507', async () => {
    const quota = new StorageQuota(
      () => Promise.resolve(900),
      1_000,
      60_000,
      () => 0,
    );
    await quota.ensure(100);
    quota.add(50);
    expect(await quota.usedBytes()).toBe(950);
    await expect(quota.ensure(51)).rejects.toBeInstanceOf(StorageFullError);
    expect(await quota.ratio()).toBeCloseTo(0.95);
  });

  it('đo lại khi quá cacheMs (đối soát — phần cộng bị thay bằng số đo mới); đo đồng thời chỉ một lần', async () => {
    let now = 0;
    let disk = 100;
    const measure = vi.fn(() => Promise.resolve(disk));
    const quota = new StorageQuota(measure, 1_000, 60_000, () => now);
    await Promise.all([quota.usedBytes(), quota.usedBytes()]);
    expect(measure).toHaveBeenCalledTimes(1);
    quota.add(500);
    expect(await quota.usedBytes()).toBe(600);
    disk = 300; // sweep đã xóa bớt
    now = 60_000;
    expect(await quota.usedBytes()).toBe(300);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('cacheMs = 0 (test) ⇒ đo mỗi lần', async () => {
    const measure = vi.fn(() => Promise.resolve(1));
    const quota = new StorageQuota(measure, 10, 0, () => 5);
    await quota.usedBytes();
    await quota.usedBytes();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('đo lỗi ⇒ ném (fail-closed ở upload), lần sau đo lại', async () => {
    let fail = true;
    const quota = new StorageQuota(
      () => (fail ? Promise.reject(new Error('EIO')) : Promise.resolve(1)),
      10,
      60_000,
      () => 0,
    );
    await expect(quota.ensure(1)).rejects.toThrow('EIO');
    fail = false;
    await quota.ensure(1);
  });
});

describe('MediaResolverRegistry', () => {
  it('chưa đăng ký ⇒ null (fail-closed); đã đăng ký ⇒ chuyển tiếp theo kind; đăng ký trùng ⇒ ném', async () => {
    const registry = new MediaResolverRegistry();
    const target = { kind: 'avatars' as const, id: 'x', variant: '64', version: 1 };
    expect(await registry.resolve(target)).toBeNull();
    const resolve = vi.fn(() => Promise.resolve({ key: 'k' as FileKey, as: 'image' as const }));
    registry.register('avatars', { resolve });
    expect(await registry.resolve(target)).toEqual({ key: 'k', as: 'image' });
    expect(await registry.resolve({ ...target, kind: 'chat' })).toBeNull();
    expect(() => registry.register('avatars', { resolve })).toThrow();
  });
});
