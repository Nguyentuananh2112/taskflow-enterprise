import { fileURLToPath } from 'node:url';

/**
 * Cấu hình E2E (T-026). Cổng riêng, không đụng dev (web 3001 / API 4000). DB riêng `taskflow_e2e` trên
 * postgres-test 5434 (ADR-106), Valkey db 14 (suite bảo mật dùng 15). Ghi đè bằng biến `E2E_*`.
 */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const API_DIR = fileURLToPath(new URL('../../apps/api/', import.meta.url));
export const E2E_DIR = fileURLToPath(new URL('../', import.meta.url));
export const WEB_DIR = fileURLToPath(new URL('../../apps/web/', import.meta.url));

export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;
export const API_ORIGIN = `http://localhost:${String(API_PORT)}`;
export const API_URL = `${API_ORIGIN}/api/v1`;

export const E2E_DB = process.env.E2E_PG_DB ?? 'taskflow_e2e';
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6380/14';

/** Secret cố định cho test — tiền tố `test-only-` bị env.ts chặn ở production. */
export const E2E_JWT_SECRET = 'test-only-e2e-suite-secret-0123456789abcdef';
