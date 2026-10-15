import type { Socket } from 'socket.io';

import type { IClock, IIdGenerator } from '../domain';
import { AppError } from '../errors';
import { MAX_PROJECT_ROOMS_PER_SOCKET, PROJECT_JOIN_LIMIT } from '../http/rate-limit/rules';
import type { ILogger } from '../logging/logger';
import {
  AuthRenewPayload,
  createEnvelope,
  ProjectJoinPayload,
  ProjectLeavePayload,
  rooms,
  type AckFn,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './events';
import type { IProjectAccessChecker, ISocketAuthenticator } from './ports';

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface SocketHandlerDeps {
  authenticator: ISocketAuthenticator;
  accessChecker: IProjectAccessChecker;
  logger: ILogger;
  clock: IClock;
  ids: IIdGenerator;
}

/** Hẹn giờ theo `exp` của token: hết hạn chưa `auth:renew` ⇒ `auth:expired` rồi ngắt (security §5.3). */
function scheduleExpiry(
  socket: AppSocket,
  deps: SocketHandlerDeps,
  timers: WeakMap<AppSocket, NodeJS.Timeout>,
) {
  clearTimeout(timers.get(socket));
  const delay = Math.max(0, socket.data.expiresAt.getTime() - deps.clock.now().getTime());
  const timer = setTimeout(() => {
    socket.emit(
      'auth:expired',
      createEnvelope(deps, 'auth:expired', {}, { actorId: socket.data.userId }),
    );
    socket.disconnect(true);
  }, delay);
  timer.unref();
  timers.set(socket, timer);
}

const ackOf = (ack: unknown): AckFn | undefined =>
  typeof ack === 'function' ? (ack as AckFn) : undefined;

export function registerSocketHandlers(socket: AppSocket, deps: SocketHandlerDeps): void {
  const timers = new WeakMap<AppSocket, NodeJS.Timeout>();
  const joinHits: number[] = [];
  scheduleExpiry(socket, deps, timers);
  socket.on('disconnect', () => clearTimeout(timers.get(socket)));

  socket.on('project:join', async (payload, rawAck) => {
    const ack = ackOf(rawAck);
    if (!ack) return;
    const now = deps.clock.now().getTime();
    while (joinHits.length && (joinHits[0] ?? 0) <= now - PROJECT_JOIN_LIMIT.windowMs)
      joinHits.shift();
    if (joinHits.length >= PROJECT_JOIN_LIMIT.limit)
      return ack({ ok: false, code: 'RATE_LIMITED' });
    joinHits.push(now);

    const parsed = ProjectJoinPayload.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, code: 'VALIDATION_ERROR' });
    const { workspaceId, projectId } = parsed.data;
    const { joined, userId } = socket.data;
    const room = rooms.project(projectId);
    // Đếm theo phòng thực tế: thu hồi phía server (socketsLeave) không cập nhật `joined`.
    const projectRooms = [...socket.rooms].filter((r) => r.startsWith('project:'));
    if (!socket.rooms.has(room) && projectRooms.length >= MAX_PROJECT_ROOMS_PER_SOCKET) {
      return ack({ ok: false, code: 'BUSINESS_RULE_VIOLATION' });
    }
    const check = () => deps.accessChecker.canAccessProject({ userId, workspaceId, projectId });
    try {
      if (!(await check())) return ack({ ok: false, code: 'RESOURCE_NOT_FOUND' });
    } catch (err) {
      deps.logger.error({ err, userId, projectId }, 'realtime.project_join_check_failed');
      return ack({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    }
    await socket.join(room);
    // TOCTOU (review T-016): thu hồi commit giữa lần kiểm trên và `join` đã chạy socketsLeave
    // TRƯỚC khi ta vào phòng ⇒ kiểm lại SAU join. Thu hồi commit sau lần kiểm này sẽ tự
    // socketsLeave sau join. Kiểm lại lỗi ⇒ fail-closed (rời phòng).
    let stillAllowed: boolean;
    try {
      stillAllowed = await check();
    } catch (err) {
      deps.logger.error({ err, userId, projectId }, 'realtime.project_join_recheck_failed');
      stillAllowed = false;
    }
    if (!stillAllowed) {
      await socket.leave(room);
      joined.delete(projectId);
      return ack({ ok: false, code: 'RESOURCE_NOT_FOUND' });
    }
    joined.set(projectId, workspaceId);
    ack({ ok: true });
  });

  socket.on('project:leave', async (payload, rawAck) => {
    const ack = ackOf(rawAck);
    if (!ack) return;
    const parsed = ProjectLeavePayload.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, code: 'VALIDATION_ERROR' });
    await socket.leave(rooms.project(parsed.data.projectId));
    socket.data.joined.delete(parsed.data.projectId);
    ack({ ok: true });
  });

  socket.on('auth:renew', async (payload, rawAck) => {
    const ack = ackOf(rawAck);
    if (!ack) return;
    const reject = () => {
      ack({ ok: false, code: 'UNAUTHORIZED' });
      socket.disconnect(true);
    };
    const parsed = AuthRenewPayload.safeParse(payload);
    if (!parsed.success) return reject();
    let principal;
    try {
      principal = await deps.authenticator.authenticate(parsed.data.token);
    } catch (err) {
      if (!(err instanceof AppError)) deps.logger.error({ err }, 'realtime.renew_failed');
      return reject();
    }
    // Token của user khác ⇒ ngắt (SEC-39).
    if (principal.userId !== socket.data.userId) return reject();

    if (principal.sid !== socket.data.sid) {
      await socket.leave(rooms.session(socket.data.sid));
      await socket.join(rooms.session(principal.sid));
      socket.data.sid = principal.sid;
    }
    socket.data.expiresAt = principal.expiresAt;
    scheduleExpiry(socket, deps, timers);
    await recheckRooms(socket, deps);
    ack({ ok: true });
  });
}

/** Lưới an toàn khi renew: rời các phòng không còn quyền (nếu lỡ mất sự kiện thu hồi). */
async function recheckRooms(socket: AppSocket, deps: SocketHandlerDeps): Promise<void> {
  const { userId, joined } = socket.data;
  for (const [projectId, workspaceId] of [...joined]) {
    try {
      if (await deps.accessChecker.canAccessProject({ userId, workspaceId, projectId })) continue;
    } catch (err) {
      deps.logger.warn({ err, userId, projectId }, 'realtime.recheck_failed_keep_room');
      continue;
    }
    await socket.leave(rooms.project(projectId));
    joined.delete(projectId);
  }
}
