import type { AuditLogDto, TaskDto } from '@taskflow/contracts';

import type { TaskStatus } from '../../domain/task-status';

export interface TaskListFilter {
  status?: TaskStatus;
  /** uuid hoặc `"none"` = chưa gán. */
  assigneeId?: string;
}

/** Khóa sắp xếp của danh sách task: thứ tự enum status, rank (byte), id. */
export interface TaskListKey {
  status: TaskStatus;
  rank: string;
  id: string;
}

/** Khóa sắp xếp lịch sử: mới nhất trước, phá hòa bằng id giảm dần. */
export interface AuditLogKey {
  createdAt: string;
  id: string;
}

/**
 * Phía đọc CQRS-lite (ADR-015): trả DTO thẳng từ `select`, không qua entity. Luôn có phạm vi
 * workspace + project. `limit` là số dòng tối đa muốn lấy (query handler xin thêm 1 để biết `hasMore`).
 */
export interface ITaskReadModel {
  /** Task chưa xóa mềm. */
  getTask(workspaceId: string, projectId: string, taskId: string): Promise<TaskDto | null>;
  listTasks(
    workspaceId: string,
    projectId: string,
    filter: TaskListFilter,
    after: TaskListKey | null,
    limit: number,
  ): Promise<TaskDto[]>;
  /** Task thuộc project, **kể cả đã xóa mềm** (R16: lịch sử vẫn đọc được). */
  taskExists(workspaceId: string, projectId: string, taskId: string): Promise<boolean>;
  /** Có phạm vi tenant ngay trong truy vấn (T-028 L3) — không chỉ dựa vào `taskExists` trước đó. */
  listAuditLogs(
    workspaceId: string,
    projectId: string,
    taskId: string,
    after: AuditLogKey | null,
    limit: number,
  ): Promise<AuditLogDto[]>;
}
