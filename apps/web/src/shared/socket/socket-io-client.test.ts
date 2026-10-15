import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSocketIoClient, type SocketAuthHooks } from './socket-io-client';

// Adapter socket.io (frontend.md §3.5, security.md §5): socket.io-client được giả lập ở mức module
// để kiểm cấu hình handshake và các nhánh xác thực mà không cần server thật.

type Listener = (...args: unknown[]) => void;

const fake = vi.hoisted(() => {
  const state = {
    url: '',
    options: {} as Record<string, unknown>,
    listeners: new Map<string, Listener[]>(),
    connectCalls: 0,
    connected: false,
    active: false,
    emitted: [] as Array<{ event: string; payload: unknown }>,
  };
  const socket = {
    get connected() {
      return state.connected;
    },
    get active() {
      return state.active;
    },
    on(event: string, listener: Listener) {
      state.listeners.set(event, [...(state.listeners.get(event) ?? []), listener]);
      return socket;
    },
    off: () => socket,
    connect() {
      state.connectCalls += 1;
      state.active = true;
      return socket;
    },
    disconnect() {
      state.connected = false;
      state.active = false;
      return socket;
    },
    timeout: () => ({
      emitWithAck: (event: string, payload: unknown) => {
        state.emitted.push({ event, payload });
        return Promise.resolve({ ok: true });
      },
    }),
  };
  const fire = (event: string, ...args: unknown[]) =>
    state.listeners.get(event)?.forEach((l) => l(...args));
  return { state, socket, fire };
});

vi.mock('socket.io-client', () => ({
  io: (url: string, options: Record<string, unknown>) => {
    fake.state.url = url;
    fake.state.options = options;
    return fake.socket;
  },
}));

const CLIENT_ID = '0199e5a2-0000-7000-8000-00000000c1e1';

function setup(overrides: Partial<SocketAuthHooks> = {}, random = () => 0) {
  const auth: SocketAuthHooks = {
    token: vi.fn(() => 'access-1'),
    renew: vi.fn(() => Promise.resolve(true)),
    revoked: vi.fn(),
    ...overrides,
  };
  const client = createSocketIoClient({
    url: 'https://api.example.com',
    clientId: CLIENT_ID,
    auth,
    random,
  });
  return { client, auth };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fake.state.listeners.clear();
  fake.state.connectCalls = 0;
  fake.state.connected = false;
  fake.state.active = false;
  fake.state.emitted = [];
});

