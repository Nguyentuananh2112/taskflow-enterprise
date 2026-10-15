import {
  AssignTaskBody,
  MoveTaskBody,
  TASK_STATUS_TRANSITIONS,
  TaskDto,
  UpdateTaskBody,
} from '@taskflow/contracts/task';
import { http, type HttpHandler } from 'msw';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { fail, ok, parseBody } from './respond';
import {
  canTransition,
  mayAssign,
  publish,
  rankFor,
  resolveAssignee,
  versionConflict,
} from './task-rules';
import { archivedResponse, taskRequest, userRef } from './task-scope';

// PATCH task / move / assignee. Thứ tự: 404 → 403 → 400 body → 422 → 409 (version kiểm TRƯỚC no-op,
// ADR-091) → no-op trả 200 không tăng version (R15) → ghi + audit + event.

const FIELDS = ['title', 'description', 'priority', 'dueDate'] as const;

export function createTaskWriteHandlers(base: string, db: MockDb, board: MockBoard): HttpHandler[] {
  return [
    http.patch(`${base}/:taskId`, async ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'task:update');
      if (scope.response) return scope.response;
      const { ctx, project, origin } = scope.ok;
      const task = scope.ok.task as TaskDto;
      const body = await parseBody(request, UpdateTaskBody);
      if (body.response) return body.response;
      if (project.isArchived) return archivedResponse(project);
      const conflict = versionConflict(task, body.data.expectedVersion);
      if (conflict) return conflict;
      const changed = FIELDS.filter((f) => body.data[f] !== undefined && body.data[f] !== task[f]);
      if (changed.length === 0) return ok(TaskDto, task);
      const next: TaskDto = { ...task, version: task.version + 1, updatedAt: board.iso() };
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};
      for (const f of changed) {
        Object.assign(next, { [f]: body.data[f] });
        // ADR-040: không lưu nội dung mô tả trong audit.
        oldValue[f] = f === 'description' ? { changed: true } : task[f];
        newValue[f] =
          f === 'description' ? { changed: true, length: next.description?.length ?? 0 } : next[f];
      }
      board.saveTask(next);
      board.audit(next, 'UPDATED', userRef(ctx), oldValue, newValue);
      publish.updated(board, origin, next, [...changed]);
      return ok(TaskDto, next);
    }),

    http.patch(`${base}/:taskId/move`, async ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'task:move');
      if (scope.response) return scope.response;
      const { ctx, project, origin } = scope.ok;
      const task = scope.ok.task as TaskDto;
      const body = await parseBody(request, MoveTaskBody);
      if (body.response) return body.response;
      if (project.isArchived) return archivedResponse(project);
      const to = body.data.status ?? task.status;
      if (!canTransition(task.status, to)) {
        return fail(422, 'INVALID_STATUS_TRANSITION', {
          from: task.status,
          to,
          allowed: [...TASK_STATUS_TRANSITIONS[task.status]],
        });
      }
      const column = board.column(project.id, to, task.id);
      const { afterId, beforeId } = body.data;
      const rank = rankFor(column, afterId, beforeId);
      if (rank === null) return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'INVALID_ANCHOR' });
      const conflict = versionConflict(task, body.data.expectedVersion);
      if (conflict) return conflict;
      // No-op: cùng cột và hàng xóm hiện tại đúng như anchor gửi lên (R15).
      const current = board.column(project.id, to);
      const index = current.findIndex((t) => t.id === task.id);
      const sameSpot =
        to === task.status &&
        (afterId ?? null) === (current[index - 1]?.id ?? null) &&
        (beforeId === undefined || beforeId === (current[index + 1]?.id ?? null));
      if (sameSpot) return ok(TaskDto, task);
      const next: TaskDto = {
        ...task,
        status: to,
        rank,
        version: task.version + 1,
        updatedAt: board.iso(),
      };
      board.saveTask(next);
      const action = to === task.status ? 'MOVED' : 'STATUS_CHANGED';
      board.audit(
        next,
        action,
        userRef(ctx),
        action === 'MOVED' ? { rank: task.rank } : { status: task.status, rank: task.rank },
        action === 'MOVED' ? { rank } : { status: to, rank },
      );
      publish.moved(board, origin, task, next);
      return ok(TaskDto, next);
    }),

    http.patch(`${base}/:taskId/assignee`, async ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, null);
      if (scope.response) return scope.response;
      const { ctx, project, origin } = scope.ok;
      const task = scope.ok.task as TaskDto;
      const body = await parseBody(request, AssignTaskBody);
      if (body.response) return body.response;
      if (!mayAssign(ctx, task, body.data.assigneeId)) {
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'task:assign:any' });
      }
      if (project.isArchived) return archivedResponse(project);
      const assignee = body.data.assigneeId
        ? resolveAssignee(db, project.workspaceId, body.data.assigneeId)
        : null;
      if (assignee?.response) return assignee.response;
      const conflict = versionConflict(task, body.data.expectedVersion);
      if (conflict) return conflict;
      if ((task.assignee?.id ?? null) === body.data.assigneeId) return ok(TaskDto, task);
      const next: TaskDto = {
        ...task,
        assignee: assignee?.ref ?? null,
        version: task.version + 1,
        updatedAt: board.iso(),
      };
      board.saveTask(next);
      board.audit(
        next,
        'ASSIGNEE_CHANGED',
        userRef(ctx),
        { assigneeId: task.assignee?.id ?? null },
        { assigneeId: next.assignee?.id ?? null },
      );
      publish.updated(board, origin, next, ['assignee']);
      return ok(TaskDto, next);
    }),
  ];
}
