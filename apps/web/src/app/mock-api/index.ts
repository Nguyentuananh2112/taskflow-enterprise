import { createAuthHandlers } from './auth-handlers';
import { MockDb, type MockDbOptions } from './mock-db';
import { contentTypeGuard } from './request-guards';

// Mock API (T-019): cùng bộ handler MSW dùng cho test (setupServer) và cho dev (route handler
// app/mock-api/v1/[...path] khi APP_MOCK_API=1). Chưa có route thật ở API (Phase 3).

export { MockDb, REFRESH_GRACE_MS, type MockDbOptions } from './mock-db';
export { isMockApiEnabled } from './mock-flag';

export type MockApiOptions = MockDbOptions &
  Readonly<{
    /** Origin được gọi `/auth/refresh` + `/auth/logout` (CORS_ORIGINS). Mặc định: origin của baseUrl. */
    allowedOrigins?: readonly string[];
  }>;

/** `baseUrl` = API_URL (gồm `/api/v1`, không có `/` cuối). */
export function createMockApi(baseUrl: string, options: MockApiOptions = {}) {
  const db = new MockDb(options);
  const allowedOrigins = new Set(options.allowedOrigins ?? [new URL(baseUrl).origin]);
  return {
    db,
    handlers: [contentTypeGuard(baseUrl), ...createAuthHandlers(baseUrl, db, allowedOrigins)],
  };
}

export type MockApi = ReturnType<typeof createMockApi>;
