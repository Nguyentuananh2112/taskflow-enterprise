import { describe, expect, it, vi } from 'vitest';

import { UnauthorizedError, imageUnreadableError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { AfterCommitHook, IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { AvatarVariant } from '../ports/avatar.port';
import { RemoveAvatarUseCase, SetAvatarUseCase } from './avatar.use-cases';

const USER = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const NOW = new Date('2026-10-18T08:00:00.000Z');

/** UoW giả: lỗi ⇒ trả trạng thái repo về lúc bắt đầu (như rollback); hook afterCommit chạy sau khi xong. */
function setup(initial: number | null = null, exists = true) {
  let version: number | null = initial;
  const present = exists;
  let hooks: AfterCommitHook[] = [];
  let depth = 0;
  const uow: IUnitOfWork = {
    get inTransaction() {
      return depth > 0;
    },
    async run(work) {
      const saved = version;
      depth += 1;
      try {
        const out = await work();
        depth -= 1;
        if (depth === 0) {
          const run = hooks;
          hooks = [];
          for (const h of run) await h();
        }
        return out;
      } catch (err) {
        depth -= 1;
        version = saved;
        hooks = [];
        throw err;
      }
    },
    afterCommit(hook) {
      hooks.push(hook);
    },
  };
  const users = {
    lockAvatar: vi.fn(() => Promise.resolve(present ? { version } : null)),
    setAvatarVersion: vi.fn((i: { version: number | null }) => {
      version = i.version;
      return Promise.resolve(present);
    }),
  };
  const placed: [number, AvatarVariant[]][] = [];
  let onDisk = 0; // version lớn nhất còn blob
  const blobs = {
    latestVersion: vi.fn(() => Promise.resolve(onDisk)),
    setOnDisk: (v: number) => (onDisk = v),
    place: vi.fn((_u: string, v: number, variants: ReadonlyMap<AvatarVariant, Buffer>) => {
      placed.push([v, [...variants.keys()]]);
      onDisk = Math.max(onDisk, v);
      return Promise.resolve();
    }),
    discard: vi.fn(() => Promise.resolve()),
    markRemoved: vi.fn(() => Promise.resolve()),
  };
  const notifier = { avatarChanged: vi.fn(() => Promise.resolve()) };
  const images = {
    render: vi.fn(() =>
      Promise.resolve(
        new Map<AvatarVariant, Buffer>([
          ['256', Buffer.from('L')],
          ['64', Buffer.from('S')],
        ]),
      ),
    ),
  };
  const urls = {
    urlsOf: (u: string, v: number) => ({
      avatarUrl: `https://api.test/m/${u}/64?v=${v}`,
      avatarUrlLarge: `https://api.test/m/${u}/256?v=${v}`,
    }),
  };
  const logger = { warn: vi.fn() } as unknown as ILogger;
  const deps = { users, images, blobs, urls, notifier, uow, clock: { now: () => NOW }, logger };
  return { deps, users, blobs, notifier, images, placed, version: () => version };
}

const upload = {
  name: 'a.png',
  head: Buffer.alloc(0),
  sizeBytes: 1,
  readAll: () => Promise.resolve(Buffer.alloc(1)),
};

describe('SetAvatarUseCase (ADR-142)', () => {
  it('AV-01: version đơn điệu 1, 2, 3; xóa blob version cũ SAU commit; trả URL 64 + 256', async () => {
    const t = setup();
    const set = new SetAvatarUseCase(t.deps);
    for (const expected of [1, 2, 3]) {
      const urls = await set.execute({ userId: USER, upload });
      expect(t.version()).toBe(expected);
      expect(urls.avatarUrl).toContain(`/64?v=${expected}`);
      expect(urls.avatarUrlLarge).toContain(`/256?v=${expected}`);
    }
    expect(t.placed).toEqual([
      [1, ['256', '64']],
      [2, ['256', '64']],
      [3, ['256', '64']],
    ]);
    expect(t.blobs.discard.mock.calls).toEqual([
      [USER, 1],
      [USER, 2],
    ]);
  });

  it('event chỉ mang variant 64, KHÔNG avatarUrlLarge (TL)', async () => {
    const t = setup(4);
    await new SetAvatarUseCase(t.deps).execute({ userId: USER, upload });
    expect(t.notifier.avatarChanged).toHaveBeenCalledWith({
      userId: USER,
      avatarUrl: `https://api.test/m/${USER}/64?v=5`,
      actorId: USER,
    });
  });

  it('đặt blob lỗi ⇒ rollback tự trả version, không xóa blob cũ, không phát event (B M-a)', async () => {
    const t = setup(2);
    t.blobs.place.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(new SetAvatarUseCase(t.deps).execute({ userId: USER, upload })).rejects.toThrow(
      'ENOSPC',
    );
    expect(t.version()).toBe(2);
    expect(t.blobs.discard).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).not.toHaveBeenCalled();
  });

  it('rollback mà KHÔNG còn blob ⇒ version được dùng lại; còn blob mồ côi ⇒ version kế tiếp (không va khóa — B)', async () => {
    const t = setup(2);
    t.blobs.place.mockRejectedValueOnce(new Error('boom')); // lỗi trước khi ghi gì
    const set = new SetAvatarUseCase(t.deps);
    await expect(set.execute({ userId: USER, upload })).rejects.toThrow();
    await set.execute({ userId: USER, upload });
    expect(t.blobs.place.mock.calls.map(([, v]) => v)).toEqual([3, 3]);
    t.blobs.setOnDisk(9); // blob v9 mồ côi của một lần commit DB lỗi
    await set.execute({ userId: USER, upload });
    expect(t.version()).toBe(10);
  });

  it('sau khi gỡ (version NULL) ảnh mới KHÔNG dùng lại version còn giữ 30 ngày (URL không trùng ảnh cũ trong cache)', async () => {
    const t = setup(null);
    t.blobs.setOnDisk(4); // ảnh v4 đã gỡ, blob còn giữ
    await new SetAvatarUseCase(t.deps).execute({ userId: USER, upload });
    expect(t.version()).toBe(5);
  });

  it('ảnh hỏng ⇒ lỗi của bộ xử lý ảnh, KHÔNG mở transaction / không khóa dòng', async () => {
    const t = setup(1);
    t.images.render.mockRejectedValueOnce(imageUnreadableError());
    await expect(
      new SetAvatarUseCase(t.deps).execute({ userId: USER, upload }),
    ).rejects.toMatchObject({
      details: { rule: 'IMAGE_UNREADABLE' },
    });
    expect(t.users.lockAvatar).not.toHaveBeenCalled();
  });

  it('user không còn (đã xóa) ⇒ 401, không đặt blob', async () => {
    const t = setup(null, false);
    await expect(
      new SetAvatarUseCase(t.deps).execute({ userId: USER, upload }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(t.blobs.place).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).not.toHaveBeenCalled();
  });

  it('gọi lồng trong transaction khác rồi bên ngoài lỗi ⇒ KHÔNG xóa blob cũ, không event (afterCommit — B L2)', async () => {
    const t = setup(2);
    const set = new SetAvatarUseCase(t.deps);
    await expect(
      t.deps.uow.run(async () => {
        await set.execute({ userId: USER, upload });
        throw new Error('outer failed');
      }),
    ).rejects.toThrow('outer failed');
    expect(t.version()).toBe(2);
    expect(t.blobs.discard).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).not.toHaveBeenCalled();
  });

  it('bước sau commit lỗi (xóa blob cũ / phát event) không làm hỏng kết quả — chỉ log', async () => {
    const t = setup(1);
    t.blobs.discard.mockRejectedValueOnce(new Error('EBUSY'));
    t.notifier.avatarChanged.mockRejectedValueOnce(new Error('socket'));
    await expect(
      new SetAvatarUseCase(t.deps).execute({ userId: USER, upload }),
    ).resolves.toMatchObject({
      avatarUrl: expect.stringContaining('v=2') as string,
    });
    expect(t.deps.logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('RemoveAvatarUseCase', () => {
  it('gỡ ⇒ NULL, blob GIỮ (markRemoved với giờ nghiệp vụ — D13), event avatarUrl null; trả version trước', async () => {
    const t = setup(3);
    const out = await new RemoveAvatarUseCase(t.deps).execute({ userId: USER, actorId: 'hr' });
    expect(out).toEqual({ previousVersion: 3 });
    expect(t.version()).toBeNull();
    expect(t.blobs.markRemoved).toHaveBeenCalledWith(USER, 3, NOW);
    expect(t.blobs.discard).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).toHaveBeenCalledWith({
      userId: USER,
      avatarUrl: null,
      actorId: 'hr',
    });
  });

  it('không có ảnh ⇒ idempotent: null, không ghi, không event', async () => {
    const t = setup(null);
    expect(await new RemoveAvatarUseCase(t.deps).execute({ userId: USER, actorId: USER })).toEqual({
      previousVersion: null,
    });
    expect(t.users.setAvatarVersion).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).not.toHaveBeenCalled();
  });

  it('gọi TRONG transaction của bên gọi (HR + audit) ⇒ bên gọi lỗi sau đó ⇒ rollback, không markRemoved / event', async () => {
    const t = setup(2);
    const remove = new RemoveAvatarUseCase(t.deps);
    await expect(
      t.deps.uow.run(async () => {
        await remove.execute({ userId: USER, actorId: 'hr' });
        throw new Error('audit failed');
      }),
    ).rejects.toThrow('audit failed');
    expect(t.version()).toBe(2);
    expect(t.blobs.markRemoved).not.toHaveBeenCalled();
    expect(t.notifier.avatarChanged).not.toHaveBeenCalled();
  });
});
