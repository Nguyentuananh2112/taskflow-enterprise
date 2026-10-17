// Port hội thoại của module chat (avatar-chat.md ADR-143/145/146; T-069a — D viết, G dùng ở use case / realtime).
// Mọi phương thức chạy trong `uow.run` của bên gọi (repository dùng `uow.db()`); `now` = giờ nghiệp vụ.
//
// "Thuộc công ty hoạt động" (G chốt 18/10, một định nghĩa cho mọi chỗ): có dòng `company_members` VÀ
// (`offboard_access_until` IS NULL OR > now) VÀ `users.password_hash` IS NOT NULL VÀ `users.deleted_at` IS NULL.
// Participant HIỆU LỰC (ADR-143):
//   - GROUP: `left_at IS NULL` VÀ `joined_at ≥ company_members.created_at` VÀ thuộc công ty hoạt động;
//   - DIRECT: có dòng participant VÀ thuộc công ty hoạt động (bỏ qua `left_at` / `joined_at` — nhận lại ⇒ DIRECT cũ
//     hiện lại, F-03g);
//   - WORKSPACE: không có participant — thành viên = `workspace_members` hiện tại của ws chưa xóa mềm / chưa lưu trữ,
//     thuộc công ty hoạt động.

import type { ChatParticipantRole, ConversationKind } from '../../domain/chat-conversation';

export type { ChatParticipantRole, ConversationKind };

export interface ConversationRecord {
  readonly id: string;
  readonly kind: ConversationKind;
  /** GROUP: tên nhóm; khác: null (WORKSPACE lấy tên ws ở summary). */
  readonly title: string | null;
  readonly directKey: string | null;
  readonly workspaceId: string | null;
  readonly createdById: string;
  readonly lastMessageAt: Date | null;
  readonly lastMessageId: string | null;
  readonly createdAt: Date;
}

export interface ParticipantRecord {
  readonly userId: string;
  readonly role: ChatParticipantRole;
  readonly joinedAt: Date;
  readonly leftAt: Date | null;
  /** Theo luật hiệu lực ở đầu file, tại `now`. */
  readonly effective: boolean;
}

/** Tin cuối cho danh sách (ConversationDto.lastMessage); `bodyPreview` ≤ 120 code point, null khi xóa / chỉ đính kèm. */
export interface LastMessageRecord {
  readonly id: string;
  readonly senderId: string;
  readonly bodyPreview: string | null;
  readonly attachmentCount: number;
  readonly deleted: boolean;
  readonly createdAt: Date;
}

/** Một dòng `GET chat/conversations` của `userId` (G dựng ConversationDto + ký URL avatar). */
export interface ConversationSummary {
  readonly conversation: ConversationRecord;
  /** GROUP: tên nhóm; WORKSPACE: tên ws; DIRECT: null. */
  readonly title: string | null;
  /** DIRECT: người kia; khác: null. */
  readonly peerId: string | null;
  /** DIRECT: người kia còn thuộc công ty hoạt động (⇒ `canSend`). Khác: true. */
  readonly peerActive: boolean;
  readonly memberCount: number;
  readonly myRole: ChatParticipantRole | null;
  readonly lastMessage: LastMessageRecord | null;
  /** Tin sau con trỏ, không phải của mình, chưa xóa — trần 99 (CHAT_UNREAD_CAP). */
  readonly unread: number;
  readonly muted: boolean;
  readonly lastReadMessageId: string | null;
  /** Chỉ DIRECT ("Đã xem"); khác: null. */
  readonly peerLastReadMessageId: string | null;
}

/**
 * Keyset danh sách hội thoại: `COALESCE(last_message_at, created_at) DESC, id DESC` — hội thoại chưa có tin đứng theo
 * lúc tạo (vừa tạo nhóm ⇒ lên đầu). `at` = giá trị COALESCE của dòng cuối trang.
 */
export interface ConversationCursor {
  readonly at: Date;
  readonly id: string;
}

