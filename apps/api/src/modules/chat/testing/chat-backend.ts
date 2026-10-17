import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import type { IChatConversationStore } from '../application/ports/chat-conversation.port';
import type {
  IChatAttachmentStore,
  IChatMessageStore,
  IChatReadStateStore,
} from '../application/ports/chat-message.port';
import { InMemoryChatAttachmentStore } from '../infrastructure/persistence/in-memory/in-memory-chat-attachment.store';
import { InMemoryChatConversationStore } from '../infrastructure/persistence/in-memory/in-memory-chat-conversation.store';
import { InMemoryChatMessageStore } from '../infrastructure/persistence/in-memory/in-memory-chat-message.store';
import {
  FakeChatDirectory,
  InMemoryChatState,
} from '../infrastructure/persistence/in-memory/in-memory-chat-state';

/**
 * Hợp đồng chung cho bộ ca store chat (T-069a): cùng kịch bản chạy trên InMemory (đơn vị) và Prisma (tầng I —
 * test/integration/chat). Các hàm dựng dữ liệu ngoài module (nhân viên, nghỉ việc, ws) do backend tự làm.
 */
export interface ChatBackend {
  conversations: IChatConversationStore;
  messages: IChatMessageStore & IChatReadStateStore;
  attachments: IChatAttachmentStore;
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Nhân viên đã kích hoạt, dòng company_members tạo lúc `since`. */
  hire(userId: string, fullName: string, since: Date): Promise<void>;
  /** Tài khoản chờ kích hoạt (password_hash NULL) nhưng có dòng company_members. */
  hirePending(userId: string, fullName: string, since: Date): Promise<void>;
  /** Hoàn tất nghỉ việc: xóa dòng company_members. */
  offboard(userId: string): Promise<void>;
  /** Đang nghỉ: offboard_access_until. */
  setAccessUntil(userId: string, until: Date | null): Promise<void>;
  workspace(input: {
    id: string;
    name: string;
    memberIds: string[];
    active?: boolean;
  }): Promise<void>;
}

export function inMemoryChatBackend(): ChatBackend {
  const dir = new FakeChatDirectory();
  const state = new InMemoryChatState(dir);
  const uow = new FakeUnitOfWork(state);
  return {
    conversations: new InMemoryChatConversationStore(state),
    messages: new InMemoryChatMessageStore(state),
    attachments: new InMemoryChatAttachmentStore(state),
    run: (work) => uow.run(work),
    hire: (userId, fullName, since) => {
      dir.hire(userId, fullName, since);
      return Promise.resolve();
    },
    hirePending: (userId, fullName, since) => {
      dir.hire(userId, fullName, since);
      dir.users.set(userId, { fullName, activated: false, deleted: false });
      return Promise.resolve();
    },
    offboard: (userId) => {
      dir.members.delete(userId);
      return Promise.resolve();
    },
    setAccessUntil: (userId, until) => {
      const m = dir.members.get(userId);
      if (m) dir.members.set(userId, { ...m, offboardAccessUntil: until });
      return Promise.resolve();
    },
    workspace: ({ id, name, memberIds, active = true }) => {
      dir.workspaces.set(id, { name, active, memberIds });
      return Promise.resolve();
    },
  };
}
