import * as z from 'zod';

import { ConversationDto, MessageDto } from '../chat/chat.schemas';
import { ErrorCode } from '../common/error-codes';
import { IsoDateTime, Uuid } from '../common/primitives';
import { ProjectDto } from '../project/project.schemas';
import { NotificationType } from '../hr/hr.schemas';
import { CompanyGrant, CompanyRole } from '../company/company-roles';
import { WorkspaceRole } from '../rbac/permissions';
import { TaskStatus } from '../task/task.constants';
import { TaskDto, TaskKey } from '../task/task.schemas';

/** Tên event Socket.io (data-and-api §4). */
export const REALTIME_EVENTS = Object.freeze({
  projectJoin: 'project:join',
  projectLeave: 'project:leave',
  authRenew: 'auth:renew',
  taskCreated: 'task:created',
  taskUpdated: 'task:updated',
  taskMoved: 'task:moved',
  taskDeleted: 'task:deleted',
  projectUpdated: 'project:updated',
  workspaceAccessRevoked: 'workspace:access-revoked',
  authExpired: 'auth:expired',
  memberRoleChanged: 'member:role-changed',
  companyAccessChanged: 'company:access-changed',
  notificationNew: 'notification:new',
  userAvatarChanged: 'user:avatar-changed',
  // Mốc 6 (ADR-145): tới `user:{id}` của từng người nhận, sau commit. `chat:typing` hai chiều.
  chatMessageNew: 'chat:message:new',
  chatMessageUpdated: 'chat:message:updated',
  chatRead: 'chat:read',
  chatConversationUpdated: 'chat:conversation:updated',
  chatConversationRemoved: 'chat:conversation:removed',
  chatTyping: 'chat:typing',
} as const);

// ---------- Client → Server ----------
export const ProjectJoinPayload = z.strictObject({ workspaceId: Uuid, projectId: Uuid });
export type ProjectJoinPayload = z.infer<typeof ProjectJoinPayload>;

export const ProjectLeavePayload = z.strictObject({ projectId: Uuid });
export type ProjectLeavePayload = z.infer<typeof ProjectLeavePayload>;

export const AuthRenewPayload = z.strictObject({ token: z.string().min(1) });
export type AuthRenewPayload = z.infer<typeof AuthRenewPayload>;

/** Mốc 6: ≤ 1 / 3 s / socket, không ack; server kiểm quyền (cache ≤ 5 s — B L1). */
export const ChatTypingPayload = z.strictObject({ conversationId: Uuid });
export type ChatTypingPayload = z.infer<typeof ChatTypingPayload>;

export const SocketAck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: ErrorCode }),
]);
export type SocketAck = z.infer<typeof SocketAck>;

// ---------- Server → Client ----------
/** Vỏ chung mọi event server phát (data-and-api §4.3). */
function realtimeEnvelope<TType extends string, TData extends z.ZodType>(type: TType, data: TData) {
  return z.object({
    eventId: Uuid,
    type: z.literal(type),
    occurredAt: IsoDateTime,
    actorId: Uuid,
    /** `X-Client-Id` của request gây ra event; KHÔNG phải thông tin xác thực (T-002 §5.2). */
    originClientId: Uuid.nullable(),
    data,
  });
}

const RankPosition = z.object({ status: TaskStatus, rank: z.string().min(1) });
const ChangedField = z.enum(['title', 'description', 'priority', 'dueDate', 'assignee']);

export const TaskCreatedEvent = realtimeEnvelope('task:created', z.object({ task: TaskDto }));
export type TaskCreatedEvent = z.infer<typeof TaskCreatedEvent>;

export const TaskUpdatedEvent = realtimeEnvelope(
  'task:updated',
  z.object({ task: TaskDto, changedFields: z.array(ChangedField).min(1) }),
);
export type TaskUpdatedEvent = z.infer<typeof TaskUpdatedEvent>;

export const TaskMovedEvent = realtimeEnvelope(
  'task:moved',
  z.object({ task: TaskDto, from: RankPosition, to: RankPosition }),
);
export type TaskMovedEvent = z.infer<typeof TaskMovedEvent>;

export const TaskDeletedEvent = realtimeEnvelope(
  'task:deleted',
  z.object({ taskId: Uuid, projectId: Uuid, key: TaskKey, version: z.int().min(1) }),
);
export type TaskDeletedEvent = z.infer<typeof TaskDeletedEvent>;

export const ProjectUpdatedEvent = realtimeEnvelope(
  'project:updated',
  z.object({ project: ProjectDto }),
);
export type ProjectUpdatedEvent = z.infer<typeof ProjectUpdatedEvent>;

export const WorkspaceAccessRevokedEvent = realtimeEnvelope(
  'workspace:access-revoked',
  z.object({ workspaceId: Uuid }),
);
export type WorkspaceAccessRevokedEvent = z.infer<typeof WorkspaceAccessRevokedEvent>;

export const AuthExpiredEvent = realtimeEnvelope('auth:expired', z.object({}));
export type AuthExpiredEvent = z.infer<typeof AuthExpiredEvent>;

export const MemberRoleChangedEvent = realtimeEnvelope(
  'member:role-changed',
  z.object({ workspaceId: Uuid, role: WorkspaceRole }),
);
export type MemberRoleChangedEvent = z.infer<typeof MemberRoleChangedEvent>;

