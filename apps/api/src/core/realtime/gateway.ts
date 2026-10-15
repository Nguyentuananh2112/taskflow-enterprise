import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { Server, type ServerOptions } from 'socket.io';

import type { IClock, IIdGenerator } from '../domain';
import { AppError } from '../errors';
import { ipKey, type IHitLimiter } from '../http/rate-limit/rate-limit';
import type { ILogger } from '../logging/logger';
import {
  ClientId,
  createEnvelope,
  rooms,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './events';
import type {
  IProjectAccessChecker,
  ISocketAuthenticator,
  RealtimeEventMeta,
  WorkspaceRole,
} from './ports';
import {
  AUTH_RENEW_LIMIT,
  MAX_SOCKETS_PER_USER,
  PROJECT_JOIN_LIMIT_PER_USER,
} from '../http/rate-limit/rules';
import { SlidingWindow } from '../http/rate-limit/sliding-window';
import { joinPersonalRooms, leaveWorkspaceRoomsLocal, localSocketCount } from './local-rooms';
import { registerSocketHandlers, type AppSocket } from './socket-handlers';

export interface RealtimeGatewayOptions {
  corsOrigins: readonly string[];
  trustProxyHops: number;
  authenticator: ISocketAuthenticator;
  accessChecker: IProjectAccessChecker;
  /** 20 handshake/phút/IP (security §5.1). */
  handshakeLimiter?: IHitLimiter;
  logger: ILogger;
  clock: IClock;
  ids: IIdGenerator;
  /** `@socket.io/redis-adapter` khi `SOCKET_REDIS_ADAPTER=true` (ADR-027). */
  adapter?: ServerOptions['adapter'];
}

/** IP client sau `TRUST_PROXY_HOPS` proxy tin cậy (cùng quy tắc `trust proxy` của Express). */
export function clientIp(req: IncomingMessage, trustProxyHops: number): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const chain = [...forwarded, req.socket.remoteAddress ?? ''];
  return chain[Math.max(0, chain.length - 1 - trustProxyHops)] ?? '';
}

/**
 * Gateway Socket.io (ADR-027, security §5): chỉ websocket, kiểm Origin ở `allowRequest` (SEC-56,
 * chống CSWSH — trình duyệt không áp CORS cho WebSocket), xác thực token ở handshake.
 * Kênh chỉ đọc: server → client. Mọi lời gọi phát/thu hồi chỉ được gọi SAU commit (ADR-012).
 *
 * Hiện thực `IAuthRealtimeNotifier` (auth) và port realtime của Workspace (T-015) theo cấu trúc.
 */
export class RealtimeGateway {
  readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

  readonly #renewsByUser = new SlidingWindow(AUTH_RENEW_LIMIT.user);
  readonly #joinsByUser = new SlidingWindow(PROJECT_JOIN_LIMIT_PER_USER);

  constructor(
    httpServer: HttpServer,
    private readonly o: RealtimeGatewayOptions,
  ) {
    const allowed = new Set(o.corsOrigins);
    this.io = new Server(httpServer, {
      transports: ['websocket'],
      allowUpgrades: false,
      serveClient: false,
      maxHttpBufferSize: 100_000,
      connectTimeout: 10_000,
      ...(o.adapter ? { adapter: o.adapter } : {}),
      allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        if (origin === undefined || !allowed.has(origin))
          return callback('ORIGIN_NOT_ALLOWED', false);
        if (!o.handshakeLimiter) return callback(null, true);
        o.handshakeLimiter
          .hit(ipKey(clientIp(req, o.trustProxyHops)))
          .then(({ allowed: ok }) => callback(ok ? null : 'RATE_LIMITED', ok))
          .catch(() => callback('SERVICE_UNAVAILABLE', false));
      },
    });
    this.io.use((socket, next) => void this.#authenticate(socket, next));
    this.io.on('connection', (socket) => this.#onConnection(socket));
    this.io.on('workspace:leave-rooms', (input) =>
      leaveWorkspaceRoomsLocal(this.io.of('/'), input),
    );
  }

  async #authenticate(socket: AppSocket, next: (err?: Error) => void): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown; clientId?: unknown };
    try {
      if (typeof auth.token !== 'string' || !auth.token) throw new Error('missing token');
      const principal = await this.o.authenticator.authenticate(auth.token);
      // Review B M2: chặn một user mở hàng loạt socket (mỗi socket có hạn mức join/renew riêng) làm
      // cạn pool DB dùng chung. Đếm LOCAL theo phòng user — handshake song song có thể lọt vài socket.
      if (localSocketCount(this.io.of('/'), rooms.user(principal.userId)) >= MAX_SOCKETS_PER_USER) {
        this.o.logger.warn({ userId: principal.userId }, 'realtime.socket_cap_reached');
        return next(Object.assign(new Error('RATE_LIMITED'), { data: { code: 'RATE_LIMITED' } }));
      }
      socket.data = { ...principal, clientId: ClientId.parse(auth.clientId), joined: new Map() };
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNAUTHORIZED';
      if (
        !(err instanceof AppError) &&
        !(err instanceof Error && err.message === 'missing token')
      ) {
        this.o.logger.error({ err }, 'realtime.handshake_failed');
      }
      next(Object.assign(new Error(code), { data: { code } }));
    }
  }

