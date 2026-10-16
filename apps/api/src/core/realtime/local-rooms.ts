import type { Namespace } from 'socket.io';

import { AppError } from '../errors';
import type { ILogger } from '../logging/logger';
import {
  rooms,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './events';
import type { ISocketAuthenticator } from './ports';
import type { AppSocket } from './socket-handlers';

/** Thao tác phòng trên socket CỦA INSTANCE NÀY (không qua adapter cụm). */
type AppNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function localSocketCount(nsp: AppNamespace, room: string): number {
  return nsp.adapter.rooms.get(room)?.size ?? 0;
}

/** Số socket theo user trên instance này — phòng `user:<id>` của adapter LOCAL (ADR-115 heartbeat). */
export function userSocketCounts(nsp: AppNamespace): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [room, members] of nsp.adapter.rooms) {
    if (room.startsWith('user:')) counts.set(room.slice('user:'.length), members.size);
  }
  return counts;
}

/**
 * Review B M1: logout / logout-all / đổi mật khẩu / refresh-reuse commit TRONG LÚC handshake đang ở
 * `authenticate()` thì `disconnectSession`/`disconnectUser` không thấy socket (chưa ở phòng user/
 * session) ⇒ socket sống tới `exp`. Vào phòng TRƯỚC rồi xác thực LẠI: thu hồi commit sau lần này
 * sẽ thấy socket trong phòng; thu hồi commit trước đó làm lần này thất bại ⇒ ngắt. Lỗi ⇒ fail-closed.
 */
export async function joinPersonalRooms(
  socket: AppSocket,
  deps: { authenticator: ISocketAuthenticator; logger: ILogger },
): Promise<boolean> {
  const { token } = socket.handshake.auth as { token: string };
  try {
    await socket.join([rooms.user(socket.data.userId), rooms.session(socket.data.sid)]);
    const principal = await deps.authenticator.authenticate(token);
    if (principal.userId === socket.data.userId) return true;
  } catch (err) {
    if (!(err instanceof AppError)) deps.logger.error({ err }, 'realtime.handshake_recheck_failed');
  }
  socket.disconnect(true);
  return false;
}

/**
 * Review B G1: rời mọi phòng project mà socket đã join THEO WORKSPACE (`data.joined`) — `projectIds`
 * của use case là ảnh chụp trong tx nên thiếu project tạo / join song song. `userId: null` ⇒ mọi
 * socket (workspace bị xóa). Chỉ socket local: `data` của RemoteSocket (`fetchSockets`) đi qua
 * serializer của adapter ⇒ Map `joined` thành `{}`; instance khác tự chạy khi nhận `serverSideEmit`.
 */
export function leaveWorkspaceRoomsLocal(
  nsp: AppNamespace,
  { workspaceId, userId }: { workspaceId: string; userId: string | null },
): void {
  const ids =
    userId === null
      ? [...nsp.sockets.keys()]
      : [...(nsp.adapter.rooms.get(rooms.user(userId)) ?? [])];
  for (const id of ids) {
    const socket = nsp.sockets.get(id);
    if (!socket) continue;
    for (const [projectId, ws] of [...socket.data.joined]) {
      if (ws !== workspaceId) continue;
      void socket.leave(rooms.project(projectId));
      socket.data.joined.delete(projectId);
    }
  }
}
