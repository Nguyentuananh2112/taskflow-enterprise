import { setupServer } from 'msw/node';

import { createMockApi, type MockApiOptions } from '@/app/mock-api';
import { resetRuntimeConfigForTest, setRuntimeConfig } from '@/shared/config';

// Mock API cho test (T-019): CÙNG bộ handler MSW với chế độ dev (`APP_MOCK_API=1`), request được
// validate bằng schema contracts. Node fetch không có cookie jar ⇒ `installCookieJar` mô phỏng hành
// vi trình duyệt cho cookie refresh HttpOnly (MSW 3 không tự giữ cookie — đã kiểm ở T-019).

export const API_BASE = 'http://localhost:4000/api/v1';

type Cookie = { value: string; path: string };

/* eslint-disable no-restricted-properties -- hạ tầng test: bọc fetch để mô phỏng cookie jar của trình
   duyệt; code ứng dụng vẫn chỉ gọi mạng qua `http` (frontend.md §2.3-7). */
export function installCookieJar() {
  const jar = new Map<string, Cookie>();
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const credentialed = init?.credentials === 'include';
    const headers = new Headers(init?.headers);
    // Trình duyệt tự gửi Origin cho request cross-origin (trang :3000 → API :4000) — Node fetch thì không.
    if (typeof window !== 'undefined') headers.set('origin', window.location.origin);
    if (credentialed) {
      const sent = [...jar].filter(([, c]) => url.pathname.startsWith(c.path));
      if (sent.length > 0)
        headers.set('cookie', sent.map(([n, c]) => `${n}=${c.value}`).join('; '));
    }
    const response = await original(input, { ...init, headers });
    if (credentialed) {
      for (const raw of response.headers.getSetCookie()) {
        const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim());
        const [name = '', value = ''] = pair.split('=');
        const path = attrs.find((a) => a.startsWith('Path='))?.slice(5) ?? '/';
        if (attrs.includes('Max-Age=0') || value === '') jar.delete(name);
        else jar.set(name, { value, path });
      }
    }
    return response;
  };
  return {
    get: (name: string) => jar.get(name)?.value,
    clear: () => jar.clear(),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
/* eslint-enable no-restricted-properties */

/** Bật mock API + cookie jar + runtime config cho cả file test. Gọi `stop()` ở afterAll. */
export function startMockApi(options: MockApiOptions = {}) {
  // CORS_ORIGINS của "server" = origin của trang jsdom (cookie endpoint kiểm Origin như API thật).
  const api = createMockApi(API_BASE, { allowedOrigins: [window.location.origin], ...options });
  const server = setupServer(...api.handlers);
  server.listen({ onUnhandledFrame: 'error' }); // MSW 3: tên mới của onUnhandledRequest
  const jar = installCookieJar();
  setRuntimeConfig({ apiUrl: API_BASE, wsUrl: 'http://localhost:4000', appEnv: 'test' });
  return {
    ...api,
    jar,
    stop: () => {
      jar.restore();
      server.close();
      resetRuntimeConfigForTest();
    },
  };
}
