/**
 * Cấu hình hạ tầng cho bộ test bảo mật đen (T-017). Mặc định trỏ vào compose local `taskflow`
 * (ADR-097: Postgres test 5434, Valkey 6380); CI ghi đè bằng biến `SEC_*`.
 * Mật khẩu dưới đây là giá trị mặc định `*_local_only` của docker-compose — không phải secret.
 *
 * ADR-106: postgres-test dùng chung ⇒ suite chỉ chạy trên DB RIÊNG của QA (`taskflow_sec`), và từ chối
 * mọi DB dùng chung (`taskflow_template`, DB dev) hay Postgres dev (5435).
 */
export interface SecurityHarnessConfig {
  /** Role sở hữu DB của suite (migrator — có CREATEDB, chạy migration). */
  migratorUser: string;
  migratorPassword: string;
  /** User DML mà process API dùng (ADR-074 tách quyền). */
  appUser: string;
  appPassword: string;
  pgHost: string;
  pgPort: number;
  /** DB riêng của suite — schema `public` bị xóa và migrate lại ở đầu mỗi file. */
  dbName: string;
  redisUrl: string;
  /** Origin hợp lệ duy nhất của web (ADR-097). */
  webOrigin: string;
}

/** DB không bao giờ được đụng: template của harness integration, DB dev, DB hệ thống. */
const FORBIDDEN_DBS = new Set([
  'taskflow_template',
  'taskflow',
  'postgres',
  'template0',
  'template1',
]);
const DEV_POSTGRES_PORT = 5435;

export class UnsafeTestTargetError extends Error {
  override name = 'UnsafeTestTargetError';
}

export function assertSafeTarget(config: Pick<SecurityHarnessConfig, 'dbName' | 'pgPort'>): void {
  if (FORBIDDEN_DBS.has(config.dbName)) {
    throw new UnsafeTestTargetError(
      `Từ chối chạy suite bảo mật trên DB "${config.dbName}" (ADR-106) — dùng DB riêng, mặc định taskflow_sec`,
    );
  }
  if (config.pgPort === DEV_POSTGRES_PORT) {
    throw new UnsafeTestTargetError(
      `Từ chối chạy trên Postgres dev (cổng ${DEV_POSTGRES_PORT}) — suite chỉ dùng postgres-test (ADR-106)`,
    );
  }
}

export function loadHarnessConfig(env: NodeJS.ProcessEnv = process.env): SecurityHarnessConfig {
  const config: SecurityHarnessConfig = {
    migratorUser: env.SEC_PG_MIGRATOR_USER ?? 'taskflow_migrator',
    migratorPassword: env.SEC_PG_MIGRATOR_PASSWORD ?? 'migrator_local_only',
    appUser: env.SEC_PG_APP_USER ?? 'taskflow_app',
    appPassword: env.SEC_PG_APP_PASSWORD ?? 'app_local_only',
    pgHost: env.SEC_PG_HOST ?? '127.0.0.1',
    pgPort: Number(env.SEC_PG_PORT ?? 5434),
    dbName: env.SEC_PG_DB ?? 'taskflow_sec',
    // DB logic 15 riêng: bộ đếm rate limit / cache phiên của suite không chạm db 0 của server dev.
    redisUrl: env.SEC_REDIS_URL ?? 'redis://127.0.0.1:6380/15',
    webOrigin: env.SEC_WEB_ORIGIN ?? 'http://localhost:3001',
  };
  assertSafeTarget(config);
  return config;
}

export function postgresUrl(
  config: SecurityHarnessConfig,
  role: 'migrator' | 'app',
  database = config.dbName,
): string {
  const [user, password] =
    role === 'migrator'
      ? [config.migratorUser, config.migratorPassword]
      : [config.appUser, config.appPassword];
  return (
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${config.pgHost}:${config.pgPort}/${database}`
  );
}

/** Secret cố định cho test — tiền tố `test-only-` bị env.ts chặn ở production. */
export const TEST_JWT_SECRET = 'test-only-security-suite-secret-0123456789';
