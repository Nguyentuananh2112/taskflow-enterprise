import { AuditLogDto, ListAuditLogsQuery } from '@taskflow/contracts/audit';
import {
  CreateTaskBody,
  DeleteTaskQuery,
  DeleteTaskResponse,
  ListTasksQuery,
  TaskDto,
} from '@taskflow/contracts/task';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { MockBoard } from './mock-board';
import type { MockDb } from './mock-db';
import { fail, ok, paginate, parseBody, parseQuery } from './respond';
import { mayAssign, mayDelete, publish, resolveAssignee, versionConflict } from './task-rules';
import { archivedResponse, taskRequest, userRef } from './task-scope';
import { createTaskWriteHandlers } from './task-write-handlers';

// Route task (data-and-api §2.7): đọc, tạo, xóa, lịch sử. Sửa/move/gán ở task-write-handlers.

export function createTaskHandlers(baseUrl: string, db: MockDb, board: MockBoard): HttpHandler[] {
  const base = `${baseUrl}/workspaces/:wsId/projects/:projectId/tasks`;

  return [
    http.get(base, ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'task:read');
      if (scope.response) return scope.response;
      const query = parseQuery(request, ListTasksQuery);
      if (query.response) return query.response;
      const { status, assigneeId } = query.data;
      const tasks = board
        .listTasks(scope.ok.project.id)
        .filter((t) => !status || t.status === status)
        .filter((t) => !assigneeId || (t.assignee?.id ?? 'none') === assigneeId);
      const page = paginate(tasks, query.data.cursor, query.data.limit);
      return ok(z.array(TaskDto), page.data, { page: page.page });
    }),

    http.get(`${base}/:taskId`, ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'task:read');
      if (scope.response) return scope.response;
      return ok(TaskDto, scope.ok.task as TaskDto);
    }),

    http.post(base, async ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'task:create');
      if (scope.response) return scope.response;
      const { ctx, project, origin } = scope.ok;
      const body = await parseBody(request, CreateTaskBody);
      if (body.response) return body.response;
      const { assigneeId, ...fields } = body.data;
      if (assigneeId !== undefined && !mayAssign(ctx, null, assigneeId)) {
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'task:assign:any' });
      }
      if (project.isArchived) return archivedResponse(project);
      const assignee = assigneeId ? resolveAssignee(db, project.workspaceId, assigneeId) : null;
      if (assignee?.response) return assignee.response;
      const task = board.insertTask(project, {
        title: fields.title,
        description: fields.description ?? null,
        priority: fields.priority ?? 'MEDIUM',
        dueDate: fields.dueDate ?? null,
        assignee: assignee?.ref ?? null,
        createdBy: userRef(ctx),
      });
      board.audit(task, 'CREATED', userRef(ctx), null, {
        number: task.number,
        title: task.title,
        status: task.status,
        priority: task.priority,
        rank: task.rank,
        dueDate: task.dueDate,
        assigneeId: task.assignee?.id ?? null,
      });
      publish.created(board, origin, task);
      return ok(TaskDto, task, { status: 201 });
    }),

    http.delete(`${base}/:taskId`, ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, null);
      if (scope.response) return scope.response;
      const { ctx, project, origin } = scope.ok;
      const task = scope.ok.task as TaskDto;
      if (!mayDelete(ctx, task))
        return fail(403, 'FORBIDDEN_ACCESS', { required: 'task:delete:any' });
      if (project.isArchived) return archivedResponse(project);
      const query = parseQuery(request, DeleteTaskQuery);
      if (query.response) return query.response;
      const conflict = versionConflict(task, query.data.expectedVersion);
      if (conflict) return conflict;
      const deleted = { ...task, version: task.version + 1, updatedAt: board.iso() };
      board.saveTask(deleted, true);
      board.audit(
        deleted,
        'DELETED',
        userRef(ctx),
        { title: task.title, status: task.status },
        null,
      );
      publish.deleted(board, origin, deleted);
      return ok(DeleteTaskResponse, { id: deleted.id, version: deleted.version });
    }),

    http.get(`${base}/:taskId/audit-logs`, ({ request, params }) => {
      const scope = taskRequest(db, board, request, params, 'audit:read', true);
      if (scope.response) return scope.response;
      const query = parseQuery(request, ListAuditLogsQuery);
      if (query.response) return query.response;
      const page = paginate(
        board.auditsOf(String(params.taskId)),
        query.data.cursor,
        query.data.limit,
      );
      return ok(z.array(AuditLogDto), page.data, { page: page.page });
    }),

    ...createTaskWriteHandlers(base, db, board),
  ];
}
