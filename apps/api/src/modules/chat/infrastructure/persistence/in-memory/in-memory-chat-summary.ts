import { effectiveGroupOwners } from '../../../domain/chat-conversation';
import { bodyPreview, capUnread, compareKeyset } from '../../../domain/chat-message';
import type { ConversationSummary } from '../../../application/ports/chat-conversation.port';
import type { ConversationRow, InMemoryChatState, MessageRow } from './in-memory-chat-state';

// Dựng ConversationSummary cho InMemory (cùng nghĩa với truy vấn Prisma — LSP, test tầng I chạy lại cùng kịch bản).

/** Tin chưa đọc: sau con trỏ, không phải của mình, chưa xóa; trần 99. Con trỏ trỏ tin đã purge ⇒ đếm từ đầu. */
export function unreadOf(state: InMemoryChatState, c: ConversationRow, userId: string): number {
  const lastId = state.read(c.id, userId).lastReadMessageId;
  const cursor = lastId === null ? undefined : state.data.messages.get(lastId);
  let n = 0;
  for (const m of state.data.messages.values()) {
    if (m.conversationId !== c.id || m.senderId === userId || m.deletedAt !== null) continue;
    if (cursor && compareKeyset(m, cursor) <= 0) continue;
    n++;
  }
  return capUnread(n);
}

export async function summaryOf(
  state: InMemoryChatState,
  c: ConversationRow,
  userId: string,
  now: Date,
): Promise<ConversationSummary> {
  const parts = [...state.participantsOf(c.id).values()];
  const peer = c.kind === 'DIRECT' ? (parts.find((p) => p.userId !== userId) ?? null) : null;
  const access = await state.accessIds(c.id, now);
  let myRole: ConversationSummary['myRole'] = null;
  if (c.kind === 'GROUP') {
    const view = await Promise.all(
      parts.map(async (p) => ({ ...p, effective: await state.isEffective(c.kind, p, now) })),
    );
    myRole = effectiveGroupOwners(view).ownerIds.includes(userId) ? 'OWNER' : 'MEMBER';
  }
  const read = state.read(c.id, userId);
  const last = c.lastMessageId === null ? undefined : state.data.messages.get(c.lastMessageId);
  return {
    conversation: { ...c },
    title:
      c.kind === 'WORKSPACE'
        ? ((await state.dir.workspace(c.workspaceId!))?.name ?? null)
        : c.title,
    peerId: peer?.userId ?? null,
    peerActive: peer ? await state.isActive(peer.userId, now) : true,
    memberCount: c.kind === 'DIRECT' ? 2 : access.length,
    myRole,
    lastMessage: last ? lastMessageOf(state, last) : null,
    unread: unreadOf(state, c, userId),
    muted: read.muted,
    lastReadMessageId: read.lastReadMessageId,
    peerLastReadMessageId: peer ? state.read(c.id, peer.userId).lastReadMessageId : null,
  };
}

function lastMessageOf(
  state: InMemoryChatState,
  m: MessageRow,
): ConversationSummary['lastMessage'] {
  let attachmentCount = 0;
  for (const a of state.data.attachments.values()) if (a.messageId === m.id) attachmentCount++;
  return {
    id: m.id,
    senderId: m.senderId,
    bodyPreview: bodyPreview(m.body),
    attachmentCount,
    deleted: m.deletedAt !== null,
    createdAt: m.createdAt,
  };
}

/** Khóa sắp danh sách: COALESCE(last_message_at, created_at) DESC, id DESC. */
export const sortAt = (c: ConversationRow): Date => c.lastMessageAt ?? c.createdAt;

export function byListOrder(a: ConversationRow, b: ConversationRow): number {
  const t = sortAt(b).getTime() - sortAt(a).getTime();
  if (t !== 0) return t;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Danh bạ: thuộc công ty hoạt động, tên chứa `q` (không phân biệt hoa — ILIKE phía Prisma); sắp tên, id. */
export async function searchPeopleOf(
  state: InMemoryChatState,
  q: string,
  limit: number,
  now: Date,
): Promise<{ id: string; fullName: string }[]> {
  const needle = q.trim().toLowerCase();
  const out: { id: string; fullName: string }[] = [];
  for (const id of await state.dir.userIds()) {
    const u = await state.dir.user(id);
    if (!u || !u.fullName.toLowerCase().includes(needle) || !(await state.isActive(id, now)))
      continue;
    out.push({ id, fullName: u.fullName });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => cmp(a.fullName, b.fullName) || cmp(a.id, b.id)).slice(0, limit);
}
