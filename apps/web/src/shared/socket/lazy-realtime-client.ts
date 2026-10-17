import type { SocketAck } from '@taskflow/contracts/realtime';

import type { RealtimeClient, RealtimeStatus, ServerEvent } from './realtime-client';

type Registration =
  | { kind: 'status'; listener: (status: RealtimeStatus) => void; off?: () => void }
  | { kind: 'reconnect'; listener: () => void; off?: () => void }
  | { kind: 'event'; event: ServerEvent; handler: (payload: never) => void; off?: () => void };

const UNAVAILABLE: SocketAck = { ok: false, code: 'SERVICE_UNAVAILABLE' };

/**
 * `RealtimeClient` dùng được NGAY (đồng bộ) nhưng tải client thật (socket.io-client) bằng `import()` ở lần
 * `connect()` đầu tiên — T-044 S1: socket.io không còn nằm trong JS khởi động của mọi route (/login, landing).
 * Đăng ký `on` / `onStatus` / `onReconnect` trước khi tải xong được ghi lại rồi gắn vào client thật khi có; gỡ
 * đăng ký lúc nào cũng được. `disconnect()` trước khi tải xong ⇒ client thật (nếu về sau) không bao giờ connect.
 */
export function createLazyRealtimeClient(
  clientId: string,
  load: () => Promise<RealtimeClient>,
): RealtimeClient {
  let real: RealtimeClient | null = null;
  let loading: Promise<RealtimeClient | null> | null = null;
  let wanted = false;
  let pendingStatus: RealtimeStatus = 'offline';
  const registrations = new Set<Registration>();

  const attach = (r: Registration, client: RealtimeClient) => {
    if (r.kind === 'status') r.off = client.onStatus(r.listener);
    else if (r.kind === 'reconnect') r.off = client.onReconnect(r.listener);
    else r.off = client.on(r.event, r.handler as (payload: unknown) => void);
  };
  const setPending = (status: RealtimeStatus) => {
    pendingStatus = status;
    for (const r of registrations) if (r.kind === 'status') r.listener(status);
  };

  const ensureLoaded = (): Promise<RealtimeClient | null> => {
    loading ??= load().then(
      (client) => {
        real = client;
        for (const r of registrations) attach(r, client);
        if (wanted) client.connect();
        return client;
      },
      () => {
        // Không tải được chunk (mạng / deploy mới): ở chế độ offline — board vẫn dùng REST; lần connect sau thử lại.
        loading = null;
        if (wanted) setPending('offline');
        return null;
      },
    );
    return loading;
  };

  const register = (r: Registration): (() => void) => {
    registrations.add(r);
    if (real) attach(r, real);
    return () => {
      registrations.delete(r);
      r.off?.();
    };
  };

  // join / leave / renew chỉ có nghĩa khi đã có socket (app chỉ gọi khi `connected`) — chưa tải ⇒ như offline,
  // KHÔNG kích hoạt tải chunk.
  const viaReal = (call: (client: RealtimeClient) => Promise<SocketAck>) =>
    real ? call(real) : Promise.resolve(UNAVAILABLE);

  return {
    clientId,
    connect() {
      wanted = true;
      if (real) {
        real.connect();
        return;
      }
      setPending('connecting');
      void ensureLoaded();
    },
    disconnect() {
      wanted = false;
      if (real) real.disconnect();
      else setPending('offline');
    },
    status: () => real?.status() ?? pendingStatus,
    onStatus: (listener) => register({ kind: 'status', listener }),
    onReconnect: (listener) => register({ kind: 'reconnect', listener }),
    on: (event, handler) => register({ kind: 'event', event, handler }),
    joinProject: (payload) => viaReal((c) => c.joinProject(payload)),
    leaveProject: (payload) => viaReal((c) => c.leaveProject(payload)),
    renewAuth: (token) => viaReal((c) => c.renewAuth(token)),
    sendTyping: (payload) => real?.sendTyping(payload),
  };
}
