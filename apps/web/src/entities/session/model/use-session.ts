import { useSyncExternalStore } from 'react';

import { sessionStore, type SessionState } from './session-store';

const SERVER_STATE: SessionState = { status: 'idle', user: null };

/** Trạng thái phiên cho React. Server render luôn thấy `idle` (phiên chỉ có ở client — ADR-026). */
export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => SERVER_STATE);
}
