import { useSyncExternalStore } from 'react';

import { session } from './session';
import { sessionStore, type SessionState } from './session-store';

const SERVER_STATE: SessionState = { status: 'idle', user: null };

/** Trạng thái phiên cho React. Server render luôn thấy `idle` (phiên chỉ có ở client — ADR-026). */
export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => SERVER_STATE);
}

/** Đăng xuất ở server chưa được xác nhận (T-029 H2) — hiện cảnh báo + nút thử lại. */
export function useLogoutPending(): boolean {
  return useSyncExternalStore(
    (listener) => session.onLogoutPendingChange(listener),
    () => session.isLogoutPending(),
    () => false,
  );
}
