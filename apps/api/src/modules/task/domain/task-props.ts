import type { UpdatableValues } from './task-events';
import type { TaskPriority, TaskStatus } from './task-status';

/** Trạng thái lưu trữ (repository map sang/từ đây). `dueDate` là ngày thuần `YYYY-MM-DD` (D10). */
export interface TaskProps {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  rank: string;
  version: number;
  dueDate: string | null;
  assigneeId: string | null;
  createdById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskProps {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
  rank: string;
  createdById: string;
  now: Date;
}

export type TaskChanges = UpdatableValues;
