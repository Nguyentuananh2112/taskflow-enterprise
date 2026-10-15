import { appConfigFromEnv, createApp } from './app';
import { EnvValidationError, loadEnv, type Env } from './config/env';
import { ServiceUnavailableError } from './core/errors';
import { databaseProbe, valkeyProbe } from './core/http/health';
import {
  createGlobalRateLimit,
  createHitLimiter,
  type RateLimitDeps,
} from './core/http/rate-limit/rate-limit';
import { RATE_LIMIT_RULES } from './core/http/rate-limit/rules';
import { createValkeyStore } from './core/http/rate-limit/store';
import { configureZodLocale } from './core/http/zod';
import { SystemClock, UuidV7Generator } from './core/infrastructure/system';
import { connectInBackground, createValkeyClient } from './core/infrastructure/valkey';
import { createGracefulShutdown, type GracefulShutdown } from './core/lifecycle/graceful-shutdown';
import { createLogger } from './core/logging/pino-logger';
import { createPgPool } from './core/persistence/database';
import { RealtimeGateway } from './core/realtime/gateway';
import { createValkeyAdapter } from './core/realtime/redis-adapter';
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
  configureZodLocale();
  const logger = createLogger({ level: env.LOG_LEVEL, gitSha: env.GIT_SHA, appEnv: env.APP_ENV });

  const pool = createPgPool(
    { connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX },
    logger,
  );
  // TODO(T-010 merge): const prisma = createPrismaClient(PrismaClient, pool);
  //   const uow = new PrismaUnitOfWork<Prisma.TransactionClient>(prisma, logger, { timeout: 10_000 });
  //   và đóng `prisma.$disconnect()` TRƯỚC `pool.end()` trong `resources` bên dưới.
  const valkey = createValkeyClient(env.REDIS_URL, logger);
  connectInBackground(valkey, logger);

  // app cần biết trạng thái shutdown, nhưng lifecycle cần server (tạo từ app) ⇒ tham chiếu trễ.
  const lifecycleRef: { current?: GracefulShutdown } = {};
  const clock = new SystemClock();
  const rateLimitDeps: RateLimitDeps = {
    storeFor: (rule) => createValkeyStore(valkey, rule),
    logger,
    userIdOf: (req) => (req as { user?: { id: string } }).user?.id,
  };
  const app = createApp({
    config: appConfigFromEnv(env),
    logger,
    clock,
    rateLimit: [createGlobalRateLimit(RATE_LIMIT_RULES.anonymous[0], rateLimitDeps)],
    probes: [databaseProbe(pool), valkeyProbe(valkey)],
    isShuttingDown: () => lifecycleRef.current?.isShuttingDown() ?? false,
  });

  const server = createHttpServer(app);
  const adapter = env.SOCKET_REDIS_ADAPTER ? await createValkeyAdapter(valkey, logger) : undefined;
  // TODO(Phase 3, B): thay 2 port tạm bằng AccessTokenAuthenticator (auth) và
  //   IProjectAccessChecker (Workspace) khi có repository Prisma — đến lúc đó socket từ chối mọi kết nối.
  const notWired = () => Promise.reject(new ServiceUnavailableError());
  const gateway = new RealtimeGateway(server, {
    corsOrigins: env.CORS_ORIGINS,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    authenticator: { authenticate: notWired },
    accessChecker: { canAccessProject: notWired },
    handshakeLimiter: createHitLimiter(RATE_LIMIT_RULES.socketHandshake[0], rateLimitDeps),
    logger,
    clock,
    ids: new UuidV7Generator(),
    ...(adapter ? { adapter: adapter.adapter } : {}),
  });
  const lifecycle = createGracefulShutdown({
    server,
    logger,
    drainMs: env.READINESS_DRAIN_MS,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    realtime: [{ name: 'socket.io', close: () => gateway.close() }],
    resources: [
      ...(adapter ? [{ name: 'socket.io-adapter', close: () => adapter.close() }] : []),
      { name: 'db-pool', close: () => pool.end() },
      { name: 'valkey', close: () => (valkey.isOpen ? valkey.close() : undefined) },
    ],
  });
  lifecycleRef.current = lifecycle;
  lifecycle.installProcessHandlers();

  await listen(server, env.PORT);
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'api.listening');
}

main().catch((err: unknown) => {
  console.error('[api] khởi động thất bại', err);
  process.exit(1);
});