  #onConnection(socket: AppSocket): void {
    // Đăng ký handler ĐỒNG BỘ (event client gửi ngay sau connect không bị rơi); `project:join` chờ
    // `verified` nên không vào được phòng nào trước khi phiên được xác thực lại.
    registerSocketHandlers(socket, {
      ...this.o,
      renewsByUser: this.#renewsByUser,
      joinsByUser: this.#joinsByUser,
      verified: joinPersonalRooms(socket, this.o),
    });
  }

  // ---------- IAuthRealtimeNotifier (security §5.4) ----------
  // Thu hồi luôn chạy LOCAL trước rồi mới phát cho cụm: với redis-adapter, thao tác cụm chỉ áp
  // dụng ở chính instance này khi nhận lại message của mình qua Valkey ⇒ Valkey lỗi thì không
  // instance nào thu hồi (T-028 H3). Bản local bảo đảm ít nhất instance hiện tại thu hồi; chạy
  // lại khi message quay về là vô hại (idempotent).
  disconnectSession(sid: string): Promise<void> {
    this.#disconnect(rooms.session(sid));
    return Promise.resolve();
  }

  disconnectUser(userId: string): Promise<void> {
    this.#disconnect(rooms.user(userId));
    return Promise.resolve();
  }

  // ---------- Workspace (T-015): IWorkspaceRealtimeNotifier — tham số có tên (quy tắc ≥ 2 cùng kiểu) ----------
  revokeWorkspaceAccess(
    input: { userId: string; workspaceId: string; projectIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { userId, workspaceId, projectIds } = input;
    this.#leave(rooms.user(userId), projectIds.map(rooms.project));
    this.#leaveWorkspaceRooms({ workspaceId, userId });
    this.#emit(rooms.user(userId), 'workspace:access-revoked', { workspaceId }, meta);
    return Promise.resolve();
  }

  notifyRoleChanged(
    input: { userId: string; workspaceId: string; role: WorkspaceRole },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { userId, workspaceId, role } = input;
    this.#emit(rooms.user(userId), 'member:role-changed', { workspaceId, role }, meta);
    return Promise.resolve();
  }

  /** Workspace xóa mềm: báo từng thành viên qua phòng user, rồi rời mọi phòng project (data-and-api §1.7). */
  closeWorkspace(
    input: { workspaceId: string; projectIds: string[]; memberUserIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { workspaceId, projectIds, memberUserIds } = input;
    for (const userId of memberUserIds) {
      this.#emit(rooms.user(userId), 'workspace:access-revoked', { workspaceId }, meta);
    }
    const projectRooms = projectIds.map(rooms.project);
    if (projectRooms.length) this.#leave(projectRooms, projectRooms);
    this.#leaveWorkspaceRooms({ workspaceId, userId: null });
    return Promise.resolve();
  }

  // ---------- Task/Project (Phase 3) ----------
  emitToProject(
    input: { projectId: string; type: string; data: unknown },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    this.#emit(rooms.project(input.projectId), input.type, input.data, meta);
    return Promise.resolve();
  }

  /** Graceful shutdown: chỉ ngắt socket của instance này (client nối sang instance khác). */
  close(): Promise<void> {
    this.io.local.disconnectSockets(true);
    this.io.engine.close();
    return Promise.resolve();
  }

  #disconnect(room: string): void {
    this.io.local.in(room).disconnectSockets(true);
    this.io.in(room).disconnectSockets(true);
  }

  /** Review B G1: rời phòng theo `data.joined` — LOCAL trước (T-028 H3), rồi báo instance khác. */
  #leaveWorkspaceRooms(input: { workspaceId: string; userId: string | null }): void {
    leaveWorkspaceRoomsLocal(this.io.of('/'), input);
    if (!this.o.adapter) return; // adapter bộ nhớ: chỉ một instance, serverSideEmit không hỗ trợ
    try {
      this.io.serverSideEmit('workspace:leave-rooms', input);
    } catch (err) {
      this.o.logger.error(
        { err, workspaceId: input.workspaceId },
        'realtime.leave_rooms_broadcast_failed',
      );
    }
  }

  #leave(from: string | string[], leave: string[]): void {
    this.io.local.in(from).socketsLeave(leave);
    this.io.in(from).socketsLeave(leave);
  }

  #emit(room: string, type: string, data: unknown, meta: RealtimeEventMeta): void {
    this.io.to(room).emit(type, createEnvelope(this.o, type, data, meta));
  }
}
