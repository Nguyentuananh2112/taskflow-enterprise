import * as z from 'zod';

// Nơi DUY NHẤT đọc process.env (devops.md §2.2–2.4, ESLint chặn chỗ khác). Thêm biến ⇒ sửa ở đây.

/**
 * Secret không bao giờ được chấp nhận ở production (security.md §6.9): placeholder của
 * `.env.example` (`change-me-…`) và giá trị test cố định (`test-only-…`).
 */
export const NON_PRODUCTION_SECRET = /^(change-me|test-only-)/;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Khóa HS256 = byte UTF-8 của chuỗi (security.md §2.1: `TextEncoder().encode(secret)`), ≥ 32 byte. */
const jwtSecret = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'phải ≥ 32 byte');

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });

const originList = z
  .string()
  .transform((raw) =>
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url().refine((u) => new URL(u).origin === u, 'chỉ origin, không path')).min(1));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    REDIS_URL: redisUrl,
    // `kid` suy ra từ secret trong adapter (T-013) ⇒ không có biến JWT_ACCESS_KID riêng.
    JWT_ACCESS_SECRET: jwtSecret,
    JWT_ACCESS_SECRET_PREVIOUS: jwtSecret.optional(),
    // ADR-097: web local ở :3001. Production không có mặc định thực tế — https-only bên dưới bắt buộc ghi rõ.
    CORS_ORIGINS: z.string().default('http://localhost:3001').pipe(originList),
    COOKIE_SECURE: z.stringbool(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    SENTRY_DSN: z.url().optional(),
    GIT_SHA: z.string().min(1),
    SOCKET_REDIS_ADAPTER: z.stringbool().default(false),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
    READINESS_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
    // Job bảo trì (T-033): không đặt ⇒ bật ở staging/production, tắt ở local/test (composition tính).
    MAINTENANCE_JOBS_ENABLED: z.stringbool().optional(),
    PURGE_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
    PURGE_JITTER_MS: z.coerce.number().int().min(0).max(3_600_000).default(300_000),
    METRICS_TOKEN: z.string().min(32).optional(),
    // T-020/T-024: lưu trữ của MỌI module (auth, workspace, task) — Prisma + Valkey, hoặc `memory`
    // (bộ nhớ, MẤT dữ liệu khi khởi động lại; chỉ local/test). Không còn trạng thái "lai" theo module.
    PERSISTENCE: z.enum(['prisma', 'memory']).default('prisma'),
  })
  .superRefine((env, ctx) => {
    const fail = (path: keyof typeof env, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (env.JWT_ACCESS_SECRET_PREVIOUS === env.JWT_ACCESS_SECRET) {
      fail('JWT_ACCESS_SECRET_PREVIOUS', 'trùng JWT_ACCESS_SECRET');
    }
    // Quyết định Tech Lead (T-020): staging/production KHÔNG bao giờ dùng lưu trữ bộ nhớ, kể cả "lai".
    if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
      if (env.PERSISTENCE === 'memory') fail('PERSISTENCE', 'staging/production bắt buộc prisma');
    }
    if (env.NODE_ENV !== 'production') return;

    if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'production bắt buộc COOKIE_SECURE=true');
    if (!env.REDIS_URL.startsWith('rediss://')) fail('REDIS_URL', 'production bắt buộc rediss://');
    if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      fail('CORS_ORIGINS', 'production chỉ chấp nhận https://');
    }
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_ACCESS_SECRET_PREVIOUS'] as const) {
      if (NON_PRODUCTION_SECRET.test(env[key] ?? '')) fail(key, 'secret mẫu/test');
    }
    if (env.APP_ENV !== 'staging' && env.APP_ENV !== 'production') {
      fail('APP_ENV', 'NODE_ENV=production chỉ đi với APP_ENV staging|production');
    }
    if (!env.SENTRY_DSN) fail('SENTRY_DSN', 'bắt buộc ở staging/production');
    if (!env.METRICS_TOKEN) fail('METRICS_TOKEN', 'bắt buộc ở production');
  });

export type Env = z.output<typeof EnvSchema>;

export class EnvValidationError extends Error {
  /** Chỉ TÊN biến — không bao giờ chứa giá trị (secret). */
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Biến môi trường thiếu hoặc không hợp lệ: ${variables.join(', ')}`);
    this.name = 'EnvValidationError';
    this.variables = variables;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const variables = Object.keys(z.flattenError(parsed.error).fieldErrors).sort();
  throw new EnvValidationError(variables);
}
