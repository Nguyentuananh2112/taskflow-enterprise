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
  joinPersonalRooms,
  leaveWorkspaceRoomsLocal,
  localSocketCount,
  userSocketCounts,
} from './local-rooms';
import { LocalRealtimeQuota, type IRealtimeQuota } from './quota';
import { UserNotifications } from './user-notifications';
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
  /** Hạn mức theo user (ADR-115). Mặc định: chỉ đếm trong instance (`LocalRealtimeQuota`). */
  quota?: IRealtimeQuota;
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

  readonly quota: IRealtimeQuota;

  constructor(
    httpServer: HttpServer,
    private readonly o: RealtimeGatewayOptions,
  ) {
    this.quota = o.quota ?? new LocalRealtimeQuota(o.clock);
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
    this.quota.start(() => userSocketCounts(this.io.of('/')));
  }

  async #authenticate(socket: AppSocket, next: (err?: Error) => void): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown; clientId?: unknown };
    try {
      if (typeof auth.token !== 'string' || !auth.token) throw new Error('missing token');
      const principal = await this.o.authenticator.authenticate(auth.token);
      // Review B M2: chặn một user mở hàng loạt socket (mỗi socket có hạn mức join/renew riêng) làm
      // cạn pool DB dùng chung. Local đếm theo phòng user — handshake song song có thể lọt vài socket;
      // > 1 instance thì đếm thêm dùng chung qua Valkey (ADR-115).
      const local = localSocketCount(this.io.of('/'), rooms.user(principal.userId));
      if (!(await this.quota.acquireSocket(principal.userId, local))) {
        this.o.logger.warn({ userId: principal.userId }, 'realtime.socket_cap_reached');
        return next(Object.assign(new Error('RATE_LIMITED'), { data: { code: 'RATE_LIMITED' } }));
      }
      socket.data = { ...principal, clientId: ClientId.parse(auth.clientId), joined: new Map() };
      // Suất được trả khi socket ngắt (`#onConnection`); socket bỏ đi trước khi `connection` chạy thì
      // heartbeat của bản dùng chung tự sửa số đếm.
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
    const { userId } = socket.data;
    socket.on('disconnect', () => void this.quota.releaseSocket(userId));
    registerSocketHandlers(socket, {
      ...this.o,
      quota: this.quota,
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

  // Mốc 3 — event tới `user:{id}` (user-notifications.ts).
  readonly #users = new UserNotifications((room, type, data, meta) =>
    this.#emit(room, type, data, meta),
  );
  readonly notifyCompanyAccessChanged: UserNotifications['companyAccessChanged'] = (i, m) =>
    this.#users.companyAccessChanged(i, m);
  readonly notifyNotification: UserNotifications['notification'] = (i, m) =>
    this.#users.notification(i, m);
  readonly broadcastAvatarChanged: UserNotifications['avatarChanged'] = (i, m) =>
    this.#users.avatarChanged(i, m);

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
  async close(): Promise<void> {
    this.io.local.disconnectSockets(true);
    this.io.engine.close();
    await this.quota.close();
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
