// Điểm vào của API. Chỉ nạp những gì cần TRƯỚC Sentry (env, logger, Sentry), rồi mới dynamic import
// phần còn lại (`start-server.ts`) — ESM: instrumentation của Sentry chỉ móc được vào module nạp
// SAU `Sentry.init` (T-035), không cần đổi lệnh chạy (`node dist/main.js`) hay Dockerfile.
import { EnvValidationError, isDeployed, loadEnv, type Env } from './config/env';
import { createLogger } from './core/logging/pino-logger';
import {
  createSentryReporter,
  noopErrorReporter,
  type IErrorReporter,
} from './core/observability/sentry';

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
  const logger = createLogger({ level: env.LOG_LEVEL, gitSha: env.GIT_SHA, appEnv: env.APP_ENV });

  let reporter: IErrorReporter = noopErrorReporter;
  if (env.SENTRY_DSN) {
    reporter = createSentryReporter({
      dsn: env.SENTRY_DSN,
      environment: env.APP_ENV,
      release: env.GIT_SHA,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      logger,
    });
  } else if (isDeployed(env.APP_ENV)) {
    // Giám sát không được làm sập app: thiếu DSN ⇒ cảnh báo, vẫn chạy (T-035 mục 5).
    logger.warn({ appEnv: env.APP_ENV }, 'observability.sentry_disabled_missing_dsn');
  }

  const { startServer } = await import('./start-server');
  await startServer(env, logger, reporter);
}

main().catch((err: unknown) => {
  console.error('[api] khởi động thất bại', err);
  process.exit(1);
});
