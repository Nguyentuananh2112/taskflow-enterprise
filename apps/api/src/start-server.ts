// Phần khởi động còn lại của API — `main.ts` nạp file này bằng dynamic import SAU `Sentry.init`
// để instrumentation (http, express, pg…) móc được vào module (ESM, T-035).
import { applyVietnameseZodLocale } from '@taskflow/contracts';
import type { Logger } from 'pino';

import { appConfigFromEnv } from './app';
import { createContainer } from './composition/container';
import { assertPersistenceAllowed, createMemoryPersistence } from './composition/persistence';
import { createPrismaPersistence } from './composition/prisma-persistence';
import { MaintenanceScheduler, type ScheduledJob } from './composition/maintenance-jobs';
import { maintenanceJobs, retentionCutoffFor } from './composition/maintenance-setup';
import type { Env } from './config/env';
import { databaseProbe, valkeyProbe } from './core/http/health';
import { createHitLimiter } from './core/http/rate-limit/rate-limit';
import { RATE_LIMIT_RULES } from './core/http/rate-limit/rules';
import { createValkeyStore } from './core/http/rate-limit/store';
import { CryptoRandom, UuidV7Generator, clocksForEnv } from './core/infrastructure/system';
import { connectInBackground, createValkeyClient } from './core/infrastructure/valkey';
import { createRealtimeQuota } from './core/realtime/shared-quota';
import { createGracefulShutdown, type GracefulShutdown } from './core/lifecycle/graceful-shutdown';
import { createPgPool, createPrismaClient } from './core/persistence/database';
import { RealtimeGateway } from './core/realtime/gateway';
import { PrismaClient } from './generated/prisma/client';
import { createValkeyAdapter } from './core/realtime/redis-adapter';
import { PasswordPolicy } from './modules/auth/domain/password-policy';
import { Argon2idPasswordHasher } from './modules/auth/infrastructure/security/argon2id-password-hasher';
import { loadCommonPasswordList } from './modules/auth/infrastructure/security/common-password-list';
import { AppMetrics, startMetricsServer } from './core/observability/metrics';
import type { IErrorReporter } from './core/observability/sentry';
import { createHttpServer, listen } from './server';
import { exportLimitsFromEnv } from './core/export/export-limits';

export async function startServer(
  env: Env,
  logger: Logger,
  reporter: IErrorReporter,
): Promise<void> {
  applyVietnameseZodLocale();
  const metrics = new AppMetrics();

  const pool = createPgPool(
    { connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX },
    logger,
  );
  metrics.gauge('db_pool_total', 'Kết nối DB trong pool', () => pool.totalCount);
  metrics.gauge('db_pool_idle', 'Kết nối DB rảnh', () => pool.idleCount);
  metrics.gauge('db_pool_waiting', 'Request đang chờ kết nối DB', () => pool.waitingCount);
  const valkey = createValkeyClient(env.REDIS_URL, logger, env.VALKEY_SOCKET_TIMEOUT_MS);
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

  const { clock, businessClock } = clocksForEnv(env.TEST_CLOCK_ANCHOR, logger); // E2E: neo + trôi
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
      jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      exportLimits: exportLimitsFromEnv(env),
    },
    logger,
    clock,
    businessClock,
    retentionCutoff: retentionCutoffFor({ env, persistence, businessClock }), // T-047: null khi job tắt
    ids,
    random: new CryptoRandom(),
    hasher: await Argon2idPasswordHasher.forEnv(env.APP_ENV, logger),
    policy: new PasswordPolicy(loadCommonPasswordList()),
    persistence,
    rateLimitStore,
    probes: [databaseProbe(pool), valkeyProbe(valkey)],
    isShuttingDown: () => lifecycleRef.current?.isShuttingDown() ?? false,
    metrics,
    errorReporter: reporter,
  });

  const server = createHttpServer(container.app);
  const adapter = env.SOCKET_REDIS_ADAPTER ? await createValkeyAdapter(valkey, logger) : undefined;
  // ADR-115: > 1 instance ⇒ hạn mức realtime theo user đếm chung qua Valkey (Local vẫn luôn kiểm).
  const quota = createRealtimeQuota({
    shared: env.SOCKET_REDIS_ADAPTER,
    valkey,
    clock,
    logger,
    metrics,
  });
  const gateway = new RealtimeGateway(server, {
    corsOrigins: env.CORS_ORIGINS,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    authenticator: container.socketAuth,
    accessChecker: container.workspace.accessChecker,
    handshakeLimiter: createHitLimiter(RATE_LIMIT_RULES.socketHandshake[0], {
      storeFor: rateLimitStore,
      logger,
    }),
    logger,
    clock,
    ids,
    ...(adapter ? { adapter: adapter.adapter } : {}),
    quota,
  });
  container.realtime.bind(gateway);
  metrics.gauge(
    'socketio_connected_clients',
    'Socket đang nối vào instance này',
    () => gateway.io.engine.clientsCount,
  );
  // Job bảo trì (T-033, ADR-095): purge workspace hết ân hạn mỗi giờ, khóa advisory theo lô.
  // Kết quả mỗi lượt ⇒ metrics `scheduled_job_*` (T-035) — bọc `run`, không sửa scheduler.
  const measured = (job: ScheduledJob): ScheduledJob => ({
    ...job,
    run: (signal) =>
      job.run(signal).then(
        () => metrics.recordJobRun(job.name, true),
        (err: unknown) => {
          metrics.recordJobRun(job.name, false);
          throw err;
        },
      ),
  });
  const jobs = maintenanceJobs({
    persistence,
    env,
    clock,
    businessClock,
    logger,
    offboarding: container.company,
  });
  // Job dọn dẹp tắt ở local/test (mặc định); job hoàn tất nghỉ việc luôn có — xem `maintenanceJobs`.
  const maintenance =
    jobs.length > 0 ? new MaintenanceScheduler(jobs.map(measured), { logger }) : undefined;

  const metricsServer = await startMetricsServer({
    port: env.METRICS_PORT,
    host: env.METRICS_HOST,
    registry: metrics.registry,
    token: env.METRICS_TOKEN,
    logger,
  });

  const lifecycle = createGracefulShutdown({
    server,
    logger,
    drainMs: env.READINESS_DRAIN_MS,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    realtime: [{ name: 'socket.io', close: () => gateway.close() }],
    onFatal: (error) => reporter.capture(error),
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
      {
        name: 'metrics',
        close: () => new Promise<void>((resolve) => metricsServer.close(() => resolve())),
      },
      // Cuối cùng: đẩy nốt event Sentry (kể cả lỗi fatal vừa báo) trước khi thoát.
      { name: 'sentry', close: () => reporter.close(2_000) },
    ],
  });
  lifecycleRef.current = lifecycle;
  lifecycle.installProcessHandlers();

  await listen(server, env.PORT);
  maintenance?.start();
  const metricsAddress = metricsServer.address();
  logger.info(
    {
      port: env.PORT,
      metricsPort:
        typeof metricsAddress === 'object' && metricsAddress ? metricsAddress.port : null,
      nodeEnv: env.NODE_ENV,
    },
    'api.listening',
  );
}
