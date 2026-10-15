import type { TaskDto } from '@taskflow/contracts';

import type { Task } from '../domain/task';
import type { IUserRefReader, UserRef } from './ports/collaborators.port';

/** Mã hiển thị suy ra, không lưu (D7). */
export const taskKey = (keyPrefix: string, number: number): string => `${keyPrefix}-${number}`;

/** TaskDto đầy đủ (data-and-api §2.3) — đủ để FE không refetch (VERSION_CONFLICT, realtime). */
export function toTaskDto(
  task: Task,
  keyPrefix: string,
  refs: ReadonlyMap<string, UserRef>,
): TaskDto {
  const p = task.toPrimitives();
  const ref = (id: string | null) => (id === null ? null : (refs.get(id) ?? null));
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    projectId: p.projectId,
    number: p.number,
    key: taskKey(keyPrefix, p.number),
    title: p.title,
    description: p.description,
    status: p.status,
    priority: p.priority,
    rank: p.rank,
    version: p.version,
    dueDate: p.dueDate,
    assignee: ref(p.assigneeId),
    createdBy: ref(p.createdById),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function buildTaskDto(
  users: IUserRefReader,
  task: Task,
  keyPrefix: string,
): Promise<TaskDto> {
  const ids = [task.assigneeId, task.createdById].filter((id): id is string => id !== null);
  return toTaskDto(task, keyPrefix, await users.findRefs(ids));
}
