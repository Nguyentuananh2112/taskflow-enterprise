import { getRuntimeConfig } from '@/shared/config';
import { getClientId } from '@/shared/lib/client-id';

import { createHttpClient, type AuthHooks } from './http';

// Instance `http` dùng chung cho segment api/ của mọi slice. Phần xác thực được cắm vào sau
// (Phase 4: entities/session gọi setAuthHooks) — T-012 để trống: chưa có token, refresh = false.

const ANONYMOUS: AuthHooks = {
  getAccessToken: () => null,
  refresh: () => Promise.resolve(false),
  onSessionEnded: () => undefined,
};

let hooks: AuthHooks = ANONYMOUS;

/** Phase 4 gọi một lần khi khởi tạo phiên. */
export function setAuthHooks(next: AuthHooks): void {
  hooks = next;
}

export const http = createHttpClient({
  baseUrl: () => getRuntimeConfig().apiUrl,
  clientId: getClientId,
  auth: {
    getAccessToken: () => hooks.getAccessToken(),
    refresh: () => hooks.refresh(),
    onSessionEnded: (reason) => hooks.onSessionEnded(reason),
  },
});
