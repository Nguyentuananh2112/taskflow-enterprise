export {
  createOfflineRealtimeClient,
  type RealtimeClient,
  type RealtimeStatus,
  type ServerEvent,
  type ServerPayload,
} from './realtime-client';
export { RealtimeClientProvider, useRealtimeClient, useRealtimeStatus } from './realtime-context';
export { createLazyRealtimeClient } from './lazy-realtime-client';
export type { SocketAuthHooks } from './socket-io-client';

/**
 * socket.io-client CHỈ qua `import()` (T-044 S1): không nằm trong JS khởi động của route nào. App dùng cùng
 * `createLazyRealtimeClient`; test với API thật (real-api) `await` trực tiếp.
 */
export const loadSocketIoClient = () =>
  import('./socket-io-client').then((m) => m.createSocketIoClient);
