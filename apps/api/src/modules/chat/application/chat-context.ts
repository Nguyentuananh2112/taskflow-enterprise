import type { ConversationDetailDto } from '@taskflow/contracts';

import type { IClock, IIdGenerator } from '../../../core/domain';
import { ResourceNotFoundError } from '../../../core/errors';
import type { ILogger } from '../../../core/logging/logger';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import { conversationDto, memberDto, summaryUserIds } from './chat-dto';
import type { IChatMedia, IChatNotifier, IChatUserRefs } from './ports/chat-collaborators.port';
import type { ConversationRecord, IChatConversationStore } from './ports/chat-conversation.port';
import type {
  IChatAttachmentStore,
  IChatMessageStore,
  IChatReadStateStore,
} from './ports/chat-message.port';

/** Phụ thuộc chung của use case chat (T-069). */
export interface ChatDeps {
  conversations: IChatConversationStore;
  messages: IChatMessageStore & IChatReadStateStore;
  attachments: IChatAttachmentStore;
  users: IChatUserRefs;
  media: IChatMedia;
  notifier: IChatNotifier;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  /** Giờ NGHIỆP VỤ: "thuộc công ty hoạt động" (`access_until`), retention 12 tháng. */
  clock: IClock;
  /** Giờ THẬT: `created_at` của tin (R31), cửa sổ sửa. */
  realClock: IClock;
  logger: ILogger;
}

/** Bước sau commit lỗi không đổi kết quả — chỉ log tên lỗi (không thân tin, không tên tệp — SEC-CH-20). */
export function logAfterCommit(logger: ILogger, step: string) {
  return (err: unknown) =>
    logger.warn({ step, errName: (err as Error | undefined)?.name }, 'chat.after_commit_failed');
}

/** Hội thoại mà `userId` có quyền tại `now`; không (kể cả không tồn tại) ⇒ 404 như nhau (ADR-146). */
export async function accessibleConversation(
  d: Pick<ChatDeps, 'conversations'>,
  conversationId: string,
  userId: string,
  now: Date,
): Promise<ConversationRecord> {
  const conversation = await d.conversations.findById(conversationId);
  if (!conversation || !(await d.conversations.canAccess(conversationId, userId, now))) {
    throw new ResourceNotFoundError('conversation');
  }
  return conversation;
}

/**
 * Chi tiết theo góc nhìn `userId` (`GET chat/conversations/:id` + response của lệnh nhóm). GROUP / DIRECT: participant
 * hiệu lực; WORKSPACE: thành viên ws hiện tại (không có ngày vào phòng ⇒ `joinedAt` = lúc tạo phòng).
 */
export async function conversationDetail(
  d: Pick<ChatDeps, 'conversations' | 'users'>,
  conversationId: string,
  userId: string,
  now: Date,
): Promise<ConversationDetailDto> {
  const summary = await d.conversations.summaryFor(conversationId, userId, now);
  if (!summary) throw new ResourceNotFoundError('conversation');
  const c = summary.conversation;
  const members =
    c.kind === 'WORKSPACE'
      ? (await d.conversations.recipientIds(c.id, now)).map((id) => ({
          userId: id,
          role: 'MEMBER' as const,
          joinedAt: c.createdAt,
        }))
      : (await d.conversations.participants(c.id, now)).filter((p) => p.effective);
  const refs = await d.users.refsOf([
    ...summaryUserIds([summary]),
    ...members.map((m) => m.userId),
  ]);
  return { ...conversationDto(summary, refs), members: members.map((m) => memberDto(m, refs)) };
}
