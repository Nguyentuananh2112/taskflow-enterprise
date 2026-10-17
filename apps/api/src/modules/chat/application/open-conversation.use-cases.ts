import type { ConversationDetailDto } from '@taskflow/contracts';

import { ResourceNotFoundError } from '../../../core/errors';
import {
  assertCanStartDirect,
  directKey,
  groupMembersForCreate,
} from '../domain/chat-conversation';
import { conversationDetail, logAfterCommit, type ChatDeps } from './chat-context';

export interface Opened {
  created: boolean;
  conversation: ConversationDetailDto;
}

/** Id không có user nào ⇒ 404 `user` (SEC-CH-15: id lạ); có nhưng không hoạt động ⇒ luật domain (422). */
async function assertUsersExist(d: ChatDeps, ids: readonly string[]): Promise<void> {
  const refs = await d.users.refsOf(ids);
  if (ids.some((id) => !refs.has(id))) throw new ResourceNotFoundError('user');
}

function notifyCreated(d: ChatDeps, conversationId: string, actorId: string): void {
  d.uow.afterCommit(() =>
    d.notifier
      .conversationUpdated({ conversationId, actorId })
      .catch(logAfterCommit(d.logger, 'conversation_updated')),
  );
}

/**
 * Tạo-hoặc-lấy (ADR-143): `POST chat/direct`, `POST chat/groups`, `PUT chat/workspaces/:wsId/conversation`. Chạy
 * trong một transaction; hai lệnh đồng thời tạo cùng DIRECT / phòng ws ⇒ một dòng (store `ON CONFLICT`).
 */
export class OpenConversationUseCases {
  constructor(private readonly d: ChatDeps) {}

  async direct(input: { actorId: string; userId: string }): Promise<Opened> {
    const now = this.d.clock.now();
    const { conversation, created } = await this.d.uow.run(async () => {
      if (input.actorId !== input.userId) await assertUsersExist(this.d, [input.userId]);
      const active = await this.d.conversations.activeUserIds([input.userId], now);
      assertCanStartDirect({
        actorId: input.actorId,
        peerId: input.userId,
        peerActive: active.has(input.userId),
      });
      const out = await this.d.conversations.getOrCreateDirect({
        id: this.d.ids.next(),
        directKey: directKey(input.actorId, input.userId),
        createdById: input.actorId,
        userIds: [input.actorId, input.userId],
        at: now,
      });
      if (out.created) notifyCreated(this.d, out.conversation.id, input.actorId);
      return out;
    });
    return { created, conversation: await this.#detail(conversation.id, input.actorId, now) };
  }

  async group(input: { actorId: string; title: string; memberIds: readonly string[] }) {
    const now = this.d.clock.now();
    const conversation = await this.d.uow.run(async () => {
      await assertUsersExist(
        this.d,
        input.memberIds.filter((id) => id !== input.actorId),
      );
      const active = await this.d.conversations.activeUserIds(input.memberIds, now);
      const memberIds = groupMembersForCreate({
        creatorId: input.actorId,
        memberIds: input.memberIds,
        inactive: new Set(input.memberIds.filter((id) => !active.has(id))),
      });
      const c = await this.d.conversations.createGroup({
        id: this.d.ids.next(),
        title: input.title,
        createdById: input.actorId,
        memberIds,
        at: now,
      });
      notifyCreated(this.d, c.id, input.actorId);
      return c;
    });
    return { created: true, conversation: await this.#detail(conversation.id, input.actorId, now) };
  }

  /** Phòng ws: thành viên ws hiện tại (mọi role kể cả VIEWER — F-03d); ws xóa mềm / lưu trữ ⇒ 404. */
  async workspace(input: { actorId: string; workspaceId: string }): Promise<Opened> {
    const now = this.d.clock.now();
    const { conversation, created } = await this.d.uow.run(async () => {
      if (!(await this.d.conversations.isWorkspaceMember(input.workspaceId, input.actorId, now))) {
        throw new ResourceNotFoundError('workspace');
      }
      return this.d.conversations.getOrCreateWorkspace({
        id: this.d.ids.next(),
        workspaceId: input.workspaceId,
        createdById: input.actorId,
        at: now,
      });
    });
    return { created, conversation: await this.#detail(conversation.id, input.actorId, now) };
  }

  #detail(conversationId: string, userId: string, now: Date) {
    return conversationDetail(this.d, conversationId, userId, now);
  }
}
