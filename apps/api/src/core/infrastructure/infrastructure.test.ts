import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { integrationRequired, SpyLogger, testValkeyUrl } from '../../../test/support';
import { CryptoRandom, SystemClock, UuidV7Generator } from './system';
import {
  connectInBackground,
  createValkeyClient,
  VALKEY_PING_INTERVAL_MS,
  VALKEY_SOCKET_TIMEOUT_MS,
  type ValkeyClient,
} from './valkey';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UuidV7Generator', () => {
  it('sinh UUID v7 đúng định dạng RFC 9562, không trùng', () => {
    const gen = new UuidV7Generator();
    const ids = Array.from({ length: 1000 }, () => gen.next());
    ids.forEach((id) => expect(id).toMatch(UUID_V7));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id ở mili giây sau lớn hơn id ở mili giây trước (khóa tăng theo thời gian)', async () => {
    const gen = new UuidV7Generator();
    const first = gen.next();
    await new Promise((r) => setTimeout(r, 3));
    expect(gen.next() > first).toBe(true);
  });
});

describe('SystemClock & CryptoRandom', () => {
  it('SystemClock trả thời điểm hiện tại', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('token: base64url không padding, đúng số byte; int trong [min, max)', () => {
    const random = new CryptoRandom();
    const token = random.token(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(random.token(32)).not.toBe(token);
    for (let i = 0; i < 200; i++) {
      const n = random.int(3, 5);
      expect(n === 3 || n === 4).toBe(true);
    }
  });
});

describe('Valkey client', () => {
  it('tạo client chưa kết nối; lỗi kết nối được log tối đa 1 lần / 30s', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T08:00:00.000Z') });
    try {
      const logger = new SpyLogger();
      const client = createValkeyClient('redis://127.0.0.1:1', logger);
      expect(client.isOpen).toBe(false);

      client.emit('error', new Error('ECONNREFUSED'));
      client.emit('error', new Error('ECONNREFUSED'));
      expect(logger.messages('warn')).toEqual(['valkey.error']);

      vi.advanceTimersByTime(30_001);
      client.emit('error', new Error('ECONNREFUSED'));
      expect(logger.messages('warn')).toEqual(['valkey.error', 'valkey.error']);

      client.emit('ready');
      expect(logger.messages('info')).toEqual(['valkey.ready']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('connectInBackground không ném; thất bại được log warn', async () => {
    const logger = new SpyLogger();
    const client = { connect: () => Promise.reject(new Error('down')) } as unknown as ValkeyClient;
    connectInBackground(client, logger);
    await new Promise((r) => setTimeout(r, 0));
    expect(logger.messages('warn')).toEqual(['valkey.connect_failed']);
  });
});

describe('Valkey client: timeout khi Valkey treo (Info của T-028, T-031)', () => {
  it(`kết nối nhàn rỗi vẫn sống (PING); Valkey treo ⇒ lệnh lỗi trong ~${VALKEY_SOCKET_TIMEOUT_MS}ms rồi tự phục hồi`, async (ctx) => {
    const target = new URL(testValkeyUrl());
    const probe = connect(Number(target.port || 6379), target.hostname);
    const up = await new Promise<boolean>((resolve) => {
      probe.once('connect', () => resolve(true));
      probe.once('error', () => resolve(false));
    });
    probe.destroy();
    if (!up) {
      if (integrationRequired()) throw new Error(`Valkey không chạy ở ${target.host}`);
      ctx.skip();
    }
    // Proxy tới Valkey thật; `mute` ⇒ nuốt mọi lệnh tiếp theo (Valkey "treo" nhưng TCP vẫn sống).
    let mute = false;
    const open: Socket[] = [];
    const server = createServer((client) => {
      const upstream = connect(Number(target.port || 6379), target.hostname);
      open.push(client, upstream);
      client.on('data', (chunk) => {
        if (!mute) upstream.write(chunk);
      });
      upstream.pipe(client);
      for (const s of [client, upstream]) s.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = new URL(target);
    url.hostname = '127.0.0.1';
    url.port = String((server.address() as AddressInfo).port);
    const client = createValkeyClient(url.toString(), new SpyLogger());
    try {
      await client.connect();
      expect(await client.ping()).toBe('PONG');
      // Nhàn rỗi lâu hơn socketTimeout: PING định kỳ giữ kết nối, không bị coi là treo.
      await new Promise((r) => setTimeout(r, VALKEY_SOCKET_TIMEOUT_MS + VALKEY_PING_INTERVAL_MS));
      expect(client.isReady).toBe(true);
      mute = true;
      const started = Date.now();
      await expect(client.ping()).rejects.toThrow(/timeout/i);
      expect(Date.now() - started).toBeLessThan(VALKEY_SOCKET_TIMEOUT_MS + 1_000);
      mute = false;
      const deadline = Date.now() + 5_000;
      while (!client.isReady && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(await client.ping()).toBe('PONG');
    } finally {
      client.destroy();
      open.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
