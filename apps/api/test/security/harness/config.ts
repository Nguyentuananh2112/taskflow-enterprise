/**
 * Cấu hình hạ tầng cho bộ test bảo mật đen (T-017). Mặc định trỏ vào compose local `taskflow`
 * (ADR-097: Postgres test 5434, Valkey 6380); CI ghi đè bằng biến `SEC_*`.
 * Mật khẩu dưới đây là giá trị mặc định `*_local_only` của docker-compose — không phải secret.
 */
export interface SecurityHarnessConfig {
  /** Kết nối quản trị (role có CREATEDB) để clone DB riêng cho mỗi lần chạy. */
  adminUrl: string;
  /** DB mẫu đã migrate, clone bằng `CREATE DATABASE … TEMPLATE`. */
  templateDb: string;
  /** User DML mà process API dùng (ADR-074 tách quyền). */
  appUser: string;
  appPassword: string;
  pgHost: string;
  pgPort: number;
  redisUrl: string;
  /** Origin hợp lệ duy nhất của web (ADR-097). */
  webOrigin: string;
}

export function loadHarnessConfig(env: NodeJS.ProcessEnv = process.env): SecurityHarnessConfig {
  const pgHost = env.SEC_PG_HOST ?? '127.0.0.1';
  const pgPort = Number(env.SEC_PG_PORT ?? 5434);
  return {
    adminUrl:
      env.SEC_PG_ADMIN_URL ??
      `postgresql://taskflow_migrator:migrator_local_only@${pgHost}:${pgPort}/postgres`,
    templateDb: env.SEC_PG_TEMPLATE_DB ?? 'taskflow_template',
    appUser: env.SEC_PG_APP_USER ?? 'taskflow_app',
    appPassword: env.SEC_PG_APP_PASSWORD ?? 'app_local_only',
    pgHost,
    pgPort,
    // DB logic 15 riêng: bộ đếm rate limit của suite không khóa server dev dùng chung Valkey (db 0).
    redisUrl: env.SEC_REDIS_URL ?? 'redis://127.0.0.1:6380/15',
    webOrigin: env.SEC_WEB_ORIGIN ?? 'http://localhost:3001',
  };
}

/** Secret cố định cho test — tiền tố `test-only-` bị env.ts chặn ở production. */
export const TEST_JWT_SECRET = 'test-only-security-suite-secret-0123456789';
