import type { ChatParticipantRole, ConversationKind } from '../../../domain/chat-conversation';
import type { AttachmentRecord } from '../../../application/ports/chat-message.port';

// Trạng thái chung của các store chat InMemory (dev / test — T-069a). Transaction của InMemoryUnitOfWork chạy TUẦN TỰ
// ⇒ `lock` là no-op; rollback bằng `snapshot/restore` (structuredClone giữ Date).

/**
 * Dữ liệu ngoài module chat mà luật "thuộc công ty hoạt động" / WORKSPACE cần — composition nối từ store company /
 * auth / workspace InMemory; test dùng `FakeChatDirectory`.
 */
export interface ChatDirectory {
  /** Dòng `company_members` (null ⇒ không thuộc công ty). */
  member(userId: string): { createdAt: Date; offboardAccessUntil: Date | null } | null;
  /** `activated` = có password_hash; `deleted` = users.deleted_at. */
  user(userId: string): { fullName: string; activated: boolean; deleted: boolean } | null;
  /** `active` = chưa xóa mềm, chưa lưu trữ. */
  workspace(workspaceId: string): { name: string; active: boolean } | null;
  workspaceMemberIds(workspaceId: string): readonly string[];
  /** Mọi user (danh bạ `searchPeople`). */
  userIds(): Iterable<string>;
}

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  title: string | null;
  directKey: string | null;
  workspaceId: string | null;
  createdById: string;
  lastMessageAt: Date | null;
  lastMessageId: string | null;
  createdAt: Date;
}

export interface ParticipantRow {
  userId: string;
  role: ChatParticipantRole;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  clientMsgId: string;
  requestHash: string;
  body: string | null;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

export interface ReadRow {
  lastReadMessageId: string | null;
  muted: boolean;
}

interface Data {
  conversations: Map<string, ConversationRow>;
  /** conversationId → userId → dòng. */
  participants: Map<string, Map<string, ParticipantRow>>;
  messages: Map<string, MessageRow>;
  /** `${conversationId}|${userId}`. */
  reads: Map<string, ReadRow>;
  attachments: Map<string, AttachmentRecord>;
}

const empty = (): Data => ({
  conversations: new Map(),
  participants: new Map(),
  messages: new Map(),
  reads: new Map(),
  attachments: new Map(),
});

export class InMemoryChatState {
  data: Data = empty();

  constructor(readonly dir: ChatDirectory) {}

  snapshot(): unknown {
    return structuredClone(this.data);
  }

  restore(snapshot: unknown): void {
    this.data = structuredClone(snapshot as Data);
  }

  /** Định nghĩa chung (G 18/10): có dòng company_members, còn hạn truy cập, đã kích hoạt, chưa xóa. */
  isActive(userId: string, now: Date): boolean {
    const m = this.dir.member(userId);
    const u = this.dir.user(userId);
    if (!m || !u || !u.activated || u.deleted) return false;
    return m.offboardAccessUntil === null || m.offboardAccessUntil > now;
  }

  /** Participant hiệu lực (ADR-143): GROUP theo left_at + joined_at ≥ company_members.created_at; DIRECT chỉ cần thuộc công ty. */
  isEffective(kind: ConversationKind, p: ParticipantRow, now: Date): boolean {
    if (!this.isActive(p.userId, now)) return false;
    if (kind === 'DIRECT') return true;
    const m = this.dir.member(p.userId)!;
    return p.leftAt === null && p.joinedAt >= m.createdAt;
  }

  participantsOf(conversationId: string): Map<string, ParticipantRow> {
    let map = this.data.participants.get(conversationId);
    if (!map) {
      map = new Map();
      this.data.participants.set(conversationId, map);
    }
    return map;
  }

  /** Người có quyền tại `now`: participant hiệu lực hoặc thành viên ws hoạt động của ws còn hoạt động. */
  accessIds(conversationId: string, now: Date): string[] {
    const c = this.data.conversations.get(conversationId);
    if (!c) return [];
    if (c.kind === 'WORKSPACE') {
      const ws = this.dir.workspace(c.workspaceId!);
      if (!ws?.active) return [];
      return this.dir.workspaceMemberIds(c.workspaceId!).filter((id) => this.isActive(id, now));
    }
    return [...this.participantsOf(conversationId).values()]
      .filter((p) => this.isEffective(c.kind, p, now))
      .map((p) => p.userId);
  }

  readKey = (conversationId: string, userId: string) => `${conversationId}|${userId}`;

  read(conversationId: string, userId: string): ReadRow {
    return (
      this.data.reads.get(this.readKey(conversationId, userId)) ?? {
        lastReadMessageId: null,
        muted: false,
      }
    );
  }
}

/** Đính kèm của một tin, theo `created_at, id`. */
export function attachmentsOf(s: InMemoryChatState, messageId: string): AttachmentRecord[] {
  return [...s.data.attachments.values()]
    .filter((a) => a.messageId === messageId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
}

export const blobKeysOf = (a: AttachmentRecord): string[] =>
  [a.fileKey, a.previewKey, a.thumbKey].filter((k): k is string => k !== null);

/** Directory dựng tay cho test. */
export class FakeChatDirectory implements ChatDirectory {
  readonly members = new Map<string, { createdAt: Date; offboardAccessUntil: Date | null }>();
  readonly users = new Map<string, { fullName: string; activated: boolean; deleted: boolean }>();
  readonly workspaces = new Map<string, { name: string; active: boolean; memberIds: string[] }>();

  member(userId: string) {
    return this.members.get(userId) ?? null;
  }
  user(userId: string) {
    return this.users.get(userId) ?? null;
  }
  workspace(workspaceId: string) {
    return this.workspaces.get(workspaceId) ?? null;
  }
  workspaceMemberIds(workspaceId: string): readonly string[] {
    return this.workspaces.get(workspaceId)?.memberIds ?? [];
  }
  userIds(): Iterable<string> {
    return this.users.keys();
  }

  /** Người thuộc công ty hoạt động, vào làm `since`. */
  hire(userId: string, fullName: string, since = new Date('2026-01-01T00:00:00Z')): this {
    this.users.set(userId, { fullName, activated: true, deleted: false });
    this.members.set(userId, { createdAt: since, offboardAccessUntil: null });
    return this;
  }
}
