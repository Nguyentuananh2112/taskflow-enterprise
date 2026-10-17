import type { Server } from 'socket.io';

import type { IClock, IIdGenerator } from '../domain';
import type { ILogger } from '../logging/logger';
import {
  ChatTypingPayload,
  createEnvelope,
  rooms,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './events';
import type { RealtimeEventMeta } from './ports';
import type { AppSocket } from './socket-handlers';

// Mốc 6 — realtime trò chuyện (ADR-145; T-070). Tách khỏi gateway.ts (max-lines). Core không biết module chat:
// người nhận + quyền do module chat tính (port), ở đây chỉ phát tới phòng `user:{id}`.

/** Event chat server → client (trừ `chat:typing` — phát từ handler bên dưới). */
export type ChatServerEvent =
  | 'chat:message:new'
  | 'chat:message:updated'
  | 'chat:read'
  | 'chat:conversation:updated'
  | 'chat:conversation:removed';

export interface ChatEmission {
  /** Đã lọc công ty hoạt động (module chat — `recipientIds`). */
  userIds: readonly string[];
  type: ChatServerEvent;
  data: unknown;
  meta: RealtimeEventMeta;
}

/** Quyền + người nhận `chat:typing`: `null` ⇒ không có quyền với hội thoại (không phát, không báo lỗi). */
export interface IChatTypingAccess {
  recipients(conversationId: string, userId: string): Promise<readonly string[] | null>;
}

/** ADR-145 / B L1: ≤ 1 lần / 3 s / socket; quyền cache theo socket ≤ 5 s (người vừa bị bớt còn ≤ 5 s — SEC-CH-04). */
export const CHAT_TYPING_INTERVAL_MS = 3_000;
export const CHAT_TYPING_ACCESS_CACHE_MS = 5_000;
/** Trần mục cache mỗi socket (dò nhiều id hội thoại không làm phình bộ nhớ). */
const CACHE_MAX = 50;

type Io = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** MỘT lần `io.to([...])` cho mọi người nhận (ADR-145 — phòng 300 người một lệnh). */
export function emitChat(
  io: Io,
  deps: { ids: IIdGenerator; clock: IClock },
  e: ChatEmission,
): Promise<void> {
  if (e.userIds.length > 0) {
    const envelope = createEnvelope(deps, e.type, e.data, e.meta);
    io.to(e.userIds.map((id) => rooms.user(id))).emit(e.type, envelope);
  }
  return Promise.resolve();
}

/**
 * `chat:typing {conversationId}` client → server ⇒ `chat:typing {conversationId, userId}` tới người nhận khác (không
 * về chính mình). Chờ phiên được xác thực lại (`verified`); payload sai / quá nhịp / không có quyền ⇒ bỏ qua im lặng
 * (SEC-CH-19 — không ack, không lộ hội thoại có tồn tại hay không).
 */
export function registerChatTyping(
  socket: AppSocket,
  deps: {
    access: IChatTypingAccess;
    clock: IClock;
    ids: IIdGenerator;
    logger: ILogger;
    verified: Promise<boolean>;
  },
): void {
  let lastAt = Number.NEGATIVE_INFINITY;
  const cache = new Map<string, { at: number; recipients: readonly string[] | null }>();

  async function recipientsOf(conversationId: string, userId: string, now: number) {
    const hit = cache.get(conversationId);
    if (hit && now - hit.at <= CHAT_TYPING_ACCESS_CACHE_MS) return hit.recipients;
    const recipients = await deps.access
      .recipients(conversationId, userId)
      .catch((err: unknown) => {
        deps.logger.warn(
          { errName: (err as Error | undefined)?.name },
          'realtime.chat_typing_access_failed',
        );
        return null; // fail-closed
      });
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(conversationId, { at: now, recipients });
    return recipients;
  }

  socket.on('chat:typing', (payload: unknown) => {
    void (async () => {
      const parsed = ChatTypingPayload.safeParse(payload);
      if (!parsed.success || !(await deps.verified)) return;
      const now = deps.clock.now().getTime();
      if (now - lastAt < CHAT_TYPING_INTERVAL_MS) return;
      lastAt = now;
      const { userId } = socket.data;
      const { conversationId } = parsed.data;
      const recipients = await recipientsOf(conversationId, userId, now);
      const targets = (recipients ?? []).filter((id) => id !== userId);
      if (targets.length === 0) return;
      const event = createEnvelope(
        deps,
        'chat:typing',
        { conversationId, userId },
        { actorId: userId },
      );
      socket.to(targets.map((id) => rooms.user(id))).emit('chat:typing', event);
    })();
  });
}
