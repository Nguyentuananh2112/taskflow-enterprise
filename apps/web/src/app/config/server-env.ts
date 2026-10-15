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
  APP_ENV: AppEnv.default('local'),
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
