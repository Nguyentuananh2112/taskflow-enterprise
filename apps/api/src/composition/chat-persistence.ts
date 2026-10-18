import type { IUserRepository } from '../modules/auth/application/ports/user-repository.port';
import type { ChatDirectory, ChatRepositories } from '../modules/chat/chat.module';
import { InMemoryChatAttachmentStore } from '../modules/chat/infrastructure/persistence/in-memory/in-memory-chat-attachment.store';
import { InMemoryChatConversationStore } from '../modules/chat/infrastructure/persistence/in-memory/in-memory-chat-conversation.store';
import { InMemoryChatMessageStore } from '../modules/chat/infrastructure/persistence/in-memory/in-memory-chat-message.store';
import { InMemoryChatState } from '../modules/chat/infrastructure/persistence/in-memory/in-memory-chat-state';
import type { DbProvider } from '../modules/chat/infrastructure/persistence/prisma/chat-db';
import { PrismaChatAttachmentStore } from '../modules/chat/infrastructure/persistence/prisma/prisma-chat-attachment.store';
import { PrismaChatConversationStore } from '../modules/chat/infrastructure/persistence/prisma/prisma-chat-conversation.store';
import { PrismaChatMessageStore } from '../modules/chat/infrastructure/persistence/prisma/prisma-chat-message.store';
import type { CompanyMemberSnapshot } from '../modules/company/domain/company-member';
import type {
  IMembershipRepository,
  IWorkspaceRepository,
} from '../modules/workspace/application/ports/repositories.port';

/**
 * `ChatDirectory` của chế độ bộ nhớ (local/test — T-069): đọc QUA API async của store company / auth / workspace
 * (TL: không đọc Map nội bộ — cùng hành vi với bản Prisma vốn JOIN bảng).
 */
export function memoryChatDirectory(d: {
  members: {
    find(userId: string): Promise<CompanyMemberSnapshot | null>;
    listAll(): Promise<CompanyMemberSnapshot[]>;
  };
  users: Pick<IUserRepository, 'findById'>;
  workspaces: Pick<IWorkspaceRepository, 'findById'>;
  memberships: Pick<IMembershipRepository, 'listUserIds'>;
}): ChatDirectory {
  return {
    async member(userId) {
      const m = await d.members.find(userId);
      return m && { createdAt: m.createdAt, offboardAccessUntil: m.offboardAccessUntil };
    },
    async user(userId) {
      const u = await d.users.findById(userId);
      if (!u) return null;
      return {
        fullName: u.fullName,
        activated: u.passwordHash !== null,
        deleted: u.toSnapshot().deletedAt !== null,
      };
    },
    async workspace(workspaceId) {
      const w = await d.workspaces.findById(workspaceId);
      return w && { name: w.name, active: !w.isDeleted && w.archivedAt === null };
    },
    workspaceMemberIds: (workspaceId) => d.memberships.listUserIds(workspaceId),
    async userIds() {
      return (await d.members.listAll()).map((m) => m.userId);
    },
  };
}

/** Store chat bộ nhớ; `state` phải được thêm vào participants của `InMemoryUnitOfWork` (rollback). */
export function memoryChatRepositories(directory: ChatDirectory): {
  repos: ChatRepositories;
  state: InMemoryChatState;
} {
  const state = new InMemoryChatState(directory);
  return {
    state,
    repos: {
      conversations: new InMemoryChatConversationStore(state),
      messages: new InMemoryChatMessageStore(state),
      attachments: new InMemoryChatAttachmentStore(state),
    },
  };
}

export function prismaChatRepositories(db: DbProvider): ChatRepositories {
  return {
    conversations: new PrismaChatConversationStore(db),
    messages: new PrismaChatMessageStore(db),
    attachments: new PrismaChatAttachmentStore(db),
  };
}
