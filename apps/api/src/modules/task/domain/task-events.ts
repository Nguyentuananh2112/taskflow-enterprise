import type { IDomainEvent } from '../../../core/domain';
import type { TaskPriority, TaskStatus } from './task-status';

/** Trường chung: đủ để application ghi audit + định tuyến realtime mà không đọc lại entity. */
interface TaskEventBase extends IDomainEvent {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface TaskCreatedSnapshot {
  number: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  rank: string;
  dueDate: string | null;
  assigneeId: string | null;
}

export interface TaskCreated extends TaskEventBase {
  readonly type: 'TaskCreated';
  readonly snapshot: TaskCreatedSnapshot;
}

export interface TaskStatusChanged extends TaskEventBase {
  readonly type: 'TaskStatusChanged';
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly fromRank: string;
  readonly toRank: string;
}

/** Chỉ đổi rank trong cùng cột. */
export interface TaskMoved extends TaskEventBase {
  readonly type: 'TaskMoved';
  readonly status: TaskStatus;
  readonly fromRank: string;
  readonly toRank: string;
}

export interface TaskAssigneeChanged extends TaskEventBase {
  readonly type: 'TaskAssigneeChanged';
  readonly from: string | null;
  readonly to: string | null;
}

export type UpdatableField = 'title' | 'description' | 'priority' | 'dueDate';
export type UpdatableValues = Partial<{
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
}>;

export interface TaskUpdated extends TaskEventBase {
  readonly type: 'TaskUpdated';
  readonly changedFields: readonly UpdatableField[];
  readonly old: UpdatableValues;
  readonly new: UpdatableValues;
}

export interface TaskDeleted extends TaskEventBase {
  readonly type: 'TaskDeleted';
  readonly number: number;
  /** Version **sau** khi xóa (R10). */
  readonly version: number;
  readonly title: string;
  readonly status: TaskStatus;
}

export type TaskEvent =
  TaskCreated | TaskStatusChanged | TaskMoved | TaskAssigneeChanged | TaskUpdated | TaskDeleted;
