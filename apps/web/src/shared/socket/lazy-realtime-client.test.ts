import { describe, expect, it, vi } from 'vitest';

import { FakeRealtimeHub, type FakeRealtimeClient } from '@test/fake-realtime';

import { createLazyRealtimeClient } from './lazy-realtime-client';

// T-044 S1: socket.io-client tải động — client lười phải hành xử như client thật đối với phần còn lại của app.

function deferred() {
  let resolve!: (c: FakeRealtimeClient) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<FakeRealtimeClient>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createLazyRealtimeClient', () => {
  it('chưa connect ⇒ KHÔNG tải; connect ⇒ tải đúng 1 lần, "connecting" tới khi có client thật rồi connected', async () => {
    const real = new FakeRealtimeHub().client('tab-1');
    const d = deferred();
    const load = vi.fn(() => d.promise);
    const lazy = createLazyRealtimeClient('tab-1', load);
    const seen: string[] = [];
    lazy.onStatus((s) => seen.push(s));
    expect(load).not.toHaveBeenCalled();
    expect(lazy.status()).toBe('offline');

    lazy.connect();
    lazy.connect();
    expect(load).toHaveBeenCalledTimes(1);
    expect(lazy.status()).toBe('connecting');
    d.resolve(real);
    await flush();
    expect(lazy.status()).toBe('connected');
    expect(seen[0]).toBe('connecting');
    expect(seen.at(-1)).toBe('connected');
    expect(lazy.clientId).toBe('tab-1');
  });

  it('đăng ký event TRƯỚC khi tải xong vẫn nhận event; gỡ trước khi tải ⇒ không gắn', async () => {
    const real = new FakeRealtimeHub().client('tab-1');
    const lazy = createLazyRealtimeClient('tab-1', () => Promise.resolve(real));
    const kept = vi.fn();
    const dropped = vi.fn();
    lazy.on('project:updated', kept);
    const off = lazy.on('project:updated', dropped);
    off();
    lazy.connect();
    await flush();
    const payload = { projectId: 'p1' } as never;
    real.emitServer('project:updated', payload);
    expect(kept).toHaveBeenCalledWith(payload);
    expect(dropped).not.toHaveBeenCalled();
    // Gỡ SAU khi đã gắn ⇒ gỡ khỏi client thật.
    const later = vi.fn();
    const offLater = lazy.on('project:updated', later);
    offLater();
    real.emitServer('project:updated', payload);
    expect(later).not.toHaveBeenCalled();
  });

  it('disconnect trước khi tải xong ⇒ client thật về sau KHÔNG connect (đăng xuất ngay sau đăng nhập)', async () => {
    const real = new FakeRealtimeHub().client('tab-1');
    const d = deferred();
    const lazy = createLazyRealtimeClient('tab-1', () => d.promise);
    lazy.connect();
    lazy.disconnect();
    expect(lazy.status()).toBe('offline');
    d.resolve(real);
    await flush();
    expect(real.status()).toBe('offline');
  });

  it('tải lỗi ⇒ offline, join trả SERVICE_UNAVAILABLE (không tự tải); connect lần sau thử tải lại', async () => {
    const real = new FakeRealtimeHub().client('tab-1');
    const load = vi
      .fn<() => Promise<FakeRealtimeClient>>()
      .mockRejectedValueOnce(new Error('ChunkLoadError'))
      .mockResolvedValueOnce(real);
    const lazy = createLazyRealtimeClient('tab-1', load);
    lazy.connect();
    await flush();
    expect(lazy.status()).toBe('offline');
    await expect(lazy.joinProject({ workspaceId: 'w1', projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
    });
    lazy.connect();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(lazy.status()).toBe('connected');
  });

  it('onReconnect gắn vào client thật: nối lại lần 2 ⇒ gọi listener', async () => {
    const real = new FakeRealtimeHub().client('tab-1');
    const lazy = createLazyRealtimeClient('tab-1', () => Promise.resolve(real));
    const onReconnect = vi.fn();
    lazy.onReconnect(onReconnect);
    lazy.connect();
    await flush();
    real.drop();
    real.connect();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