/** Mốc 3.5 (ADR-135): tới `user:{id}` khi đổi role / grant công ty — web tải lại `/auth/me`. Chỉ role + grants. */
export const CompanyAccessChangedEventEnvelope = realtimeEnvelope(
  'company:access-changed',
  z.object({ role: CompanyRole, grants: z.array(CompanyGrant) }),
);
export type CompanyAccessChangedEventEnvelope = z.infer<typeof CompanyAccessChangedEventEnvelope>;

/** ADR-123: tới `user:{id}` sau commit — CHỈ id + loại (web tải lại danh sách / tăng badge). */
export const NotificationNewEvent = realtimeEnvelope(
  'notification:new',
  z.object({ notificationId: Uuid, type: NotificationType }),
);
export type NotificationNewEvent = z.infer<typeof NotificationNewEvent>;

/**
 * Mốc 6 (ADR-142): tới MỌI socket (một công ty, đã qua cổng công ty) — web invalidate mọi query có `UserRefDto`.
 * `avatarUrl` = variant 64; `null` = đã gỡ. Chính người đó (thiết bị khác) tải lại `/auth/me` để lấy variant 256.
 */
export const UserAvatarChangedEventDto = realtimeEnvelope(
  'user:avatar-changed',
  z.object({ userId: Uuid, avatarUrl: z.url({ protocol: /^https?$/ }).nullable() }),
);
export type UserAvatarChangedEventDto = z.infer<typeof UserAvatarChangedEventDto>;

// ---------- Mốc 6 — trò chuyện (ADR-145) ----------
/** Tin mới (đầy đủ, kèm `clientMsgId` để người gửi khử trùng — E6). */
export const ChatMessageNewEvent = realtimeEnvelope(
  'chat:message:new',
  z.object({ message: MessageDto }),
);
export type ChatMessageNewEvent = z.infer<typeof ChatMessageNewEvent>;

/** Sửa / xóa (xóa: `body` null, `attachments` rỗng, `deletedAt`). */
export const ChatMessageUpdatedEvent = realtimeEnvelope(
  'chat:message:updated',
  z.object({ message: MessageDto }),
);
export type ChatMessageUpdatedEvent = z.infer<typeof ChatMessageUpdatedEvent>;

/** Thiết bị khác của mình; DIRECT: cả người kia ("Đã xem"). */
export const ChatReadEvent = realtimeEnvelope(
  'chat:read',
  z.object({ conversationId: Uuid, userId: Uuid, messageId: Uuid }),
);
export type ChatReadEvent = z.infer<typeof ChatReadEvent>;

export const ChatConversationUpdatedEvent = realtimeEnvelope(
  'chat:conversation:updated',
  z.object({ conversation: ConversationDto }),
);
export type ChatConversationUpdatedEvent = z.infer<typeof ChatConversationUpdatedEvent>;

/** Bị bớt / rời nhóm, rời ws, ws xóa mềm ⇒ web bỏ hội thoại khỏi danh sách + cache. */
export const ChatConversationRemovedEvent = realtimeEnvelope(
  'chat:conversation:removed',
  z.object({ conversationId: Uuid }),
);
export type ChatConversationRemovedEvent = z.infer<typeof ChatConversationRemovedEvent>;

export const ChatTypingEvent = realtimeEnvelope(
  'chat:typing',
  z.object({ conversationId: Uuid, userId: Uuid }),
);
export type ChatTypingEvent = z.infer<typeof ChatTypingEvent>;

/** Generic event map cho `Server<C2S, S2C>` / `Socket<S2C, C2S>` — chỉ là type, không import socket.io. */
export type ClientToServerEvents = {
  'project:join': (payload: ProjectJoinPayload, ack: (res: SocketAck) => void) => void;
  'project:leave': (payload: ProjectLeavePayload, ack: (res: SocketAck) => void) => void;
  'auth:renew': (payload: AuthRenewPayload, ack: (res: SocketAck) => void) => void;
  'chat:typing': (payload: ChatTypingPayload) => void;
};

export type ServerToClientEvents = {
  'task:created': (event: TaskCreatedEvent) => void;
  'task:updated': (event: TaskUpdatedEvent) => void;
  'task:moved': (event: TaskMovedEvent) => void;
  'task:deleted': (event: TaskDeletedEvent) => void;
  'project:updated': (event: ProjectUpdatedEvent) => void;
  'workspace:access-revoked': (event: WorkspaceAccessRevokedEvent) => void;
  'auth:expired': (event: AuthExpiredEvent) => void;
  'member:role-changed': (event: MemberRoleChangedEvent) => void;
  'company:access-changed': (event: CompanyAccessChangedEventEnvelope) => void;
  'notification:new': (event: NotificationNewEvent) => void;
  'user:avatar-changed': (event: UserAvatarChangedEventDto) => void;
  'chat:message:new': (event: ChatMessageNewEvent) => void;
  'chat:message:updated': (event: ChatMessageUpdatedEvent) => void;
  'chat:read': (event: ChatReadEvent) => void;
  'chat:conversation:updated': (event: ChatConversationUpdatedEvent) => void;
  'chat:conversation:removed': (event: ChatConversationRemovedEvent) => void;
  'chat:typing': (event: ChatTypingEvent) => void;
};
