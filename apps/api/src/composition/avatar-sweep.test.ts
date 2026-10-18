import { describe, expect, it, vi } from 'vitest';

import type { IFileStore } from '../core/files/ports';
import type {
  AvatarSweepState,
  IAvatarDirectory,
} from '../modules/auth/application/ports/avatar-directory.port';
import { avatarBlobs, avatarMediaResolver } from './avatar-adapters';
import { AVATAR_RETENTION_MS, avatarSweepTask, memoryAvatarDirectory } from './avatar-sweep';

const MIA = '11111111-1111-4111-8111-111111111111';
const VIC = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const clock = { now: () => NOW };

/** Kho tệp giả: khóa → mtime; chỉ `list` / `delete` / `put` / `touch` mà avatar dùng. */
function fakeStore(entries: Record<string, Date>) {
  const blobs = new Map(Object.entries(entries));
  const store = {
    async *list(prefix: string) {
      for (const [key, modifiedAt] of [...blobs]) {
        if (key.startsWith(prefix)) yield await Promise.resolve({ key, modifiedAt });
      }
    },
    delete: vi.fn((key: string) => Promise.resolve(void blobs.delete(key))),
    put: vi.fn((_d: Buffer, o: { key: string }) => Promise.resolve(void blobs.set(o.key, NOW))),
    touch: vi.fn((key: string, at: Date) =>
      Promise.resolve(void (blobs.has(key) && blobs.set(key, at))),
    ),
  };
  return {
    store: store as unknown as IFileStore,
    keys: () => [...blobs.keys()].sort(),
    spy: store,
  };
}
const both = (id: string, v: number, at: Date) => ({
  [`avatars/${id}/${v}/256`]: at,
  [`avatars/${id}/${v}/64`]: at,
});

function directory(
  states: Record<string, AvatarSweepState>,
): IAvatarDirectory & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    activeVersions: () => Promise.resolve(new Map()),
    sweepStates: (ids) =>
      Promise.resolve(new Map(ids.filter((i) => states[i]).map((i) => [i, states[i]!]))),
    clearDeparted: (ids) => (cleared.push(...ids), Promise.resolve(ids.length)),
  };
}
const run = (store: IFileStore, dir: IAvatarDirectory) =>
  avatarSweepTask({ store, directory: dir, businessClock: clock, clock }).run({ now: NOW });

describe('avatarSweepTask (D13)', () => {
  it('thành viên: giữ version hiện tại; xóa version cũ > 30 ngày; giữ version cũ còn trong hạn', async () => {
    const f = fakeStore({
      ...both(MIA, 1, ago(AVATAR_RETENTION_MS + DAY)),
      ...both(MIA, 2, ago(DAY)),
      ...both(MIA, 3, ago(AVATAR_RETENTION_MS * 2)),
    });
    const n = await run(f.store, directory({ [MIA]: { version: 3, member: true, leftAt: null } }));
    expect(n).toBe(1);
    expect(f.keys()).toEqual(Object.keys({ ...both(MIA, 2, NOW), ...both(MIA, 3, NOW) }).sort());
  });

  it('version lớn nhất còn mới (< 1 giờ giờ thật) ⇒ để yên dù ≠ version DB (lần đặt ảnh đang chạy)', async () => {
    const f = fakeStore({ ...both(MIA, 5, ago(60 * 1000)) });
    // giờ nghiệp vụ nhảy xa (FakeClock) ⇒ blob "quá 30 ngày" theo nghiệp vụ nhưng mới theo giờ thật.
    const business = { now: () => new Date(NOW.getTime() + AVATAR_RETENTION_MS * 2) };
    const dir = directory({ [MIA]: { version: 4, member: true, leftAt: null } });
    await avatarSweepTask({ store: f.store, directory: dir, businessClock: business, clock }).run({
      now: NOW,
    });
    expect(f.keys()).toHaveLength(2);
  });

  it('đã rời > 30 ngày ⇒ clearDeparted (DB) TRƯỚC rồi xóa mọi blob; rời < 30 ngày ⇒ giữ', async () => {
    const f = fakeStore({ ...both(MIA, 2, ago(DAY)), ...both(VIC, 1, ago(DAY)) });
    const order: string[] = [];
    const dir = directory({
      [MIA]: { version: 2, member: false, leftAt: ago(AVATAR_RETENTION_MS + DAY) },
      [VIC]: { version: 1, member: false, leftAt: ago(DAY) },
    });
    const clear = dir.clearDeparted.bind(dir);
    dir.clearDeparted = (ids) => (order.push('db'), clear(ids));
    const del = f.spy.delete.getMockImplementation()!;
    f.spy.delete.mockImplementation((key) => (order.push('disk'), del(key)));
    expect(await run(f.store, dir)).toBe(1);
    expect(dir.cleared).toEqual([MIA]);
    expect(order).toEqual(['db', 'disk', 'disk']);
    expect(f.keys().every((k) => k.includes(VIC))).toBe(true);
  });

  it('đã rời không có left_at ⇒ mốc = blob mới nhất', async () => {
    const f = fakeStore({ ...both(MIA, 1, ago(AVATAR_RETENTION_MS + DAY)) });
    await run(f.store, directory({ [MIA]: { version: 1, member: false, leftAt: null } }));
    expect(f.keys()).toEqual([]);
  });

  it('signal đã hủy ⇒ không xóa gì', async () => {
    const f = fakeStore({ ...both(MIA, 1, ago(AVATAR_RETENTION_MS * 2)) });
    const dir = directory({ [MIA]: { version: 2, member: true, leftAt: null } });
    const n = await avatarSweepTask({
      store: f.store,
      directory: dir,
      businessClock: clock,
      clock,
    }).run({
      now: NOW,
      signal: AbortSignal.abort(),
    });
    expect([n, f.keys().length]).toEqual([0, 2]);
  });
});

