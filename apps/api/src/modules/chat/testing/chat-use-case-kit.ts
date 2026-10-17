import { vi } from 'vitest';

import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import { SequentialIdGenerator } from '../../../../test/support/time-and-ids';
import type { ILogger } from '../../../core/logging/logger';
import type { ChatDeps } from '../application/chat-context';
import type {
  IChatMedia,
  IChatNotifier,
  IChatUserRefs,
} from '../application/ports/chat-collaborators.port';
import { InMemoryChatAttachmentStore } from '../infrastructure/persistence/in-memory/in-memory-chat-attachment.store';
import { InMemoryChatConversationStore } from '../infrastructure/persistence/in-memory/in-memory-chat-conversation.store';
import { InMemoryChatMessageStore } from '../infrastructure/persistence/in-memory/in-memory-chat-message.store';
import {
  FakeChatDirectory,
  InMemoryChatState,
} from '../infrastructure/persistence/in-memory/in-memory-chat-state';
import { HIRED, NOW, U } from './chat-fixtures';

// Bộ dựng cho test U use case chat (T-069, G): store InMemory của D + UoW giả có hook sau commit + fake tên / ảnh /
// URL / notifier ghi lại lời gọi.

export const urlOf = (id: string, v: string) => `https://api.test/media/chat/${id}/${v}`;

export function chatKit() {
  const dir = new FakeChatDirectory();
  const state = new InMemoryChatState(dir);
  const uow = new FakeUnitOfWork(state);
  let now = NOW;
  const clock = { now: () => now };
  const users: IChatUserRefs = {
    refsOf: (ids) =>
      Promise.resolve(
        new Map(
          [...new Set(ids)].flatMap((id) => {
            const u = dir.users.get(id);
            if (!u) return [];
            const avatarUrl = dir.members.has(id) ? `https://api.test/a/${id}` : null;
            return [[id, { id, fullName: u.fullName, avatarUrl }] as const];
          }),
        ),
      ),
  };
  const media = {
    imageUrls: (id: string) => ({ previewUrl: urlOf(id, 'preview'), thumbUrl: urlOf(id, 'thumb') }),
    downloadUrl: (id: string) => urlOf(id, 'file'),
    deleteBlobs: vi.fn<IChatMedia['deleteBlobs']>(() => Promise.resolve()),
  } satisfies IChatMedia;
  const notifier = {
    messageCreated: vi.fn<IChatNotifier['messageCreated']>(() => Promise.resolve()),
    messageUpdated: vi.fn<IChatNotifier['messageUpdated']>(() => Promise.resolve()),
    read: vi.fn<IChatNotifier['read']>(() => Promise.resolve()),
    conversationUpdated: vi.fn<IChatNotifier['conversationUpdated']>(() => Promise.resolve()),
    conversationRemoved: vi.fn<IChatNotifier['conversationRemoved']>(() => Promise.resolve()),
  } satisfies IChatNotifier;
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps: ChatDeps = {
    conversations: new InMemoryChatConversationStore(state),
    messages: new InMemoryChatMessageStore(state),
    attachments: new InMemoryChatAttachmentStore(state),
    users,
    media,
    notifier,
    uow,
    ids: new SequentialIdGenerator(),
    clock,
    realClock: clock,
    logger: logger as unknown as ILogger,
  };
  /** Mia, Vic, Lan đã kích hoạt; Pending chờ kích hoạt — vào làm `HIRED`. */
  const staff = () => {
    dir.hire(U.Mia, 'Mia Trần', HIRED).hire(U.Vic, 'Vic Lê', HIRED).hire(U.Lan, 'Lan Phạm', HIRED);
    dir.hire(U.Pending, 'Mai Chờ', HIRED);
    dir.users.set(U.Pending, { fullName: 'Mai Chờ', activated: false, deleted: false });
  };
  return {
    deps,
    dir,
    state,
    uow,
    media,
    notifier,
    logger,
    staff,
    /** Đổi "bây giờ" (cả giờ nghiệp vụ lẫn giờ thật của test). */
    setNow: (d: Date) => void (now = d),
  };
}
export type ChatKit = ReturnType<typeof chatKit>;
