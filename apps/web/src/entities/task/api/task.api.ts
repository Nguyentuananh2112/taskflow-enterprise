import {
  DeleteTaskResponse,
  TaskDto,
  type AssignTaskBody,
  type CreateTaskBody,
  type MoveTaskBody,
  type UpdateTaskBody,
} from '@taskflow/contracts/task';
import * as z from 'zod';

import { http } from '@/shared/api';

// Route task (data-and-api §2.7) — response parse bằng schema contracts trong `http`.

export type TaskScope = Readonly<{ wsId: string; projectId: string }>;

const base = ({ wsId, projectId }: TaskScope) =>
  `/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/tasks`;
const one = (scope: TaskScope, taskId: string) => `${base(scope)}/${encodeURIComponent(taskId)}`;

const TaskList = z.array(TaskDto);
/** Board tải trang 500 (trần của API) và lặp theo cursor tới khi hết — thường 1 request (§3.2). */
const BOARD_PAGE = 500;
/** Chặn vòng lặp vô hạn nếu server trả cursor hỏng. */
const MAX_PAGES = 50;

export const taskApi = {
  async listAll(scope: TaskScope, signal?: AbortSignal): Promise<TaskDto[]> {
    const tasks: TaskDto[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await http.request('GET', base(scope), {
        schema: TaskList,
        query: { limit: BOARD_PAGE, cursor },
        ...(signal ? { signal } : {}),
      });
      tasks.push(...result.data);
      if (!result.page?.hasMore || !result.page.nextCursor) return tasks;
      cursor = result.page.nextCursor;
    }
    throw new Error('Board vượt quá số trang cho phép');
  },
  get: (scope: TaskScope, taskId: string) => http.get(one(scope, taskId), { schema: TaskDto }),
  create: (scope: TaskScope, body: CreateTaskBody) =>
    http.post(base(scope), { schema: TaskDto, body }),
  update: (scope: TaskScope, taskId: string, body: UpdateTaskBody) =>
    http.patch(one(scope, taskId), { schema: TaskDto, body }),
  move: (scope: TaskScope, taskId: string, body: MoveTaskBody) =>
    http.patch(`${one(scope, taskId)}/move`, { schema: TaskDto, body }),
  assign: (scope: TaskScope, taskId: string, body: AssignTaskBody) =>
    http.patch(`${one(scope, taskId)}/assignee`, { schema: TaskDto, body }),
  remove: (scope: TaskScope, taskId: string, expectedVersion: number) =>
    http.delete(one(scope, taskId), { schema: DeleteTaskResponse, query: { expectedVersion } }),
};