describe('memoryAvatarDirectory', () => {
  const versions = new Map([
    [MIA, 3],
    [VIC, 1],
  ]);
  const users = {
    avatarVersions: (ids: readonly string[]) =>
      Promise.resolve(new Map([...versions].filter(([id]) => ids.includes(id)))),
    setAvatarVersion: vi.fn(({ id }: { id: string }) => Promise.resolve(versions.delete(id))),
  };
  const members = { find: (id: string) => Promise.resolve(id === MIA ? {} : null) };

  it('activeVersions chỉ người còn thuộc công ty; clearDeparted chỉ người đã rời', async () => {
    const dir = memoryAvatarDirectory(users, members, clock);
    expect([...(await dir.activeVersions([MIA, VIC]))]).toEqual([[MIA, 3]]);
    expect((await dir.sweepStates([VIC])).get(VIC)).toEqual({
      version: 1,
      member: false,
      leftAt: null,
    });
    expect(await dir.clearDeparted([MIA, VIC])).toBe(1);
    expect(users.setAvatarVersion).toHaveBeenCalledWith({ id: VIC, version: null, at: NOW });
  });
});

describe('avatarBlobs / avatarMediaResolver', () => {
  it('latestVersion = version lớn nhất còn trên đĩa (0 nếu chưa có); markRemoved touch cả hai biến thể', async () => {
    const f = fakeStore({ ...both(MIA, 2, ago(DAY)), ...both(MIA, 7, ago(DAY)) });
    const blobs = avatarBlobs(f.store);
    expect([await blobs.latestVersion(MIA), await blobs.latestVersion(VIC)]).toEqual([7, 0]);
    await blobs.markRemoved(MIA, 7, NOW);
    expect(f.spy.touch).toHaveBeenCalledTimes(2);
  });

  it('resolver: version phải khớp DB + variant hợp lệ; người không còn trong directory ⇒ null', async () => {
    const dir = { ...directory({}), activeVersions: () => Promise.resolve(new Map([[MIA, 4]])) };
    const r = avatarMediaResolver(dir);
    expect(await r.resolve({ kind: 'avatars', id: MIA, variant: '64', version: 4 })).toEqual({
      key: `avatars/${MIA}/4/64`,
      as: 'image',
    });
    expect(await r.resolve({ kind: 'avatars', id: MIA, variant: '64', version: 3 })).toBeNull();
    expect(await r.resolve({ kind: 'avatars', id: MIA, variant: '512', version: 4 })).toBeNull();
    expect(await r.resolve({ kind: 'avatars', id: VIC, variant: '64', version: 4 })).toBeNull();
  });
});
