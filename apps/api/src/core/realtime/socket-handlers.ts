import type { Socket } from 'socket.io';

import type { IClock, IIdGenerator } from '../domain';
import { AppError } from '../errors';
import {
  AUTH_RENEW_LIMIT,
  MAX_PROJECT_ROOMS_PER_SOCKET,
  PROJECT_JOIN_LIMIT,
} from '../http/rate-limit/rules';
import type { ILogger } from '../logging/logger';
import {
  AuthRenewPayload,
  createEnvelope,
  ProjectJoinPayload,
  ProjectLeavePayload,
  rooms,
  type AckFn,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './events';
import type { IProjectAccessChecker, ISocketAuthenticator } from './ports';
import type { IRealtimeQuota } from './quota';
import { SlidingWindow } from '../http/rate-limit/sliding-window';

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface SocketHandlerDeps {
  authenticator: ISocketAuthenticator;
  accessChecker: IProjectAccessChecker;
  logger: ILogger;
  clock: IClock;
  ids: IIdGenerator;
  /**
   * Hạn mức `project:join` / `auth:renew` theo user — gộp mọi socket của user (review B M2), dùng
   * chung giữa các instance khi bật (ADR-115). Gateway giữ.
   */
  quota: IRealtimeQuota;
  /**
   * `true` khi phiên đã được xác thực LẠI sau khi socket vào phòng user/session (review B M1) —
   * `project:join` chờ kết quả này: phiên bị thu hồi giữa handshake ⇒ không vào được phòng nào.
   */
  verified: Promise<boolean>;
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
  const renews = new SlidingWindow(AUTH_RENEW_LIMIT.socket);
  /**
   * Join đang chạy (giữa kiểm quyền và vào phòng) — giữ suất phòng ĐỒNG BỘ (review B L1). Đếm theo
   * phòng: hai join CÙNG phòng song song ⇒ join xong trước không được xóa suất của join còn chạy.
   */
  const pendingJoins = new Map<string, number>();
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
    // Theo user SAU theo socket (socket đã hết suất thì không tiêu suất của user). Từ đây tới
    // `pendingJoins.set` không còn `await` ⇒ kiểm số phòng + giữ suất vẫn nguyên tử (review B L1).
    if (!(await deps.quota.tryJoin(socket.data.userId)))
      return ack({ ok: false, code: 'RATE_LIMITED' });

    const parsed = ProjectJoinPayload.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, code: 'VALIDATION_ERROR' });
    const { workspaceId, projectId } = parsed.data;
    const { joined, userId } = socket.data;
    const room = rooms.project(projectId);
    // Đếm theo phòng thực tế (thu hồi phía server — socketsLeave — không cập nhật `joined`) CỘNG các
    // join đang chạy: đếm rồi mới await ⇒ nhiều join song song cùng lọt qua giới hạn (review B L1).
    const projectRooms = [...socket.rooms].filter((r) => r.startsWith('project:'));
    const reserved = [...pendingJoins.keys()].filter((r) => !socket.rooms.has(r)).length;
    if (
      !socket.rooms.has(room) &&
      !pendingJoins.has(room) &&
      projectRooms.length + reserved >= MAX_PROJECT_ROOMS_PER_SOCKET
    ) {
      return ack({ ok: false, code: 'BUSINESS_RULE_VIOLATION' });
    }
    pendingJoins.set(room, (pendingJoins.get(room) ?? 0) + 1);
    try {
      await join(room, workspaceId, projectId, userId, joined, ack);
    } finally {
      const left = (pendingJoins.get(room) ?? 1) - 1;
      if (left > 0) pendingJoins.set(room, left);
      else pendingJoins.delete(room);
    }
  });

  async function join(
    room: string,
    workspaceId: string,
    projectId: string,
    userId: string,
    joined: SocketData['joined'],
    ack: AckFn,
  ): Promise<void> {
    // Review B M1: phiên phải qua lần xác thực lại sau handshake (thu hồi chen giữa handshake).
    if (!(await deps.verified)) return ack({ ok: false, code: 'UNAUTHORIZED' });
    const check = () => deps.accessChecker.canAccessProject({ userId, workspaceId, projectId });
    try {
      if (!(await check())) return ack({ ok: false, code: 'RESOURCE_NOT_FOUND' });
    } catch (err) {
      deps.logger.error({ err, userId, projectId }, 'realtime.project_join_check_failed');
      return ack({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    }
    // Ghi `joined` TRƯỚC khi vào phòng (review B G1 vòng 2): thu hồi theo workspace (`workspace:leave-
    // rooms`) đọc `joined` ⇒ thấy cả join đang chạy và XÓA mục này. Nếu ghi sau lần kiểm lại, một lần
    // kiểm lại gửi đi trước khi thu hồi commit (đọc "còn là thành viên") nhưng trả về sau hook thu hồi
    // sẽ để socket ở lại phòng của project không có trong ảnh chụp `projectIds`.
    joined.set(projectId, workspaceId);
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
    // `joined` mất mục ⇒ thu hồi theo workspace đã chạy trong lúc kiểm lại ⇒ không ở lại phòng.
    if (!stillAllowed || joined.get(projectId) !== workspaceId) {
      await socket.leave(room);
      joined.delete(projectId);
      return ack({ ok: false, code: 'RESOURCE_NOT_FOUND' });
    }
    ack({ ok: true });
  }

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
    // Mỗi lần renew tốn tới ~20 truy vấn DB ⇒ giới hạn TRƯỚC mọi việc khác (T-028 Medium).
    // Không ngắt: client thử lại sau; token hết hạn thì timer `auth:expired` tự ngắt.
    if (
      !renews.tryHit(socket.id, deps.clock.now().getTime()) ||
      !(await deps.quota.tryRenew(socket.data.userId))
    ) {
      return ack({ ok: false, code: 'RATE_LIMITED' });
    }
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
    // Socket đã ngắt trong lúc chờ (renew muộn) ⇒ không hẹn timer mồ côi (review B Info).
    if (!socket.connected) return;

    if (principal.sid !== socket.data.sid) {
      await socket.leave(rooms.session(socket.data.sid));
      await socket.join(rooms.session(principal.sid));
      socket.data.sid = principal.sid;
      // Review B L2: `disconnectSession(sid mới)` commit giữa authenticate và join phòng session
      // mới thì không thấy socket ⇒ xác thực LẠI sau khi đổi phòng (cùng cách với handshake — M1).
      try {
        await deps.authenticator.authenticate(parsed.data.token);
      } catch (err) {
        if (!(err instanceof AppError)) deps.logger.error({ err }, 'realtime.renew_failed');
        return reject();
      }
    }
    socket.data.expiresAt = principal.expiresAt;
    scheduleExpiry(socket, deps, timers);
    if (!(await recheckRooms(socket, deps))) {
      ack({ ok: false, code: 'SERVICE_UNAVAILABLE' });
      socket.disconnect(true);
      return;
    }
    ack({ ok: true });
  });
}

/**
 * Lưới an toàn khi renew: rời các phòng không còn quyền (nếu lỡ mất sự kiện thu hồi). Kiểm lỗi ⇒
 * trả `false` để renew NGẮT socket (fail-closed, review B L3) — đây là lưới an toàn duy nhất cho thu
 * hồi bị lỡ. Ngắt chứ không lặng lẽ rời phòng: client gặp `io server disconnect` sẽ refresh, nối
 * lại, `project:join` lại và refetch board (frontend.md §4.5) ⇒ không kẹt ở board "chết" realtime.
 */
async function recheckRooms(socket: AppSocket, deps: SocketHandlerDeps): Promise<boolean> {
  const { userId, joined } = socket.data;
  for (const [projectId, workspaceId] of [...joined]) {
    try {
      if (await deps.accessChecker.canAccessProject({ userId, workspaceId, projectId })) continue;
    } catch (err) {
      deps.logger.warn({ err, userId, projectId }, 'realtime.recheck_failed_disconnect');
      return false;
    }
    await socket.leave(rooms.project(projectId));
    joined.delete(projectId);
  }
  return true;
}
