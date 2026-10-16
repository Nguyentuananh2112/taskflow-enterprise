export type TaskAuditAction =
  'CREATED' | 'UPDATED' | 'STATUS_CHANGED' | 'MOVED' | 'ASSIGNEE_CHANGED' | 'DELETED';

/** Một dòng `task_audit_logs` (data-and-api §1.5). Append-only. */
export interface TaskAuditEntry {
  id: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorId: string;
  action: TaskAuditAction;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: Date;
}

/** Chỉ có `append` — không update/delete (data-and-api §1.4 ghi chú). Gọi trong transaction. */
export interface ITaskAuditLogRepository {
  append(entry: TaskAuditEntry): Promise<void>;
  /** Nhiều dòng trong một câu INSERT (rebalance theo lô — A3). Mảng rỗng ⇒ không làm gì. */
  appendMany(entries: readonly TaskAuditEntry[]): Promise<void>;
}
