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
  /** Refresh ngay; `true` = có token mới, `false` = phiên đã hết; NÉM = lỗi tạm (mạng/5xx/timeout). */
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
  /** Nguồn ngẫu nhiên cho jitter (test truyền hàm cố định). */
  random?: () => number;
}>;

const ACK_TIMEOUT_MS = 5_000;
/**
 * Nối lại sau khi SERVER ngắt / từ chối handshake (socket.io không tự thử lại): full jitter
 * `random × min(MAX, BASE × 2^n)`, n = số lần liên tiếp chưa nối lại được. Một lần DB chập chờn làm server
 * ngắt hàng loạt socket thì các tab không cùng lúc POST /auth/refresh + handshake (review B, L3).
 */
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 30_000;
/** Lỗi TẠM khi refresh (mạng/5xx/timeout) ⇒ thử lại theo cùng backoff tối đa ngần này lần liên tiếp. */
export const MAX_RENEW_FAILURES = 5;
const UNAVAILABLE: SocketAck = { ok: false, code: 'SERVICE_UNAVAILABLE' };

export function createSocketIoClient({
  url,
  clientId,
  auth,
  extraHeaders,
  random = Math.random,
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
  let attempts = 0;
  let renewFailures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tăng ở `disconnect()`: refresh đang bay của "đời" cũ không được connect / lên lịch lại (review B). */
  let epoch = 0;
  const refreshThenConnect = () => {
    clearTimeout(retryTimer);
    const delay = random() * Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
    attempts += 1;
    const started = epoch;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      auth.renew().then(
        (ok) => {
          if (started !== epoch) return;
          renewFailures = 0;
          // `false` = phiên đã hết (401/thu hồi) ⇒ fail-closed, KHÔNG thử lại.
          if (ok) socket.connect();
          else setStatus('offline');
        },
        () => {
          if (started !== epoch) return;
          renewFailures += 1;
          if (renewFailures < MAX_RENEW_FAILURES) refreshThenConnect();
          else setStatus('offline');
        },
      );
    }, delay);
  };

  socket.on('connect', () => {
    attempts = 0;
    renewFailures = 0;
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
    // Lỗi tạm ở đây không cần xử lý: server sẽ ngắt khi token hết hạn ⇒ nhánh disconnect thử lại.
    auth.renew().catch(() => undefined);
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
      epoch += 1;
      clearTimeout(retryTimer);
      retryTimer = undefined;
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
