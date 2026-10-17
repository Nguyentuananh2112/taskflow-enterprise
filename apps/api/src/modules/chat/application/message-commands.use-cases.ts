import type { MessageDto } from '@taskflow/contracts';

import { ResourceNotFoundError } from '../../../core/errors';
import { assertCanEdit, canDelete } from '../domain/chat-message';
import { accessibleConversation, logAfterCommit, type ChatDeps } from './chat-context';
import { oneMessageDto } from './chat-dto';
import type { MessageRecord } from './ports/chat-message.port';

export interface MessageCommandsDeps extends ChatDeps {
  /** Cửa sổ sửa (ADR-144): 15 phút; `CHAT_EDIT_WINDOW_SECONDS` chỉ ở APP_ENV=test (F-01). */
  editWindowSeconds: number;
}

/**
 * Sửa / xóa tin của CHÍNH MÌNH và con trỏ đã đọc (ADR-144/145). Tin của người khác, tin ở hội thoại không còn quyền
 * ⇒ 404 như không tồn tại (SEC-CH-16 — không 403, không lộ tin). Khóa dòng tin trước khi đọc lại (sửa ‖ xóa).
 */
export class MessageCommands {
  constructor(private readonly d: MessageCommandsDeps) {}

  async edit(input: { actorId: string; messageId: string; body: string }): Promise<MessageDto> {
    const message = await this.d.uow.run(async () => {
      await this.#own(input.actorId, input.messageId);
      const at = this.d.realClock.now();
      const locked = await this.#lockedOwn(input.actorId, input.messageId);
      // SEC-CH-16: sửa tin đã xóa ⇒ 404 (không còn gì để sửa), trước luật cửa sổ.
      if (locked.deletedAt) throw new ResourceNotFoundError('message');
      assertCanEdit(locked, input.actorId, at, this.d.editWindowSeconds);
      await this.d.messages.edit(locked.id, input.body, at);
      const updated = { ...locked, body: input.body, editedAt: at };
      this.#notifyUpdated(updated, input.actorId);
      return updated;
    });
    return oneMessageDto(message, this.d.users, this.d.media);
  }

  /** Xóa: thân NULL + dòng đính kèm xóa cùng transaction (ảnh 404 ngay — ADR-141); blob xóa SAU commit. */
  async delete(input: { actorId: string; messageId: string }): Promise<void> {
    await this.d.uow.run(async () => {
      await this.#own(input.actorId, input.messageId);
      const locked = await this.#lockedOwn(input.actorId, input.messageId);
      if (!canDelete(locked, input.actorId)) return; // đã xóa ⇒ idempotent
      const at = this.d.realClock.now();
      const removed = await this.d.messages.softDelete(locked.id, at);
      const keys = removed.flatMap((a) =>
        [a.fileKey, a.previewKey, a.thumbKey].filter((k): k is string => !!k),
      );
      this.d.uow.afterCommit(() =>
        this.d.media.deleteBlobs(keys).catch(logAfterCommit(this.d.logger, 'delete_blobs')),
      );
      this.#notifyUpdated({ ...locked, body: null, attachments: [], deletedAt: at }, input.actorId);
    });
  }

  /** `PUT …/read {messageId}`: chỉ tiến (lùi ⇒ không ghi, vẫn 204); tin không thuộc hội thoại ⇒ 404. */
  async markRead(input: { actorId: string; conversationId: string; messageId: string }) {
    await this.d.uow.run(async () => {
      const now = this.d.clock.now();
      await accessibleConversation(this.d, input.conversationId, input.actorId, now);
      const message = await this.d.messages.findById(input.messageId);
      if (message?.conversationId !== input.conversationId) {
        throw new ResourceNotFoundError('message');
      }
      const moved = await this.d.messages.advance(
        input.conversationId,
        input.actorId,
        input.messageId,
        now,
      );
      if (!moved) return;
      this.d.uow.afterCommit(() =>
        this.d.notifier
          .read({
            conversationId: input.conversationId,
            userId: input.actorId,
            messageId: input.messageId,
          })
          .catch(logAfterCommit(this.d.logger, 'read')),
      );
    });
  }

  /** Tin của `actorId` ở hội thoại họ còn quyền; khác ⇒ 404 `message`. */
  async #own(actorId: string, messageId: string): Promise<MessageRecord> {
    const message = await this.d.messages.findById(messageId);
    if (!message || message.senderId !== actorId) throw new ResourceNotFoundError('message');
    const ok = await this.d.conversations.canAccess(
      message.conversationId,
      actorId,
      this.d.clock.now(),
    );
    if (!ok) throw new ResourceNotFoundError('message');
    return message;
  }

  async #lockedOwn(actorId: string, messageId: string): Promise<MessageRecord> {
    await this.d.messages.lock(messageId);
    const fresh = await this.d.messages.findById(messageId);
    if (!fresh || fresh.senderId !== actorId) throw new ResourceNotFoundError('message');
    return fresh;
  }

  #notifyUpdated(message: MessageRecord, actorId: string): void {
    this.d.uow.afterCommit(async () => {
      const dto = await oneMessageDto(message, this.d.users, this.d.media);
      await this.d.notifier
        .messageUpdated({ conversationId: message.conversationId, message: dto, actorId })
        .catch(logAfterCommit(this.d.logger, 'message_updated'));
    });
  }
}
