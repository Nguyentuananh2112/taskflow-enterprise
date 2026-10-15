import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import { createHttpServer, listen } from '../../server';
import { createGracefulShutdown, type GracefulShutdownOptions } from './graceful-shutdown';

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function startSlowServer(delayMs: number) {
  const app = express();
  app.get('/slow', async (_req, res) => {
    await new Promise((r) => setTimeout(r, delayMs));
    res.json({ done: true });
  });
  const server = createHttpServer(app);
  await listen(server, 0, '127.0.0.1');
  servers.push(server);
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function setup(
  server: GracefulShutdownOptions['server'],
  overrides: Partial<GracefulShutdownOptions> = {},
) {
  const logger = new SpyLogger();
  const exits: number[] = [];
  const order: string[] = [];
  const shutdown = createGracefulShutdown({
    server,
    logger,
    drainMs: 0,
    timeoutMs: 5_000,
    realtime: [{ name: 'socket.io', close: () => void order.push('realtime') }],
    resources: [
      { name: 'prisma', close: () => Promise.resolve(void order.push('prisma')) },
      { name: 'pool', close: () => void order.push('pool') },
      { name: 'valkey', close: () => void order.push('valkey') },
    ],
    exit: (code) => void exits.push(code),
    ...overrides,
  });
  return { shutdown, logger, exits, order };
}

describe('graceful shutdown (devops.md §7.3)', () => {
  it('request đang chạy vẫn hoàn tất 200; đóng realtime → HTTP → tài nguyên theo thứ tự; exit 0', async () => {
    const { server, url } = await startSlowServer(150);
    const { shutdown, exits, order, logger } = setup(server);

    const inflight = fetch(`${url}/slow`);
    await new Promise((r) => setTimeout(r, 30));
    expect(shutdown.isShuttingDown()).toBe(false);
    const done = shutdown.shutdown('SIGTERM');
    expect(shutdown.isShuttingDown()).toBe(true);

    const res = await inflight;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    await done;

    expect(order).toEqual(['realtime', 'prisma', 'pool', 'valkey']);
    expect(exits).toEqual([0]);
    expect(logger.messages('info')).toEqual(['shutdown.start', 'shutdown.complete']);
    expect(server.listening).toBe(false);
  });

  it('gọi lần 2 là no-op (cùng promise, exit một lần)', async () => {
    const { server } = await startSlowServer(0);
    const { shutdown, exits } = setup(server);
    const first = shutdown.shutdown('SIGTERM');
    expect(shutdown.shutdown('SIGINT')).toBe(first);
    await first;
    expect(exits).toEqual([0]);
  });

  it('một closer lỗi được log, các closer sau vẫn chạy', async () => {
    const { server } = await startSlowServer(0);
    const { shutdown, logger, order } = setup(server, {
      resources: [
        { name: 'prisma', close: () => Promise.reject(new Error('already closed')) },
        { name: 'valkey', close: () => void order.push('valkey') },
      ],
    });
    await shutdown.shutdown('SIGTERM');
    expect(order).toEqual(['realtime', 'valkey']);
    expect(logger.entries.find((e) => e.msg === 'shutdown.close_failed')?.data).toMatchObject({
      closer: 'prisma',
    });
  });

  it('quá SHUTDOWN_TIMEOUT_MS ⇒ log shutdown.forced và exit 1', async () => {
    const { server } = await startSlowServer(0);
    const { shutdown, exits, logger } = setup(server, {
      timeoutMs: 30,
      resources: [{ name: 'stuck', close: () => new Promise(() => undefined) }],
    });
    void shutdown.shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 80));
    expect(exits).toEqual([1]);
    expect(logger.messages('error')).toContain('shutdown.forced');
  });

  it('chờ drainMs trước khi đóng HTTP (để LB rút instance)', async () => {
    const { server } = await startSlowServer(0);
    const { shutdown } = setup(server, { drainMs: 60 });
    const startedAt = Date.now();
    void shutdown.shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 20));
    expect(server.listening).toBe(true);
    await shutdown.shutdown('SIGTERM');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(55);
    expect(server.listening).toBe(false);
  });
});

describe('installProcessHandlers', () => {
  const fakeProcess = () => new EventEmitter() as unknown as NodeJS.Process;

  it.each([
    ['SIGTERM', 0],
    ['SIGINT', 0],
  ])('%s ⇒ shutdown, exit %i', async (signal, code) => {
    const { server } = await startSlowServer(0);
    const { shutdown, exits } = setup(server);
    const proc = fakeProcess();
    shutdown.installProcessHandlers(proc);
    proc.emit(signal);
    await shutdown.shutdown('again');
    expect(exits).toEqual([code]);
  });

  it.each([
    ['unhandledRejection', 'process.unhandled_rejection'],
    ['uncaughtException', 'process.uncaught_exception'],
  ])('%s ⇒ log fatal, exit 1', async (event, msg) => {
    const { server } = await startSlowServer(0);
    const { shutdown, exits, logger } = setup(server);
    const proc = fakeProcess();
    shutdown.installProcessHandlers(proc);
    proc.emit(event, new Error('bug'));
    await shutdown.shutdown('again');
    expect(logger.messages('fatal')).toEqual([msg]);
    expect(exits).toEqual([1]);
  });
});

describe('createHttpServer / listen', () => {
  it('keepAliveTimeout > idle LB 60s; listen báo lỗi khi cổng bận', async () => {
    const { server } = await startSlowServer(0);
    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    const port = (server.address() as AddressInfo).port;
    const second = createHttpServer(express());
    await expect(listen(second, port, '127.0.0.1')).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
