import * as z from 'zod';

import { ErrorCode } from '../common/error-codes';
import { IsoDateTime, Uuid } from '../common/primitives';
import { ProjectDto } from '../project/project.schemas';
import { NotificationType } from '../hr/hr.schemas';
import { MemberGrant, WorkspaceRole } from '../rbac/permissions';
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
  memberGrantsChanged: 'member:grants-changed',
  notificationNew: 'notification:new',
} as const);

// ---------- Client → Server ----------
export const ProjectJoinPayload = z.strictObject({ workspaceId: Uuid, projectId: Uuid });
export type ProjectJoinPayload = z.infer<typeof ProjectJoinPayload>;

export const ProjectLeavePayload = z.strictObject({ projectId: Uuid });
export type ProjectLeavePayload = z.infer<typeof ProjectLeavePayload>;

export const AuthRenewPayload = z.strictObject({ token: z.string().min(1) });
export type AuthRenewPayload = z.infer<typeof AuthRenewPayload>;

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

/** ADR-119: tới `user:{id}` — web làm mới quyền ngay (REST vẫn kiểm mỗi request). Chỉ grants (SEC-HR-20). */
export const MemberGrantsChangedEvent = realtimeEnvelope(
  'member:grants-changed',
  z.object({ workspaceId: Uuid, grants: z.array(MemberGrant) }),
);
export type MemberGrantsChangedEvent = z.infer<typeof MemberGrantsChangedEvent>;

/** ADR-123: tới `user:{id}` sau commit — CHỈ id + loại (web tải lại danh sách / tăng badge). */
export const NotificationNewEvent = realtimeEnvelope(
  'notification:new',
  z.object({ notificationId: Uuid, type: NotificationType, workspaceId: Uuid }),
);
export type NotificationNewEvent = z.infer<typeof NotificationNewEvent>;

/** Generic event map cho `Server<C2S, S2C>` / `Socket<S2C, C2S>` — chỉ là type, không import socket.io. */
export type ClientToServerEvents = {
  'project:join': (payload: ProjectJoinPayload, ack: (res: SocketAck) => void) => void;
  'project:leave': (payload: ProjectLeavePayload, ack: (res: SocketAck) => void) => void;
  'auth:renew': (payload: AuthRenewPayload, ack: (res: SocketAck) => void) => void;
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
  'member:grants-changed': (event: MemberGrantsChangedEvent) => void;
  'notification:new': (event: NotificationNewEvent) => void;
};
