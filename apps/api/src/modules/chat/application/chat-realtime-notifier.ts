import type { IClock } from '../../../core/domain';
import { conversationDto, summaryUserIds } from './chat-dto';
import type { IChatNotifier, IChatUserRefs } from './ports/chat-collaborators.port';
import type { ConversationSummary, IChatConversationStore } from './ports/chat-conversation.port';

/** Port phát của gateway (core) — tên event là chuỗi để module không import socket.io. */
export interface IChatEventSink {
  emitChat(e: {
    userIds: readonly string[];
    type:
      | 'chat:message:new'
      | 'chat:message:updated'
      | 'chat:read'
      | 'chat:conversation:updated'
      | 'chat:conversation:removed';
    data: unknown;
    meta: { actorId: string };
  }): Promise<void>;
}

/**
 * Realtime chat (ADR-145; T-070). Gọi SAU commit (use case dùng `afterCommit`). Người nhận tính LÚC PHÁT (giờ nghiệp
 * vụ): participant hiệu lực / thành viên ws, đã lọc công ty hoạt động ⇒ người vừa bị bớt / nghỉ việc / hết
 * `access_until` không nhận tin kế tiếp kể cả còn socket mở (SEC-CH-04/05). Không phòng theo hội thoại.
 */
export class ChatRealtimeNotifier implements IChatNotifier {
  constructor(
    private readonly d: {
      conversations: IChatConversationStore;
      users: IChatUserRefs;
      sink: IChatEventSink;
      clock: IClock;
    },
  ) {}

  async messageCreated(e: Parameters<IChatNotifier['messageCreated']>[0]): Promise<void> {
    await this.d.sink.emitChat({
      userIds: await this.#recipients(e.conversationId),
      type: 'chat:message:new',
      data: { message: e.message },
      meta: { actorId: e.actorId },
    });
  }

  async messageUpdated(e: Parameters<IChatNotifier['messageUpdated']>[0]): Promise<void> {
    await this.d.sink.emitChat({
      userIds: await this.#recipients(e.conversationId),
      type: 'chat:message:updated',
      data: { message: e.message },
      meta: { actorId: e.actorId },
    });
  }

  /** Thiết bị khác của chính mình; DIRECT: cả người kia ("Đã xem"). GROUP / WS: không lộ ai đã đọc (v1). */
  async read(e: Parameters<IChatNotifier['read']>[0]): Promise<void> {
    const c = await this.d.conversations.findById(e.conversationId);
    const recipients = c?.kind === 'DIRECT' ? await this.#recipients(e.conversationId) : [e.userId];
    await this.d.sink.emitChat({
      userIds: recipients,
      type: 'chat:read',
      data: { conversationId: e.conversationId, userId: e.userId, messageId: e.messageId },
      meta: { actorId: e.userId },
    });
  }

  /** `ConversationDto` theo GÓC NHÌN từng người (unread / muted / myRole khác nhau) ⇒ một lần phát / người. */
  async conversationUpdated(e: Parameters<IChatNotifier['conversationUpdated']>[0]) {
    const now = this.d.clock.now();
    const ids = await this.d.conversations.recipientIds(e.conversationId, now);
    const summaries = (
      await Promise.all(ids.map((id) => this.d.conversations.summaryFor(e.conversationId, id, now)))
    ).flatMap((s, i) => (s ? [[ids[i]!, s] as const] : []));
    const refs = await this.d.users.refsOf(summaryUserIds(summaries.map(([, s]) => s)));
    await Promise.all(
      summaries.map(([userId, s]: readonly [string, ConversationSummary]) =>
        this.d.sink.emitChat({
          userIds: [userId],
          type: 'chat:conversation:updated',
          data: { conversation: conversationDto(s, refs) },
          meta: { actorId: e.actorId },
        }),
      ),
    );
  }

  async conversationRemoved(e: Parameters<IChatNotifier['conversationRemoved']>[0]) {
    await this.d.sink.emitChat({
      userIds: e.userIds,
      type: 'chat:conversation:removed',
      data: { conversationId: e.conversationId },
      meta: { actorId: e.actorId },
    });
  }

  /**
   * Mất quyền workspace (bị bớt / tự rời / nghỉ việc / ws xóa mềm — TL, T-070): `removed` cho phòng chat của ws tới
   * ĐÚNG những người mất quyền. Phòng chưa từng mở ⇒ không phát. Chỉ id hội thoại — không nội dung.
   */
  async workspaceAccessLost(e: {
    workspaceId: string;
    userIds: readonly string[];
    actorId: string;
  }): Promise<void> {
    const room = await this.d.conversations.findByWorkspace(e.workspaceId);
    if (!room) return;
    await this.conversationRemoved({
      conversationId: room.id,
      userIds: e.userIds,
      actorId: e.actorId,
    });
  }

  /** `chat:typing` (port `IChatTypingAccess` của core): có quyền ⇒ người nhận; không ⇒ null. */
  async typingRecipients(conversationId: string, userId: string): Promise<string[] | null> {
    const now = this.d.clock.now();
    if (!(await this.d.conversations.canAccess(conversationId, userId, now))) return null;
    return this.d.conversations.recipientIds(conversationId, now);
  }

  #recipients(conversationId: string): Promise<string[]> {
    return this.d.conversations.recipientIds(conversationId, this.d.clock.now());
  }
}