describe('createSocketIoClient', () => {
  it('chỉ websocket, không autoConnect, không cookie; token + clientId trong auth callback (không query string)', () => {
    const { auth } = setup();
    expect(fake.state.url).toBe('https://api.example.com');
    expect(fake.state.options).toMatchObject({
      transports: ['websocket'],
      autoConnect: false,
      withCredentials: false,
    });
    const cb = vi.fn();
    (fake.state.options.auth as (cb: (data: unknown) => void) => void)(cb);
    expect(cb).toHaveBeenCalledWith({ token: 'access-1', clientId: CLIENT_ID });
    expect(auth.token).toHaveBeenCalled();
    expect(JSON.stringify(fake.state.options)).not.toContain('query');
  });

  it('extraHeaders chỉ khi truyền (test Node với API thật); app không truyền', () => {
    setup();
    expect(fake.state.options).not.toHaveProperty('extraHeaders');
    createSocketIoClient({
      url: 'https://api.example.com',
      clientId: CLIENT_ID,
      auth: { token: () => null, renew: () => Promise.resolve(false), revoked: () => undefined },
      extraHeaders: { origin: 'http://localhost:3001' },
    });
    expect(fake.state.options.extraHeaders).toEqual({ origin: 'http://localhost:3001' });
  });

  it('connect lần 2 trở đi ⇒ báo reconnect (để join lại phòng + refetch)', () => {
    const { client } = setup();
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);
    client.connect();
    fake.fire('connect');
    expect(client.status()).toBe('connected');
    expect(onReconnect).not.toHaveBeenCalled();
    fake.fire('disconnect', 'transport close');
    expect(client.status()).toBe('reconnecting');
    fake.fire('connect');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('connect_error TOKEN_EXPIRED ⇒ refresh rồi connect lại', async () => {
    const { client, auth } = setup();
    client.connect();
    fake.fire('connect_error', Object.assign(new Error('x'), { data: { code: 'TOKEN_EXPIRED' } }));
    await flush();
    expect(auth.renew).toHaveBeenCalledTimes(1);
    expect(fake.state.connectCalls).toBe(2);
  });

  it('connect_error UNAUTHORIZED ⇒ kết thúc phiên, không thử lại', () => {
    const { client, auth } = setup();
    client.connect();
    fake.fire('connect_error', Object.assign(new Error('x'), { data: { code: 'UNAUTHORIZED' } }));
    expect(auth.revoked).toHaveBeenCalled();
    expect(client.status()).toBe('offline');
  });

  it('lỗi transport / Origin bị từ chối (không có data.code) ⇒ KHÔNG kết thúc phiên', () => {
    const { client, auth } = setup();
    client.connect();
    fake.fire('connect_error', new Error('websocket error'));
    expect(auth.revoked).not.toHaveBeenCalled();
    expect(auth.renew).not.toHaveBeenCalled();
    expect(client.status()).toBe('reconnecting');
  });

  it('auth:expired ⇒ refresh; server ngắt ⇒ refresh rồi tự connect lại', async () => {
    const { client, auth } = setup();
    client.connect();
    fake.fire('connect');
    fake.fire('auth:expired', {});
    expect(auth.renew).toHaveBeenCalledTimes(1);
    fake.fire('disconnect', 'io server disconnect');
    await flush();
    expect(auth.renew).toHaveBeenCalledTimes(2);
    expect(fake.state.connectCalls).toBe(2);
  });

  it('refresh thất bại khi server ngắt ⇒ offline, không vòng lặp connect', async () => {
    const { client } = setup({ renew: vi.fn(() => Promise.resolve(false)) });
    client.connect();
    fake.fire('connect');
    fake.fire('disconnect', 'io server disconnect');
    await flush();
    expect(fake.state.connectCalls).toBe(1);
    expect(client.status()).toBe('offline');
  });

  describe('nối lại sau khi server ngắt: jitter + backoff (review B, L3)', () => {
    afterEach(() => vi.useRealTimers());

    it('chờ random × min(30s, 2s × 2^n) rồi mới refresh; n tăng khi chưa nối lại được, trần 30s', async () => {
      vi.useFakeTimers();
      const { client, auth } = setup({}, () => 1);
      client.connect();
      fake.fire('connect');
      const waits: number[] = [];
      for (let i = 0; i < 6; i++) {
        const before = vi.mocked(auth.renew).mock.calls.length;
        fake.fire('disconnect', 'io server disconnect');
        let waited = 0;
        while (vi.mocked(auth.renew).mock.calls.length === before && waited < 60_000) {
          await vi.advanceTimersByTimeAsync(1_000);
          waited += 1_000;
        }
        waits.push(waited);
      }
      expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    });

    it('nối lại thành công ⇒ backoff về lại 2s', async () => {
      vi.useFakeTimers();
      const { client, auth } = setup({}, () => 1);
      client.connect();
      fake.fire('connect');
      fake.fire('disconnect', 'io server disconnect');
      await vi.advanceTimersByTimeAsync(2_000);
      fake.fire(
        'connect_error',
        Object.assign(new Error('x'), { data: { code: 'TOKEN_EXPIRED' } }),
      );
      await vi.advanceTimersByTimeAsync(4_000);
      expect(auth.renew).toHaveBeenCalledTimes(2);
      fake.fire('connect');
      fake.fire('disconnect', 'io server disconnect');
      await vi.advanceTimersByTimeAsync(1_999);
      expect(auth.renew).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(auth.renew).toHaveBeenCalledTimes(3);
    });

    it('client tự disconnect (đăng xuất) khi đang chờ ⇒ hủy, không refresh/connect', async () => {
      vi.useFakeTimers();
      const { client, auth } = setup({}, () => 1);
      client.connect();
      fake.fire('connect');
      fake.fire('disconnect', 'io server disconnect');
      client.disconnect();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(auth.renew).not.toHaveBeenCalled();
      expect(fake.state.connectCalls).toBe(1);
    });
  });

  it('project:join / auth:renew gửi qua emitWithAck với payload contracts', async () => {
    const { client } = setup();
    await client.joinProject({ workspaceId: 'w', projectId: 'p' });
    await client.renewAuth('access-2');
    expect(fake.state.emitted).toEqual([
      { event: 'project:join', payload: { workspaceId: 'w', projectId: 'p' } },
      { event: 'auth:renew', payload: { token: 'access-2' } },
    ]);
  });
});