export interface IChatConversationStore {
  // ---- tạo-hoặc-lấy (ON CONFLICT DO NOTHING rồi đọc — 2 lệnh đồng thời ⇒ một dòng, cả hai nhận cùng id)
  /** DIRECT `directKey` (domain `directKey(a, b)`) + 2 participant MEMBER. */
  getOrCreateDirect(input: {
    id: string;
    directKey: string;
    createdById: string;
    userIds: readonly [string, string];
    at: Date;
  }): Promise<{ conversation: ConversationRecord; created: boolean }>;
  /** WORKSPACE lười theo `workspaceId` (UNIQUE); không participant. */
  getOrCreateWorkspace(input: {
    id: string;
    workspaceId: string;
    createdById: string;
    at: Date;
  }): Promise<{ conversation: ConversationRecord; created: boolean }>;
  /** GROUP: người tạo OWNER, `memberIds` (đã khử trùng, không gồm người tạo) MEMBER. */
  createGroup(input: {
    id: string;
    title: string;
    createdById: string;
    memberIds: readonly string[];
    at: Date;
  }): Promise<ConversationRecord>;

  findById(id: string): Promise<ConversationRecord | null>;
  /**
   * Phòng WORKSPACE theo `workspace_id` (UNIQUE); chưa từng mở ⇒ null. KHÔNG xét quyền, KHÔNG xét ws xóa mềm / lưu trữ
   * (G, T-070b: ws xóa mềm vẫn phải tìm được để phát `chat:conversation:removed`).
   */
  findByWorkspace(workspaceId: string): Promise<ConversationRecord | null>;
  /** `SELECT … FOR UPDATE` dòng hội thoại — tuần tự hóa thao tác nhóm (thêm / bớt / giao OWNER / rời). */
  lock(id: string): Promise<void>;

  // ---- GROUP
  rename(id: string, title: string, at: Date): Promise<void>;
  /** Mọi dòng participant (kể cả đã rời), cờ `effective` tại `now`; sắp `joined_at, user_id`. */
  participants(conversationId: string, now: Date): Promise<ParticipantRecord[]>;
  /** Thêm mới, hoặc thêm lại (dòng cũ ⇒ `joined_at = at`, `left_at = NULL`, role MEMBER). */
  addParticipants(conversationId: string, userIds: readonly string[], at: Date): Promise<void>;
  markLeft(conversationId: string, userId: string, at: Date): Promise<void>;
  setRole(conversationId: string, userId: string, role: ChatParticipantRole): Promise<void>;

  // ---- quyền / người nhận
  /** Có quyền với hội thoại tại `now` (participant hiệu lực, hoặc thành viên ws của WORKSPACE). */
  canAccess(conversationId: string, userId: string, now: Date): Promise<boolean>;
  /** Thành viên ws chưa xóa mềm / chưa lưu trữ, thuộc công ty hoạt động (`IWorkspaceChatAccess` của G). */
  isWorkspaceMember(workspaceId: string, userId: string, now: Date): Promise<boolean>;
  /** Người nhận realtime (T-070): participant hiệu lực / thành viên ws — đã lọc công ty hoạt động. */
  recipientIds(conversationId: string, now: Date): Promise<string[]>;
  /** Thuộc công ty hoạt động (người nhận DIRECT — RECIPIENT_INACTIVE; thành viên mới của nhóm). */
  activeUserIds(userIds: readonly string[], now: Date): Promise<Set<string>>;

  // ---- danh sách / đếm
  listForUser(
    userId: string,
    now: Date,
    page: { cursor: ConversationCursor | null; limit: number },
  ): Promise<{ items: ConversationSummary[]; next: ConversationCursor | null }>;
  /** Một hội thoại theo góc nhìn `userId` (GET chi tiết, event `conversation:updated`); null ⇒ không có quyền. */
  summaryFor(
    conversationId: string,
    userId: string,
    now: Date,
  ): Promise<ConversationSummary | null>;
  /** Tổng unread cho header: bỏ hội thoại đã tắt tiếng; mỗi hội thoại trần 99. */
  unreadTotal(userId: string, now: Date): Promise<number>;

  /** `GET chat/people?q`: thuộc công ty hoạt động, ACTIVE / OFFBOARDING; khớp tên không dấu, không phân biệt hoa. */
  searchPeople(q: string, limit: number, now: Date): Promise<{ id: string; fullName: string }[]>;

  /** Sweep: ghi `left_at = now` cho participant DIRECT/GROUP của người không còn dòng `company_members`. */
  markLeftForNonMembers(now: Date, limit: number): Promise<number>;
}
