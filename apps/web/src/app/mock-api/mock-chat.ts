import {
  CHAT_UNREAD_CAP,
  type ConversationDetailDto,
  type ConversationDto,
  type ConversationKind,
  type ChatParticipantRole,
  type MessagePreviewDto,
} from '@taskflow/contracts/chat';
import type { UserRefDto } from '@taskflow/contracts/auth';

import type { MockDb } from './mock-db';
import { MockChatMessages, type StoredMessage } from './mock-chat-messages';

// Trò chuyện của mock API (avatar-chat.md ADR-143…145). Hội thoại + người tham gia + con trỏ đọc; tin nhắn / tệp ở
// MockChatMessages. KHÔNG phát event realtime (parity (c): server phát ở T-070) — test web tự phát qua socket giả.

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  workspaceId: string | null;
  directKey: string | null;
  createdAt: string;
};
type Participant = { role: ChatParticipantRole; joinedAt: string; leftAt: string | null };
type ReadState = { lastReadId: string | null; muted: boolean };

export class MockChat {
  readonly conversations = new Map<string, Conversation>();
  private readonly participants = new Map<string, Map<string, Participant>>();
  private readonly reads = new Map<string, ReadState>();
  readonly messages: MockChatMessages;

  constructor(
    private readonly db: MockDb,
    baseUrl: string,
    readonly now: () => number,
  ) {
    this.messages = new MockChatMessages(baseUrl, now);
  }

  iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Thuộc công ty HOẠT ĐỘNG: có dòng công ty + đã kích hoạt (ADR-143). */
  activeInCompany(userId: string): boolean {
    const user = this.db.getUser(userId);
    return Boolean(user && user.password !== '' && this.db.company.row(userId));
  }

  userRef(userId: string): UserRefDto {
    const user = this.db.getUser(userId);
    const avatarUrl = this.activeInCompany(userId) ? this.db.company.avatarOf(userId) : null;
    return { id: userId, fullName: user?.fullName ?? '?', ...(avatarUrl ? { avatarUrl } : {}) };
  }

  /** Người tham gia HIỆU LỰC (DIRECT / GROUP) hoặc thành viên ws hiện tại (WORKSPACE) — tính lúc đọc. */
  memberIds(conv: Conversation): string[] {
    if (conv.kind === 'WORKSPACE') {
      const wsId = conv.workspaceId ?? '';
      if (!this.db.workspaces.active(wsId)) return [];
      return this.db.workspaces
        .membersOf(wsId)
        .map((m) => m.userId)
        .filter((id) => this.activeInCompany(id));
    }
    return (
      [...(this.participants.get(conv.id) ?? new Map<string, Participant>())]
        // Hiệu lực chỉ khi vào nhóm SAU lần vào công ty hiện tại ⇒ nhận lại không tự có lại nhóm cũ (ADR-143, F-03g).
        .filter(
          ([id, p]) =>
            p.leftAt === null && this.activeInCompany(id) && p.joinedAt >= this.joinedCompanyAt(id),
        )
        .map(([id]) => id)
    );
  }

  private joinedCompanyAt(userId: string): string {
    return this.db.company.row(userId)?.joinedAt ?? '';
  }

  isMember(conv: Conversation, userId: string): boolean {
    return this.memberIds(conv).includes(userId);
  }

  /** DIRECT: người đã nghỉ vẫn đọc được lịch sử của chính DIRECT đó (không gửi). */
  canRead(conv: Conversation, userId: string): boolean {
    if (conv.kind === 'DIRECT') {
      return this.activeInCompany(userId) && this.participants.get(conv.id)?.has(userId) === true;
    }
    return this.isMember(conv, userId);
  }

  addParticipant(convId: string, userId: string, role: ChatParticipantRole): void {
    const map = this.participants.get(convId) ?? new Map<string, Participant>();
    map.set(userId, { role, joinedAt: this.iso(), leftAt: null });
    this.participants.set(convId, map);
  }

  removeParticipant(convId: string, userId: string): void {
    const p = this.participants.get(convId)?.get(userId);
    if (p) p.leftAt = this.iso();
  }

  roleOf(conv: Conversation, userId: string): ChatParticipantRole | null {
    if (conv.kind !== 'GROUP' || !this.isMember(conv, userId)) return null;
    if (this.roleRaw(conv.id, userId) === 'OWNER') return 'OWNER';
    // Không còn OWNER hiệu lực ⇒ người tham gia sớm nhất là OWNER (ADR-143 effectiveGroupOwners).
    const members = this.memberIds(conv);
    const hasOwner = members.some((id) => this.roleRaw(conv.id, id) === 'OWNER');
    return !hasOwner && members[0] === userId ? 'OWNER' : 'MEMBER';
  }

  setRole(convId: string, userId: string, role: ChatParticipantRole): void {
    const p = this.participants.get(convId)?.get(userId);
    if (p) p.role = role;
  }

