// Test bổ sung theo mutation testing của QA F (docs/reviews/T-017-findings.md §B.3, core/runtime).
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpyLogger } from '../../test/support';
import { InProcessEventBus } from './events/event-bus';
import {
  connectInBackground,
  createValkeyClient,
  valkeyReconnectDelay,
} from './infrastructure/valkey';
import { createGracefulShutdown } from './lifecycle/graceful-shutdown';

afterEach(() => vi.useRealTimers());

function shutdownWithFakeProcess() {
  const server = createServer();
  const logger = new SpyLogger();
  const exits: number[] = [];
  let resourceCloses = 0;
  const lifecycle = createGracefulShutdown({
    server,
    logger,
    drainMs: 0,
    timeoutMs: 5_000,
    resources: [{ name: 'r', close: () => void resourceCloses++ }],
    exit: (code) => void exits.push(code),
  });
  const proc = new EventEmitter();
  lifecycle.installProcessHandlers(proc as unknown as NodeJS.Process);
  return { lifecycle, proc, logger, exits, closes: () => resourceCloses };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('tín hiệu tiến trình (P1, graceful-shutdown.ts:83-84 — đường rolling deploy ADR-000)', () => {
  it.each(['SIGTERM', 'SIGINT'])('%s ⇒ shutdown, exit 0; handler tự gỡ (once)', async (signal) => {
    const { lifecycle, proc, exits } = shutdownWithFakeProcess();
    expect(proc.listenerCount(signal)).toBe(1);
    proc.emit(signal);
    expect(lifecycle.isShuttingDown()).toBe(true);
    await settle();
    expect(exits).toEqual([0]);
    expect(proc.listenerCount(signal)).toBe(0);
  });

  it('SIGTERM rồi SIGINT ⇒ trình tự tắt chỉ chạy MỘT lần', async () => {
    const { proc, exits, closes } = shutdownWithFakeProcess();
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await settle();
    expect(exits).toEqual([0]);
    expect(closes()).toBe(1);
  });

  it.each([
    ['uncaughtException', 'process.uncaught_exception'],
    ['unhandledRejection', 'process.unhandled_rejection'],
  ])('%s ⇒ log fatal KÈM lỗi gốc, exit 1 (P2, :87,:91)', async (event, msg) => {
    const { proc, logger, exits } = shutdownWithFakeProcess();
    proc.emit(event, new Error('x'));
    await settle();
    const entry = logger.entries.find((e) => e.msg === msg);
    expect((entry?.data['err'] as Error | undefined)?.message).toBe('x');
    expect(exits).toEqual([1]);
  });
});

describe('Valkey client (P2/P3, valkey.ts)', () => {
  it('backoff reconnect: 0→100ms, 3→800ms, 10→5000ms (trần)', () => {
    expect([0, 1, 3, 5, 6, 10].map(valkeyReconnectDelay)).toEqual([
      100, 200, 800, 3_200, 5_000, 5_000,
    ]);
  });

  it('disableOfflineQueue: đang reconnect thì lệnh bị từ chối NGAY, không xếp hàng chờ (rate limit fail-open/closed dựa vào đây)', async () => {
    const client = createValkeyClient('redis://127.0.0.1:1', new SpyLogger());
    connectInBackground(client, new SpyLogger());
    await new Promise((r) => setTimeout(r, 30)); // đang ở vòng reconnect (isOpen = true, chưa ready)
    const started = Date.now();
    await expect(client.ping()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(100);
    client.destroy();
  });

  it('chống spam log: lỗi tại t=0 và t=29 999ms ⇒ 1 log; t=30 000ms ⇒ log thứ hai', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const logger = new SpyLogger();
    const client = createValkeyClient('redis://127.0.0.1:1', logger);
    client.emit('error', new Error('e'));
    vi.setSystemTime(1_000_000 + 29_999);
    client.emit('error', new Error('e'));
    expect(logger.messages('warn')).toHaveLength(1);
    vi.setSystemTime(1_000_000 + 30_000);
    client.emit('error', new Error('e'));
    expect(logger.messages('warn')).toHaveLength(2);
  });
});

describe('event bus (P3)', () => {
  it('publish event chưa có subscriber ⇒ không ném, không log lỗi', async () => {
    const logger = new SpyLogger();
    const bus = new InProcessEventBus(logger);
    await expect(
      bus.publish([{ type: 'Nobody', aggregateId: 'a', occurredAt: new Date() }]),
    ).resolves.toBeUndefined();
    expect(logger.entries).toEqual([]);
  });
});
