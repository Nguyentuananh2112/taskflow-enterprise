import * as z from 'zod';

import { AppEnv, PublicRuntimeConfig } from '@/shared/config';

// Nơi duy nhất của web đọc process.env (frontend.md §3.6). CHỈ root layout (server component) gọi.
// Chạy ở server, mỗi request
// (root layout render động — ADR-084), nên đổi env của container là đổi cấu hình, không cần build lại.

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const ServerEnv = z.object({
  API_URL: z.url({ protocol: /^https?$/ }).transform(trimSlash),
  WS_URL: z
    .url({ protocol: /^https?$/ })
    .transform(trimSlash)
    .optional(),
  // T-029: không đặt ⇒ production (an toàn mặc định: HSTS, tắt mock); chỉ local/test khi đặt tường minh.
  APP_ENV: AppEnv.default('production'),
});

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Parse env rồi chỉ trả giá trị công khai. Thiếu/sai ⇒ throw (fail fast, lộ ngay ở readiness).
 * `WS_URL` mặc định là origin của `API_URL` (devops.md §2.4).
 */
export function readPublicRuntimeConfig(source: EnvSource = process.env): PublicRuntimeConfig {
  const env = ServerEnv.parse(source);
  return PublicRuntimeConfig.parse({
    apiUrl: env.API_URL,
    wsUrl: env.WS_URL ?? new URL(env.API_URL).origin,
    appEnv: env.APP_ENV,
  });
}

const SentryEnv = z.object({
  // Trống = không đặt. DSN là công khai (chỉ cho phép GỬI event) nhưng repo public ⇒ đặt qua env.
  SENTRY_DSN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
  GIT_SHA: z.string().min(1).optional(),
  APP_ENV: AppEnv.default('production'),
});

export interface SentryRuntimeConfig {
  /** Không có ⇒ Sentry tắt (cả client lẫn tunnel `/monitoring` — 404). */
  dsn?: string;
  environment: string;
  release?: string;
}

/**
 * Cấu hình Sentry web (T-035) — tách khỏi `PublicRuntimeConfig` (không đổi tập khóa gửi xuống
 * client qua AppProviders). Root layout render thành `<meta>`; route `/monitoring` dùng để kiểm DSN.
 */
export function readSentryConfig(source: EnvSource = process.env): SentryRuntimeConfig {
  const env = SentryEnv.parse(source);
  return {
    environment: env.APP_ENV,
    ...(env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : {}),
    ...(env.GIT_SHA ? { release: env.GIT_SHA } : {}),
  };
}
