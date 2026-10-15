import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import type { ILogger } from '../logging/logger';

export interface PgPoolOptions {
  connectionString: string;
  max: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

/**
 * Pool `pg` dùng chung cho Prisma (qua driver adapter) và readiness probe (devops.md §4.5).
 * `pg` không có connection timeout mặc định ⇒ luôn đặt `connectionTimeoutMillis`.
 * Lỗi của client nhàn rỗi phải có listener, nếu không tiến trình sẽ crash.
 */
export function createPgPool(options: PgPoolOptions, logger: ILogger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    application_name: 'taskflow-api',
  });
  pool.on('error', (err) => logger.error({ err }, 'db.pool_idle_client_error'));
  return pool;
}

/** Hàm tạo của PrismaClient sinh ra (`src/generated/prisma/client`) — tiêm từ composition root. */
export type PrismaClientConstructor<TClient> = new (options: { adapter: PrismaPg }) => TClient;

/**
 * Tạo PrismaClient (Prisma 7: driver adapter bắt buộc) trên pool sẵn có.
 * Adapter KHÔNG tự đóng pool ngoài (`disposeExternalPool` mặc định false) ⇒ khi shutdown:
 * `prisma.$disconnect()` rồi mới `pool.end()`.
 */
export function createPrismaClient<TClient>(
  PrismaClient: PrismaClientConstructor<TClient>,
  pool: pg.Pool,
): TClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
