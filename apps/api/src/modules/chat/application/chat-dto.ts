import type {
  AttachmentDto,
  ConversationDto,
  ConversationMemberDto,
  MessageDto,
  UserRefDto,
} from '@taskflow/contracts';

import { canSend } from '../domain/chat-conversation';
import type { ConversationSummary, ParticipantRecord } from './ports/chat-conversation.port';
import type { AttachmentRecord, MessageRecord } from './ports/chat-message.port';
import type { ChatUserRef, IChatMedia, IChatUserRefs } from './ports/chat-collaborators.port';

// Dựng DTO chat từ bản ghi của repo (T-069): tên + ảnh theo lô (một lần đọc / trang), URL ảnh ký tại đây.

type Refs = ReadonlyMap<string, ChatUserRef>;

/** User luôn còn dòng (FK Restrict, xóa = ẩn danh hóa) — thiếu chỉ khi đua với purge ⇒ tên rỗng, không ảnh. */
export function refOf(refs: Refs, id: string): UserRefDto {
  const r = refs.get(id);
  return { id, fullName: r?.fullName ?? '', avatarUrl: r?.avatarUrl ?? null };
}

export function attachmentDto(a: AttachmentRecord, media: IChatMedia): AttachmentDto {
  const urls = a.kind === 'IMAGE' ? media.imageUrls(a.id) : null;
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    previewUrl: urls?.previewUrl ?? null,
    thumbUrl: urls?.thumbUrl ?? null,
  };
}

export function messageDto(m: MessageRecord, refs: Refs, media: IChatMedia): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: refOf(refs, m.senderId),
    clientMsgId: m.clientMsgId,
    body: m.body,
    replyTo: m.replyTo && {
      id: m.replyTo.id,
      sender: refOf(refs, m.replyTo.senderId),
      bodyPreview: m.replyTo.bodyPreview,
      deleted: m.replyTo.deleted,
    },
    attachments: m.attachments.map((a) => attachmentDto(a, media)),
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

export const messageUserIds = (ms: readonly MessageRecord[]): string[] =>
  ms.flatMap((m) => (m.replyTo ? [m.senderId, m.replyTo.senderId] : [m.senderId]));

/** Tin cho response / event: một tin, một lần đọc tên. */
export async function oneMessageDto(
  m: MessageRecord,
  users: IChatUserRefs,
  media: IChatMedia,
): Promise<MessageDto> {
  return messageDto(m, await users.refsOf(messageUserIds([m])), media);
}

export const summaryUserIds = (ss: readonly ConversationSummary[]): string[] =>
  ss.flatMap((s) => [s.peerId, s.lastMessage?.senderId].filter((x): x is string => !!x));

export function conversationDto(s: ConversationSummary, refs: Refs): ConversationDto {
  const c = s.conversation;
  const last = s.lastMessage;
  return {
    id: c.id,
    kind: c.kind,
    title: s.title,
    workspaceId: c.workspaceId,
    peer: s.peerId ? refOf(refs, s.peerId) : null,
    memberCount: s.memberCount,
    lastMessage: last && {
      id: last.id,
      sender: refOf(refs, last.senderId),
      bodyPreview: last.bodyPreview,
      attachmentCount: last.attachmentCount,
      deleted: last.deleted,
      createdAt: last.createdAt.toISOString(),
    },
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unread: s.unread,
    muted: s.muted,
    canSend: canSend(c.kind, s.peerActive),
    lastReadMessageId: s.lastReadMessageId,
    peerLastReadMessageId: s.peerLastReadMessageId,
    myRole: c.kind === 'GROUP' ? s.myRole : null,
  };
}

export function memberDto(p: Pick<ParticipantRecord, 'userId' | 'role' | 'joinedAt'>, refs: Refs) {
  return {
    user: refOf(refs, p.userId),
    role: p.role,
    joinedAt: p.joinedAt.toISOString(),
  } satisfies ConversationMemberDto;
}
