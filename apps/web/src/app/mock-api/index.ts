import { createAuthHandlers } from './auth-handlers';
import { MockDb, type MockDbOptions } from './mock-db';

// Mock API (T-019): cùng bộ handler MSW dùng cho test (setupServer) và cho dev (route handler
// app/mock-api/v1/[...path] khi APP_MOCK_API=1). Chưa có route thật ở API (Phase 3).

export { MockDb, REFRESH_GRACE_MS, type MockDbOptions } from './mock-db';
export { isMockApiEnabled } from './mock-flag';

/** `baseUrl` = API_URL (gồm `/api/v1`, không có `/` cuối). */
export function createMockApi(baseUrl: string, options: MockDbOptions = {}) {
  const db = new MockDb(options);
  return { db, handlers: [...createAuthHandlers(baseUrl, db)] };
}

export type MockApi = ReturnType<typeof createMockApi>;
