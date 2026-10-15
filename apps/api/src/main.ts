import { applyVietnameseZodLocale } from '@taskflow/contracts';

import { appConfigFromEnv } from './app';
import { createContainer } from './composition/container';
import {
  assertPersistenceAllowed,
  createMemoryPersistence,
  createPrismaPersistence,
} from './composition/persistence';
import {
  MaintenanceScheduler,
  maintenanceEnabled,
  purgeWorkspacesJob,
} from './composition/maintenance-jobs';
import { EnvValidationError, loadEnv, type Env } from './config/env';
import { databaseProbe, valkeyProbe } from './core/http/health';
import { createHitLimiter } from './core/http/rate-limit/rate-limit';
import { RATE_LIMIT_RULES } from './core/http/rate-limit/rules';
import { createValkeyStore } from './core/http/rate-limit/store';
import { CryptoRandom, SystemClock, UuidV7Generator } from './core/infrastructure/system';
import { connectInBackground, createValkeyClient } from './core/infrastructure/valkey';
import { createGracefulShutdown, type GracefulShutdown } from './core/lifecycle/graceful-shutdown';
import { createLogger } from './core/logging/pino-logger';
import { createPgPool, createPrismaClient } from './core/persistence/database';
import { RealtimeGateway } from './core/realtime/gateway';
import { PrismaClient } from './generated/prisma/client';
import { socketAuthenticatorFrom } from './core/realtime/ports';
import { createValkeyAdapter } from './core/realtime/redis-adapter';
import { PasswordPolicy } from './modules/auth/domain/password-policy';
import { Argon2idPasswordHasher } from './modules/auth/infrastructure/security/argon2id-password-hasher';
import { loadCommonPasswordList } from './modules/auth/infrastructure/security/common-password-list';
import { createHttpServer, listen } from './server';

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (!(err instanceof EnvValidationError)) throw err;
    // Chỉ in tên biến — không in giá trị (devops.md §2.4).
    console.error(`[api] ${err.message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const env = readEnvOrExit();
  applyVietnameseZodLocale();
  const logger = createLogger({ level: env.LOG_LEVEL, gitSha: env.GIT_SHA, appEnv: env.APP_ENV });

  const pool = createPgPool(
    { connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX },
    logger,
  );
  const valkey = createValkeyClient(env.REDIS_URL, logger);
  connectInBackground(valkey, logger);

  // T-020: Prisma + Valkey mặc định (DATABASE_URL luôn bắt buộc). `PERSISTENCE=memory` chỉ local/test.
  const prisma = env.PERSISTENCE === 'prisma' ? createPrismaClient(PrismaClient, pool) : undefined;
  const persistence = prisma
    ? createPrismaPersistence({ prisma, valkey, logger })
    : createMemoryPersistence(logger);
  // Staging/production: bất kỳ module nào chạy bộ nhớ ⇒ ném (từ chối khởi động) — quyết định T-020.
  const inMemoryModules = assertPersistenceAllowed(env.APP_ENV, persistence.modules);
  if (inMemoryModules.length > 0) {
    logger.warn({ modules: inMemoryModules }, 'persistence.in_memory_data_lost_on_restart');
  }

  const clock = new SystemClock();
  const ids = new UuidV7Generator();
  const lifecycleRef: { current?: GracefulShutdown } = {};
  const rateLimitStore = (rule: Parameters<typeof createValkeyStore>[1]) =>
    createValkeyStore(valkey, rule);
  const container = createContainer({
    config: {
      ...appConfigFromEnv(env),
      cookieSecure: env.COOKIE_SECURE,
      jwtSecret: env.JWT_ACCESS_SECRET,
      jwtPreviousSecret: env.JWT_ACCESS_SECRET_PREVIOUS,
    },
    logger,
    clock,
    ids,
    random: new CryptoRandom(),
    hasher: await Argon2idPasswordHasher.create(),
    policy: new PasswordPolicy(loadCommonPasswordList()),
    persistence,
    rateLimitStore,
    probes: [databaseProbe(pool), valkeyProbe(valkey)],
    isShuttingDown: () => lifecycleRef.current?.isShuttingDown() ?? false,
  });

  const server = createHttpServer(container.app);
  const adapter = env.SOCKET_REDIS_ADAPTER ? await createValkeyAdapter(valkey, logger) : undefined;
  const gateway = new RealtimeGateway(server, {
    corsOrigins: env.CORS_ORIGINS,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    authenticator: socketAuthenticatorFrom(container.auth.authenticator),
    accessChecker: container.workspace.accessChecker,
    handshakeLimiter: createHitLimiter(RATE_LIMIT_RULES.socketHandshake[0], {
      storeFor: rateLimitStore,
      logger,
    }),
    logger,
    clock,
    ids,
    ...(adapter ? { adapter: adapter.adapter } : {}),
  });
  container.realtime.bind(gateway);

  // Job bảo trì (T-033, ADR-095): purge workspace hết ân hạn mỗi giờ, khóa advisory theo lô.
  const maintenance =
    maintenanceEnabled(env.APP_ENV, env.MAINTENANCE_JOBS_ENABLED) && persistence.workspacePurger
      ? new MaintenanceScheduler(
          [
            purgeWorkspacesJob({
              workspaces: persistence.workspace.workspaces,
              purger: persistence.workspacePurger,
              uow: persistence.uow,
              clock,
              logger,
              intervalMs: env.PURGE_INTERVAL_MS,
              jitterMs: env.PURGE_JITTER_MS,
            }),
          ],
          { logger },
        )
      : undefined;

  const lifecycle = createGracefulShutdown({
    server,
    logger,
    drainMs: env.READINESS_DRAIN_MS,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    realtime: [{ name: 'socket.io', close: () => gateway.close() }],
    resources: [
      // Dừng job TRƯỚC Prisma/pool: không mở lượt mới, chờ lượt đang chạy (≤ một nửa ngân sách).
      ...(maintenance
        ? [{ name: 'maintenance-jobs', close: () => maintenance.stop(env.SHUTDOWN_TIMEOUT_MS / 2) }]
        : []),
      ...(adapter ? [{ name: 'socket.io-adapter', close: () => adapter.close() }] : []),
      // Prisma ngắt TRƯỚC pool (adapter không tự đóng pool ngoài — core/persistence/database.ts).
      ...(prisma ? [{ name: 'prisma', close: () => prisma.$disconnect() }] : []),
      { name: 'db-pool', close: () => pool.end() },
      { name: 'valkey', close: () => (valkey.isOpen ? valkey.close() : undefined) },
    ],
  });
  lifecycleRef.current = lifecycle;
  lifecycle.installProcessHandlers();

  await listen(server, env.PORT);
  maintenance?.start();
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'api.listening');
}

main().catch((err: unknown) => {
  console.error('[api] khởi động thất bại', err);
  process.exit(1);
});
