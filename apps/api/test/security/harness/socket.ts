import { io, type Socket } from 'socket.io-client';

import { randomIp } from './actors';
import type { ApiUnderTest } from './suite';

/**
 * Client Socket.io thật cho các ca SEC realtime (ADR-027, security.md §5): websocket-only, Origin
 * hợp lệ (SEC-56 kiểm riêng bằng HTTP Upgrade thô), không tự nối lại — mọi ngắt kết nối là do server.
 * Mỗi socket một `X-Forwarded-For` ngẫu nhiên (API chạy `TRUST_PROXY_HOPS=1`) ⇒ không chạm hạn mức
 * handshake 20/phút/IP — ca nào cần đo hạn mức đó thì tự đặt IP.
 */
export function openSocket(
  api: ApiUnderTest,
  token: string | undefined,
  clientId: unknown = null,
  ip: string = randomIp(),
): Socket {
  return io(api.baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: token === undefined ? { clientId } : { token, clientId },
    extraHeaders: { origin: api.webOrigin, 'x-forwarded-for': ip },
    reconnection: false,
    forceNew: true,
    timeout: 5_000,
  });
}

export function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

/** `connect_error` của middleware xác thực: `message` = mã, `data.code` = mã (security §5.1). */
export function connectError(socket: Socket): Promise<{ message: string; code: unknown }> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('mong đợi connect_error, nhưng đã nối được')));
    socket.once('connect_error', (err: Error & { data?: { code?: unknown } }) =>
      resolve({ message: err.message, code: err.data?.code }),
    );
  });
}

export function disconnected(socket: Socket, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket không bị ngắt')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

export function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 5_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`không nhận ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Thu mọi event `name` nhận được; `stop()` trả danh sách. Dùng để khẳng định KHÔNG nhận gì. */
export function collect<T = unknown>(socket: Socket, event: string) {
  const seen: T[] = [];
  const handler = (payload: T) => seen.push(payload);
  socket.on(event, handler);
  return () => {
    socket.off(event, handler);
    return seen;
  };
}

export interface SocketAck {
  ok: boolean;
  code?: string;
}

export function emitAck(socket: Socket, event: string, payload: unknown): Promise<SocketAck> {
  return socket.timeout(5_000).emitWithAck(event, payload) as Promise<SocketAck>;
}
