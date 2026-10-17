import { getRuntimeConfig } from '@/shared/config';
import { getClientId } from '@/shared/lib/client-id';

import { createHttpClient, type AuthHooks } from './http';

// Instance `http` dùng chung cho segment api/ của mọi slice. Phần xác thực do entities/session cắm
// vào lúc khởi động (setAuthHooks); trước đó là khách: không token, refresh = false.

const ANONYMOUS: AuthHooks = {
  getAccessToken: () => null,
  refresh: () => Promise.resolve(false),
  onSessionEnded: () => undefined,
};

let hooks: AuthHooks = ANONYMOUS;

/** entities/session gọi một lần khi khởi tạo phiên. */
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
    expiresAt: () => hooks.expiresAt?.() ?? 0,
  },
});

/**
 * Client KHÔNG gắn hook xác thực — chỉ cho endpoint dựa vào cookie (`/auth/refresh`, `/auth/logout`).
 * `/auth/refresh` đi qua `http` sẽ tự xếp hàng chờ chính lần refresh đang chạy ⇒ treo vĩnh viễn.
 */
export const cookieHttp = createHttpClient({
  baseUrl: () => getRuntimeConfig().apiUrl,
  clientId: getClientId,
});
