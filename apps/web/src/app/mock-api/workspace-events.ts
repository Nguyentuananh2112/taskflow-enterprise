import {
  MemberRoleChangedEvent,
  ProjectUpdatedEvent,
  WorkspaceAccessRevokedEvent,
} from '@taskflow/contracts/realtime';
import type { ProjectDto } from '@taskflow/contracts/project';
import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import type { TaskDto } from '@taskflow/contracts/task';

import type { MockBoard } from './mock-board';
import { publish } from './task-rules';

// Event realtime cấp workspace của mock (data-and-api §4.3, security.md §5.4) — phát SAU khi ghi.

export type Origin = Readonly<{ actorId: string; originClientId: string | null }>;

const envelope = (board: MockBoard, type: string, origin: Origin, data: unknown) => ({
  eventId: crypto.randomUUID(),
  type,
  occurredAt: board.iso(),
  actorId: origin.actorId,
  originClientId: origin.originClientId,
  data,
});

/** Phòng riêng của user (server tự join khi connect). */
export const userRoom = (userId: string) => `user:${userId}`;

export function accessRevoked(
  board: MockBoard,
  origin: Origin,
  workspaceId: string,
  userIds: readonly string[],
): void {
  for (const userId of userIds) {
    board.publish({
      room: userRoom(userId),
      name: 'workspace:access-revoked',
      payload: WorkspaceAccessRevokedEvent.parse(
        envelope(board, 'workspace:access-revoked', origin, { workspaceId }),
      ),
    });
  }
}

export function roleChanged(
  board: MockBoard,
  origin: Origin,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): void {
  board.publish({
    room: userRoom(userId),
    name: 'member:role-changed',
    payload: MemberRoleChangedEvent.parse(
      envelope(board, 'member:role-changed', origin, { workspaceId, role }),
    ),
  });
}

export function projectUpdated(board: MockBoard, origin: Origin, project: ProjectDto): void {
  board.publish({
    room: project.id,
    name: 'project:updated',
    payload: ProjectUpdatedEvent.parse(envelope(board, 'project:updated', origin, { project })),
  });
}

/**
 * ADR-044 / R14: bỏ gán mọi task của `userId` trong workspace (xóa thành viên, tự rời, hạ VIEWER) —
 * kể cả project lưu trữ (ADR-092). Mỗi task: version+1, audit, `task:updated`. Trả số task bị bỏ gán.
 */
export function unassignAll(
  board: MockBoard,
  origin: Origin,
  actor: { id: string; fullName: string },
  workspaceId: string,
  userId: string,
): number {
  let count = 0;
  for (const project of board.listProjects(workspaceId, 'all')) {
    for (const task of board.listTasks(project.id)) {
      if (task.assignee?.id !== userId) continue;
      const next: TaskDto = {
        ...task,
        assignee: null,
        version: task.version + 1,
        updatedAt: board.iso(),
      };
      board.saveTask(next);
      board.audit(next, 'ASSIGNEE_CHANGED', actor, { assigneeId: userId }, { assigneeId: null });
      publish.updated(board, origin, next, ['assignee']);
      count += 1;
    }
  }
  return count;
}