  private roleRaw(convId: string, userId: string): ChatParticipantRole | undefined {
    return this.participants.get(convId)?.get(userId)?.role;
  }

  create(kind: ConversationKind, fields: Partial<Conversation> = {}): Conversation {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      kind,
      title: null,
      workspaceId: null,
      directKey: null,
      createdAt: this.iso(),
      ...fields,
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  private read(convId: string, userId: string): ReadState {
    const key = `${convId}:${userId}`;
    const state = this.reads.get(key) ?? { lastReadId: null, muted: false };
    this.reads.set(key, state);
    return state;
  }

  /** Con trỏ đọc chỉ tiến (CH-06). */
  markRead(convId: string, userId: string, messageId: string): void {
    const state = this.read(convId, userId);
    const list = this.messages.of(convId);
    const at = (id: string | null) => (id ? list.findIndex((m) => m.id === id) : -1);
    if (at(messageId) > at(state.lastReadId)) state.lastReadId = messageId;
  }

  setMuted(convId: string, userId: string, muted: boolean): void {
    this.read(convId, userId).muted = muted;
  }

  unread(convId: string, userId: string): number {
    const list = this.messages.of(convId);
    const lastRead = this.read(convId, userId).lastReadId;
    const from = lastRead ? list.findIndex((m) => m.id === lastRead) + 1 : 0;
    const count = list.slice(from).filter((m) => m.senderId !== userId && !m.deletedAt).length;
    return Math.min(count, CHAT_UNREAD_CAP);
  }

  /** Hội thoại người này thấy, mới nhất trước (keyset `last_message_at desc, id`). */
  listFor(userId: string): Conversation[] {
    const lastAt = (c: Conversation) => this.messages.last(c.id)?.createdAt ?? c.createdAt;
    return [...this.conversations.values()]
      .filter((c) => this.canRead(c, userId))
      .sort((a, b) => lastAt(b).localeCompare(lastAt(a)) || b.id.localeCompare(a.id));
  }

  preview(message: StoredMessage | undefined): MessagePreviewDto | null {
    if (!message) return null;
    return {
      id: message.id,
      sender: this.userRef(message.senderId),
      bodyPreview: message.body === null ? null : [...message.body].slice(0, 120).join(''),
      attachmentCount: message.attachmentIds.length,
      deleted: message.deletedAt !== null,
      createdAt: message.createdAt,
    };
  }

  toDto(conv: Conversation, viewerId: string): ConversationDto {
    const members = this.memberIds(conv);
    const peerId =
      conv.kind === 'DIRECT'
        ? [...(this.participants.get(conv.id)?.keys() ?? [])].find((id) => id !== viewerId)
        : undefined;
    const last = this.messages.last(conv.id);
    return {
      id: conv.id,
      kind: conv.kind,
      title:
        conv.kind === 'WORKSPACE'
          ? (this.db.workspaces.active(conv.workspaceId ?? '')?.name ?? null)
          : conv.title,
      workspaceId: conv.workspaceId,
      peer: peerId ? this.userRef(peerId) : null,
      memberCount: conv.kind === 'DIRECT' ? 2 : members.length,
      lastMessage: this.preview(last),
      lastMessageAt: last?.createdAt ?? null,
      unread: this.unread(conv.id, viewerId),
      lastReadMessageId: this.read(conv.id, viewerId).lastReadId,
      // DIRECT: con trỏ của người kia ("Đã xem"); nhóm / phòng ws: null (v1).
      peerLastReadMessageId: peerId ? this.read(conv.id, peerId).lastReadId : null,
      muted: this.read(conv.id, viewerId).muted,
      // DIRECT: người kia đã nghỉ / chờ kích hoạt ⇒ chỉ đọc (ADR-143).
      canSend: conv.kind === 'DIRECT' ? Boolean(peerId && this.activeInCompany(peerId)) : true,
      myRole: this.roleOf(conv, viewerId),
    };
  }

  toDetail(conv: Conversation, viewerId: string): ConversationDetailDto {
    // DIRECT (G 18/10, server T-069): đủ người tham gia còn ở công ty — người kia đã nghỉ ⇒ chỉ còn 1. Không xét
    // `joinedAt` như nhóm: DIRECT cũ hiện lại cho người được nhận lại (F-03g).
    const ids =
      conv.kind === 'DIRECT'
        ? [...(this.participants.get(conv.id)?.keys() ?? [])].filter((id) =>
            this.activeInCompany(id),
          )
        : this.memberIds(conv);
    const members = ids.map((id) => ({
      user: this.userRef(id),
      role: this.roleOf(conv, id) ?? ('MEMBER' as const),
      joinedAt: this.participants.get(conv.id)?.get(id)?.joinedAt ?? conv.createdAt,
    }));
    return { ...this.toDto(conv, viewerId), members };
  }
}
