import type { ConversationDetailDto } from '@taskflow/contracts';

import { ResourceNotFoundError } from '../../../core/errors';
import {
  assertCanRemove,
  assertCanTransfer,
  assertGroup,
  assertGroupOwner,
  membersToAdd,
} from '../domain/chat-conversation';
import {
  accessibleConversation,
  conversationDetail,
  logAfterCommit,
  type ChatDeps,
} from './chat-context';
import type { ParticipantRecord } from './ports/chat-conversation.port';

type GroupInput = { actorId: string; conversationId: string };

/**
 * Quản trị nhóm (ADR-143): đổi tên / thêm / bớt / giao OWNER (OWNER hiệu lực) và rời (thành viên). Thứ tự lỗi:
 * không thuộc ⇒ 404 → không phải GROUP ⇒ 422 `NOT_GROUP` → không phải OWNER ⇒ 403 → luật. Mỗi lệnh khóa dòng hội
 * thoại (tuần tự hóa OWNER rời ‖ bớt người — CC-CH-03) rồi đọc lại participant SAU khóa.
 */
export class GroupAdminUseCases {
  constructor(private readonly d: ChatDeps) {}

  rename(input: GroupInput & { title: string }): Promise<ConversationDetailDto> {
    return this.#owner(input, async (now) => {
      await this.d.conversations.rename(input.conversationId, input.title, now);
    });
  }

  addMembers(input: GroupInput & { userIds: readonly string[] }): Promise<ConversationDetailDto> {
    return this.#owner(input, async (now, participants) => {
      const refs = await this.d.users.refsOf(input.userIds);
      if (input.userIds.some((id) => !refs.has(id))) throw new ResourceNotFoundError('user');
      const active = await this.d.conversations.activeUserIds(input.userIds, now);
      const fresh = membersToAdd({
        actorId: input.actorId,
        userIds: input.userIds,
        participants,
        inactive: new Set(input.userIds.filter((id) => !active.has(id))),
      });
      if (fresh.length > 0) {
        await this.d.conversations.addParticipants(input.conversationId, fresh, now);
      }
    });
  }

  removeMember(input: GroupInput & { userId: string }): Promise<ConversationDetailDto> {
    return this.#owner(input, async (now, participants) => {
      assertCanRemove(input.actorId, input.userId, participants);
      await this.d.conversations.markLeft(input.conversationId, input.userId, now);
      this.#removed(input, [input.userId]);
    });
  }

  transferOwner(input: GroupInput & { userId: string }): Promise<ConversationDetailDto> {
    return this.#owner(input, async (_now, participants) => {
      assertCanTransfer(input.actorId, input.userId, participants);
      await this.d.conversations.setRole(input.conversationId, input.userId, 'OWNER');
      await this.d.conversations.setRole(input.conversationId, input.actorId, 'MEMBER');
    });
  }

  /** Rời: mất quyền đọc cả lịch sử ngay (ADR-143); OWNER cuối rời ⇒ người hiệu lực sớm nhất thành OWNER ngầm. */
  async leave(input: GroupInput): Promise<void> {
    await this.d.uow.run(async () => {
      const now = this.d.clock.now();
      await this.#lockedParticipants(input, now);
      await this.d.conversations.markLeft(input.conversationId, input.actorId, now);
      this.#removed(input, [input.actorId]);
      this.#updated(input);
    });
  }

  /** Tắt tiếng (cả 3 loại): chỉ ảnh hưởng tổng badge của mình. */
  async setMuted(input: GroupInput & { muted: boolean }): Promise<void> {
    await this.d.uow.run(async () => {
      const now = this.d.clock.now();
      await accessibleConversation(this.d, input.conversationId, input.actorId, now);
      await this.d.messages.setMuted(input.conversationId, input.actorId, input.muted, now);
    });
  }

  async #owner(
    input: GroupInput,
    work: (now: Date, participants: ParticipantRecord[]) => Promise<void>,
  ): Promise<ConversationDetailDto> {
    const now = this.d.clock.now();
    await this.d.uow.run(async () => {
      const participants = await this.#lockedParticipants(input, now);
      const { needsRoleWrite } = assertGroupOwner(input.actorId, participants);
      if (needsRoleWrite) {
        await this.d.conversations.setRole(input.conversationId, input.actorId, 'OWNER');
      }
      await work(now, participants);
      this.#updated(input);
    });
    return conversationDetail(this.d, input.conversationId, input.actorId, now);
  }

  async #lockedParticipants(input: GroupInput, now: Date): Promise<ParticipantRecord[]> {
    const c = await accessibleConversation(this.d, input.conversationId, input.actorId, now);
    assertGroup(c.kind);
    await this.d.conversations.lock(c.id);
    const participants = await this.d.conversations.participants(c.id, now);
    // Bị bớt giữa lần kiểm quyền và lúc khóa ⇒ như chưa từng thuộc (404, không 403).
    if (!participants.some((p) => p.userId === input.actorId && p.effective)) {
      throw new ResourceNotFoundError('conversation');
    }
    return participants;
  }

  #updated(input: GroupInput): void {
    this.d.uow.afterCommit(() =>
      this.d.notifier
        .conversationUpdated({ conversationId: input.conversationId, actorId: input.actorId })
        .catch(logAfterCommit(this.d.logger, 'conversation_updated')),
    );
  }

  #removed(input: GroupInput, userIds: string[]): void {
    this.d.uow.afterCommit(() =>
      this.d.notifier
        .conversationRemoved({
          conversationId: input.conversationId,
          userIds,
          actorId: input.actorId,
        })
        .catch(logAfterCommit(this.d.logger, 'conversation_removed')),
    );
  }
}
