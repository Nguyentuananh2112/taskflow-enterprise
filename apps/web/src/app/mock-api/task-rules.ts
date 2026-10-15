import { ROLE_RANK, roleHasPermission as can } from '@taskflow/contracts/rbac';
import {
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskUpdatedEvent,
} from '@taskflow/contracts/realtime';
import { TASK_STATUS_TRANSITIONS, type TaskDto, type TaskStatus } from '@taskflow/contracts/task';
import { generateKeyBetween } from 'fractional-indexing';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import type { MemberContext } from './mock-guard';
import { fail } from './respond';

// Luật task của mock — viết ĐỘC LẬP với policy phía FE (entities/task/model/policy.ts) để test bắt
// được chỗ FE hiểu sai luật server (data-and-api §6.2, ADR-041/044/045).

/** R7 (ADR-041): ai được đổi assignee của `task` thành `targetId`. */
export function mayAssign(ctx: MemberContext, task: TaskDto | null, targetId: string | null) {
  const { role } = ctx.membership;
  const me = ctx.user.id;
  if (can(role, 'task:assign:any')) return true;
  if (!can(role, 'task:assign:own')) return false;
  if (task === null) return targetId === null || targetId === me; // lúc tạo
  if (task.createdBy?.id === me) return true;
  if (task.assignee === null) return targetId === me;
  return task.assignee.id === me && targetId === null;
}

/** R9 (ADR-022). */
export function mayDelete(ctx: MemberContext, task: TaskDto) {
  const { role } = ctx.membership;
  if (can(role, 'task:delete:any')) return true;
  return can(role, 'task:delete:own') && task.createdBy?.id === ctx.user.id;
}

/** R6 (ADR-044): người nhận là thành viên hiện tại, role ≥ MEMBER. Trả UserRef hoặc response 422. */
export function resolveAssignee(db: MockDb, workspaceId: string, assigneeId: string) {
  const member = db.membersOf(workspaceId).find(({ user }) => user.id === assigneeId);
  if (!member || ROLE_RANK[member.membership.role] < ROLE_RANK.MEMBER) {
    return { response: fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'ASSIGNEE_NOT_MEMBER' }) };
  }
  return { ref: { id: member.user.id, fullName: member.user.fullName } };
}

/** R10 + ADR-091: version kiểm TRƯỚC no-op. */
export function versionConflict(task: TaskDto, expectedVersion: number | undefined) {
  if (expectedVersion === undefined || expectedVersion === task.version) return null;
  return fail(409, 'VERSION_CONFLICT', { currentVersion: task.version, current: task });
}

export function canTransition(from: TaskStatus, to: TaskStatus) {
  return from === to || TASK_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Rank mới từ hàng xóm THẬT trong DB (ADR-011): có `afterId` ⇒ giữa nó và task kế tiếp thực tế; có
 * `beforeId` ⇒ giữa task liền trước thực tế và nó; không có ⇒ cuối cột. Anchor sai ⇒ null (INVALID_ANCHOR).
 */
export function rankFor(
  column: readonly TaskDto[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
): string | null {
  const indexOf = (id: string) => column.findIndex((t) => t.id === id);
  if (afterId) {
    const i = indexOf(afterId);
    if (i < 0 || (beforeId && indexOf(beforeId) < 0)) return null;
    return generateKeyBetween(column[i]?.rank ?? null, column[i + 1]?.rank ?? null);
  }
  if (beforeId) {
    const i = indexOf(beforeId);
    if (i < 0) return null;
    return generateKeyBetween(column[i - 1]?.rank ?? null, column[i]?.rank ?? null);
  }
  return generateKeyBetween(column.at(-1)?.rank ?? null, null);
}

type Origin = Readonly<{ actorId: string; originClientId: string | null }>;

const envelope = (board: MockBoard, type: string, origin: Origin, data: unknown) => ({
  eventId: crypto.randomUUID(),
  type,
  occurredAt: board.iso(),
  actorId: origin.actorId,
  originClientId: origin.originClientId,
  data,
});

/** Phát event sau "commit" (ADR-012) — payload parse bằng schema contracts. */
export const publish = {
  created: (board: MockBoard, origin: Origin, task: TaskDto) =>
    board.publish({
      room: task.projectId,
      name: 'task:created',
      payload: TaskCreatedEvent.parse(envelope(board, 'task:created', origin, { task })),
    }),
  updated: (board: MockBoard, origin: Origin, task: TaskDto, changedFields: string[]) =>
    board.publish({
      room: task.projectId,
      name: 'task:updated',
      payload: TaskUpdatedEvent.parse(
        envelope(board, 'task:updated', origin, { task, changedFields }),
      ),
    }),
  moved: (board: MockBoard, origin: Origin, before: TaskDto, task: TaskDto) =>
    board.publish({
      room: task.projectId,
      name: 'task:moved',
      payload: TaskMovedEvent.parse(
        envelope(board, 'task:moved', origin, {
          task,
          from: { status: before.status, rank: before.rank },
          to: { status: task.status, rank: task.rank },
        }),
      ),
    }),
  deleted: (board: MockBoard, origin: Origin, task: TaskDto) =>
    board.publish({
      room: task.projectId,
      name: 'task:deleted',
      payload: TaskDeletedEvent.parse(
        envelope(board, 'task:deleted', origin, {
          taskId: task.id,
          projectId: task.projectId,
          key: task.key,
          version: task.version,
        }),
      ),
    }),
};
