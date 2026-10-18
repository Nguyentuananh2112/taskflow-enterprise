import type { MessageDto } from '@taskflow/contracts';

import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../core/errors';
import {
  assertAttachmentCount,
  assertReplyInConversation,
  assertSameRequest,
  requestHash,
} from '../domain/chat-message';
import { accessibleConversation, logAfterCommit, type ChatDeps } from './chat-context';
import { oneMessageDto } from './chat-dto';
import type { ConversationRecord } from './ports/chat-conversation.port';
import type { MessageRecord } from './ports/chat-message.port';

export interface SendMessageInput {
  actorId: string;
  conversationId: string;
  clientMsgId: string;
  /** Đã chuẩn hóa (contracts `ChatBody`); rỗng ⇒ chỉ đính kèm. */
  body?: string | undefined;
  replyToId?: string | undefined;
  attachmentIds: readonly string[];
}

/**
 * `POST chat/conversations/:id/messages` (ADR-144). Idempotent theo `(sender, clientMsgId)`: gửi lại GIỐNG ⇒ tin cũ,
 * `created: false`, không event; KHÁC ⇒ 422 `IDEMPOTENCY_KEY_REUSED`. Upload được khóa `FOR UPDATE` khi gắn
 * (CC-CH-06); thiếu ⇒ tra trùng LẦN NỮA (lệnh song song cùng `clientMsgId` vừa commit — CC-CH-01) rồi mới 404.
 */
export class SendMessageUseCase {
  constructor(private readonly d: ChatDeps) {}

  async execute(input: SendMessageInput): Promise<{ created: boolean; message: MessageDto }> {
    const now = this.d.clock.now();
    const body = input.body ? input.body : null;
    const hash = requestHash({
      conversationId: input.conversationId,
      body,
      attachmentIds: input.attachmentIds,
    });
    const { created, message } = await this.d.uow.run(async () => {
      const conversation = await accessibleConversation(
        this.d,
        input.conversationId,
        input.actorId,
        now,
      );
      const replay = await this.#replay(input, hash);
      if (replay) return replay;
      await this.#assertCanSend(conversation, input.actorId, now);
      assertAttachmentCount(input.attachmentIds.length);
      if (input.replyToId) {
        const reply = await this.d.messages.findById(input.replyToId);
        if (!reply) throw new ResourceNotFoundError('message');
        assertReplyInConversation(reply.conversationId, conversation.id);
      }
      const claimed = await this.d.attachments.claimableUploads(input.attachmentIds, input.actorId);
      if (claimed.length !== new Set(input.attachmentIds).size) {
        const late = await this.#replay(input, hash);
        if (late) return late;
        throw new ResourceNotFoundError('attachment');
      }
      const out = await this.d.messages.insert({
        id: this.d.ids.next(),
        conversationId: conversation.id,
        senderId: input.actorId,
        clientMsgId: input.clientMsgId,
        requestHash: hash,
        body,
        replyToId: input.replyToId ?? null,
        attachmentIds: input.attachmentIds,
        at: this.d.realClock.now(),
      });
      if (!out.created) {
        assertSameRequest(out.message.requestHash, hash);
        return out;
      }
      await this.d.messages.advance(conversation.id, input.actorId, out.message.id, now);
      this.#notifyCreated(out.message, input.actorId);
      return out;
    });
    return { created, message: await oneMessageDto(message, this.d.users, this.d.media) };
  }

  /** Sau commit của transaction NGOÀI CÙNG (B L2 T-068); lỗi chỉ log. */
  #notifyCreated(message: MessageRecord, actorId: string): void {
    this.d.uow.afterCommit(async () => {
      const dto = await oneMessageDto(message, this.d.users, this.d.media);
      await this.d.notifier
        .messageCreated({ conversationId: message.conversationId, message: dto, actorId })
        .catch(logAfterCommit(this.d.logger, 'message_created'));
    });
  }

  /** Đã có tin cùng `clientMsgId` của người gửi ⇒ cùng nội dung: trả tin cũ; khác: 422. */
  async #replay(
    input: SendMessageInput,
    hash: string,
  ): Promise<{ created: false; message: MessageRecord } | null> {
    const existing = await this.d.messages.findByClientMsgId(input.actorId, input.clientMsgId);
    if (!existing) return null;
    assertSameRequest(existing.requestHash, hash);
    return { created: false, message: existing };
  }

  /** DIRECT: người kia phải còn thuộc công ty hoạt động (đã nghỉ ⇒ chỉ đọc lịch sử). GROUP / WS: luôn gửi được. */
  async #assertCanSend(c: ConversationRecord, actorId: string, now: Date): Promise<void> {
    if (c.kind !== 'DIRECT') return;
    const peer = (await this.d.conversations.participants(c.id, now)).find(
      (p) => p.userId !== actorId,
    );
    const active = peer ? await this.d.conversations.activeUserIds([peer.userId], now) : new Set();
    if (!peer || !active.has(peer.userId)) {
      throw new BusinessRuleViolationError(
        'RECIPIENT_INACTIVE',
        'Người nhận đã rời công ty — chỉ xem được lịch sử.',
      );
    }
  }
}
