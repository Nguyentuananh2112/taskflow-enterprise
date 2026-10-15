import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '@taskflow/contracts/realtime';
import { io, type Socket } from 'socket.io-client';

import type { RealtimeClient, RealtimeStatus } from './realtime-client';

// Nơi DUY NHẤT import socket.io-client (frontend.md §2.3-5). Cấu hình theo §3.5 / security.md §5.1:
// chỉ websocket (ADR-074), token trong `auth` callback (gọi lại MỖI lần (re)connect ⇒ luôn token mới,
// không vào query string), autoConnect tắt.

export type SocketAuthHooks = Readonly<{
  token: () => string | null;
  /** Refresh ngay; `true` = có token mới. */
  renew: () => Promise<boolean>;
  /** Server từ chối token (`UNAUTHORIZED`) ⇒ kết thúc phiên. */
  revoked: () => void;
}>;

type UntypedEmitter = {
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
};

type Options = Readonly<{
  url: string;
  clientId: string;
  auth: SocketAuthHooks;
  /**
   * Chỉ cho môi trường NGOÀI trình duyệt (test Node với API thật): `ws` không tự gửi `Origin` mà server
   * bắt buộc (allowRequest). Trình duyệt tự gửi Origin của trang — app không truyền tùy chọn này.
   */
  extraHeaders?: Readonly<Record<string, string>>;
}>;

const ACK_TIMEOUT_MS = 5_000;
const UNAVAILABLE: SocketAck = { ok: false, code: 'SERVICE_UNAVAILABLE' };

export function createSocketIoClient({
  url,
  clientId,
  auth,
  extraHeaders,
}: Options): RealtimeClient {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
    transports: ['websocket'],
    autoConnect: false,
    withCredentials: false,
    auth: (cb) => cb({ token: auth.token(), clientId }),
    ...(extraHeaders ? { extraHeaders: { ...extraHeaders } } : {}),
  });
  let current: RealtimeStatus = 'offline';
  let connectedBefore = false;
  const statusListeners = new Set<(status: RealtimeStatus) => void>();
  const reconnectListeners = new Set<() => void>();
  const setStatus = (next: RealtimeStatus) => {
    if (next === current) return;
    current = next;
    statusListeners.forEach((l) => l(next));
  };
  const subscribe = <T>(set: Set<T>, item: T) => {
    set.add(item);
    return () => void set.delete(item);
  };
  const refreshThenConnect = () =>
    void auth.renew().then((ok) => {
      if (ok) socket.connect();
      else setStatus('offline');
    });

  socket.on('connect', () => {
    setStatus('connected');
    if (connectedBefore) reconnectListeners.forEach((l) => l());
    connectedBefore = true;
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return setStatus('offline');
    setStatus('reconnecting');
    // Server chủ động ngắt (auth:expired quá hạn, renew bị từ chối): socket.io KHÔNG tự nối lại.
    if (reason === 'io server disconnect') refreshThenConnect();
  });
  socket.on('connect_error', (error: Error & { data?: { code?: unknown } }) => {
    const code = error.data?.code;
    if (code === 'TOKEN_EXPIRED') return refreshThenConnect();
    if (code === 'UNAUTHORIZED') {
      setStatus('offline');
      return auth.revoked();
    }
    // Lỗi transport / Origin bị từ chối: để socket.io tự thử lại theo backoff, KHÔNG kết thúc phiên.
    setStatus(socket.active ? 'reconnecting' : 'offline');
  });
  socket.on('auth:expired', () => {
    // Token mới sẽ đi qua onTokenRenewed ⇒ renewAuth; server ngắt thì nhánh disconnect lo.
    void auth.renew();
  });

  const ack = (send: () => Promise<SocketAck>) => send().catch(() => UNAVAILABLE);
  const timed = () => socket.timeout(ACK_TIMEOUT_MS);

  return {
    clientId,
    connect: () => {
      if (socket.connected || socket.active) return;
      setStatus('connecting');
      socket.connect();
    },
    disconnect: () => {
      socket.disconnect();
      setStatus('offline');
    },
    status: () => current,
    onStatus: (listener) => subscribe(statusListeners, listener),
    onReconnect: (listener) => subscribe(reconnectListeners, listener),
    on: (event, handler) => {
      // socket.io không suy được kiểu listener khi tên event là tham số generic ⇒ dùng mặt không kiểu;
      // payload vẫn được feature parse bằng schema contracts trước khi dùng.
      const untyped = socket as unknown as UntypedEmitter;
      const listener = handler as (payload: unknown) => void;
      untyped.on(event, listener);
      return () => void untyped.off(event, listener);
    },
    joinProject: (payload) => ack(() => timed().emitWithAck('project:join', payload)),
    leaveProject: (payload) => ack(() => timed().emitWithAck('project:leave', payload)),
    renewAuth: (token) => ack(() => timed().emitWithAck('auth:renew', { token })),
  };
}
