import type { AddressInfo } from 'node:net';

import { io as connect, type Socket as ClientSocket } from 'socket.io-client';

import type { SocketAck } from '../../src/core/realtime/events';
import { RealtimeGateway, type RealtimeGatewayOptions } from '../../src/core/realtime/gateway';
import type {
  IProjectAccessChecker,
  ISocketAuthenticator,
  SocketPrincipal,
} from '../../src/core/realtime/ports';
import { createHttpServer, listen } from '../../src/server';
import { SpyLogger } from './spies';
import { FakeClock, SequentialIdGenerator } from './time-and-ids';

export const WEB_ORIGIN = 'http://localhost:3001';

/** Authenticator giả: token `user:<id>:<sid>` hợp lệ; `throw:<Lỗi>` ném lỗi đã cấu hình. */
export class FakeSocketAuthenticator implements ISocketAuthenticator {
  ttlMs = 15 * 60_000;
  readonly errors = new Map<string, Error>();
  readonly calls: string[] = [];
  /**
   * Chạy trước khi trả kết quả lần gọi thứ `call` (đếm từ 1, mọi token) — mô phỏng thu hồi phiên
   * commit giữa hai lần xác thực (vd đặt `errors` rồi mới trả), hoặc giữ lần gọi treo.
   */
  before: ((token: string, call: number) => Promise<void> | void) | undefined;

  constructor(private readonly clock: { now(): Date }) {}

  authenticate(token: string): Promise<SocketPrincipal> {
    this.calls.push(token);
    if (!this.before) return this.#resolve(token);
    return Promise.resolve(this.before(token, this.calls.length)).then(() => this.#resolve(token));
  }

  #resolve(token: string): Promise<SocketPrincipal> {
    const error = this.errors.get(token);
    if (error) return Promise.reject(error);
    const [kind, userId, sid] = token.split(':');
    if (kind !== 'user' || !userId || !sid) return Promise.reject(new Error(`token lạ: ${token}`));
    return Promise.resolve({
      userId,
      sid,
      expiresAt: new Date(this.clock.now().getTime() + this.ttlMs),
    });
  }
}

/** Quyền vào project cấu hình được: `allow(userId, ws, project)`, hoặc ném lỗi. */
export class FakeProjectAccessChecker implements IProjectAccessChecker {
  readonly #allowed = new Set<string>();
  failWith: Error | undefined;
  /** Số lần đã kiểm (để test biết đang ở lần kiểm thứ mấy). */
  checks = 0;
  /**
   * Chạy SAU khi đã quyết định kết quả nhưng TRƯỚC khi trả về — mô phỏng một giao dịch khác
   * (vd xóa thành viên + afterCommit) chen vào giữa lần kiểm và hành động tiếp theo (TOCTOU).
   * Trả về `'throw'` để lần kiểm này ném lỗi.
   */
  interleave: ((check: number) => Promise<void | 'throw'> | void | 'throw') | undefined;

  allow(userId: string, workspaceId: string, projectId: string): this {
    this.#allowed.add(`${userId}|${workspaceId}|${projectId}`);
    return this;
  }

  revoke(userId: string, workspaceId: string, projectId: string): void {
    this.#allowed.delete(`${userId}|${workspaceId}|${projectId}`);
  }

  canAccessProject({
    userId,
    workspaceId,
    projectId,
  }: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<boolean> {
    if (this.failWith) return Promise.reject(this.failWith);
    const check = ++this.checks;
    const allowed = this.#allowed.has(`${userId}|${workspaceId}|${projectId}`);
    if (!this.interleave) return Promise.resolve(allowed);
    return Promise.resolve(this.interleave(check)).then((outcome) => {
      if (outcome === 'throw') throw new Error(`check ${check} failed`);
      return allowed;
    });
  }
}

export async function startRealtime(overrides: Partial<RealtimeGatewayOptions> = {}) {
  const clock = new FakeClock(new Date());
  const logger = new SpyLogger();
  const authenticator = new FakeSocketAuthenticator(clock);
  const accessChecker = new FakeProjectAccessChecker();
  const server = createHttpServer((_req, res) => res.writeHead(404).end());
  const gateway = new RealtimeGateway(server, {
    corsOrigins: [WEB_ORIGIN],
    trustProxyHops: 0,
    authenticator,
    accessChecker,
    logger,
    clock,
    ids: new SequentialIdGenerator(),
    ...overrides,
  });
  await listen(server, 0, '127.0.0.1');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients: ClientSocket[] = [];

  const client = (
    opts: {
      token?: string;
      clientId?: unknown;
      origin?: string | null;
      transport?: 'websocket' | 'polling';
    } = {},
  ) => {
    const socket = connect(url, {
      transports: [opts.transport ?? 'websocket'],
      auth: { token: opts.token ?? 'user:u1:s1', clientId: opts.clientId ?? null },
      ...(opts.origin === null ? {} : { extraHeaders: { origin: opts.origin ?? WEB_ORIGIN } }),
      reconnection: false,
      forceNew: true,
      timeout: 2_000,
    });
    clients.push(socket);
    return socket;
  };

  const close = async () => {
    clients.forEach((c) => c.close());
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { gateway, server, url, client, close, clock, logger, authenticator, accessChecker };
}

export function connected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

/** Lỗi handshake: `{ message, code }` (code từ `err.data.code`). */
export function connectError(socket: ClientSocket): Promise<{ message: string; code: unknown }> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('kết nối được — đáng lẽ bị từ chối')));
    socket.once('connect_error', (err: Error & { data?: { code?: unknown } }) =>
      resolve({ message: err.message, code: err.data?.code }),
    );
  });
}

export function emitWithAck(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<SocketAck> {
  return socket.timeout(2_000).emitWithAck(event, payload) as Promise<SocketAck>;
}

export function nextEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 1_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`không nhận được ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Khẳng định KHÔNG nhận event trong khoảng chờ (dùng cho kiểm tra cô lập phòng). */
export function noEvent(socket: ClientSocket, event: string, waitMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => resolve(false);
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, waitMs);
  });
}

export function disconnected(socket: ClientSocket): Promise<string> {
  return new Promise((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
}
