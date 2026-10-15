import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import { createPgPool, createPrismaClient } from './database';

describe('createPgPool', () => {
  it('đặt max, connectionTimeoutMillis, idleTimeout và không kết nối khi tạo (lazy)', async () => {
    const pool = createPgPool(
      { connectionString: 'postgresql://u:p@127.0.0.1:1/db', max: 7 },
      new SpyLogger(),
    );
    expect(pool.options.max).toBe(7);
    expect(pool.options.connectionTimeoutMillis).toBe(5_000);
    expect(pool.options.idleTimeoutMillis).toBe(30_000);
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it('lỗi của client nhàn rỗi được log thay vì làm crash tiến trình', async () => {
    const logger = new SpyLogger();
    const pool = createPgPool(
      { connectionString: 'postgresql://u:p@127.0.0.1:1/db', max: 1 },
      logger,
    );
    pool.emit('error', new Error('terminating connection'));
    expect(logger.messages('error')).toEqual(['db.pool_idle_client_error']);
    await pool.end();
  });
});

describe('createPrismaClient', () => {
  it('tạo client với driver adapter PrismaPg dùng chung pool (Prisma 7)', async () => {
    const pool = createPgPool(
      { connectionString: 'postgresql://u:p@127.0.0.1:1/db', max: 1 },
      new SpyLogger(),
    );
    class FakePrismaClient {
      constructor(readonly options: { adapter: PrismaPg }) {}
    }
    const client = createPrismaClient(FakePrismaClient, pool);
    expect(client).toBeInstanceOf(FakePrismaClient);
    expect(client.options.adapter).toBeInstanceOf(PrismaPg);
    await pool.end();
  });
});
