import type {
  ITaskAuditLogRepository,
  TaskAuditEntry,
} from '../../../application/ports/audit-log.port';
import type {
  IAssigneeDirectory,
  ITaskProjectStore,
  IUserRefReader,
  ProjectKey,
  ProjectRef,
  UserRef,
} from '../../../application/ports/collaborators.port';
import type { TaskRole } from '../../../application/task-actor';
import type { InMemoryTaskDatabase } from './in-memory-task-database';

/** Tên hiển thị của user đã ẩn danh hóa (data-and-api D2). */
export const ANONYMIZED_NAME = 'Người dùng đã xóa';

export class InMemoryTaskProjectStore implements ITaskProjectStore {
  constructor(private readonly db: InMemoryTaskDatabase) {}

  findInWorkspace({ workspaceId, projectId }: ProjectKey): Promise<ProjectRef | null> {
    const row = this.db.liveProject(workspaceId, projectId);
    if (!row) return Promise.resolve(null);
    const { id, keyPrefix, archivedAt } = row;
    return Promise.resolve({ id, workspaceId, keyPrefix, isArchived: archivedAt !== null });
  }

  /** = `UPDATE … SET next_task_number + 1 WHERE … archived_at IS NULL RETURNING` (§1.2). */
  allocateTaskNumber({ workspaceId, projectId }: ProjectKey): Promise<number | null> {
    const row = this.db.liveProject(workspaceId, projectId);
    if (!row || row.archivedAt !== null) return Promise.resolve(null);
    const number = row.nextTaskNumber;
    row.nextTaskNumber += 1;
    return Promise.resolve(number);
  }
}

export class InMemoryAssigneeDirectory implements IAssigneeDirectory {
  constructor(private readonly db: InMemoryTaskDatabase) {}

  roleOf({
    workspaceId,
    userId,
  }: {
    workspaceId: string;
    userId: string;
  }): Promise<TaskRole | null> {
    const user = this.db.state.users.get(userId);
    if (!user || user.deletedAt !== null) return Promise.resolve(null);
    const m = this.db.state.members.find(
      (r) => r.workspaceId === workspaceId && r.userId === userId,
    );
    return Promise.resolve(m?.role ?? null);
  }
}

export class InMemoryUserRefReader implements IUserRefReader {
  constructor(private readonly db: InMemoryTaskDatabase) {}

  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRef>> {
    const refs = new Map<string, UserRef>();
    for (const id of ids) {
      const u = this.db.state.users.get(id);
      if (u) refs.set(id, { id, fullName: u.deletedAt ? ANONYMIZED_NAME : u.fullName });
    }
    return Promise.resolve(refs);
  }
}

export class InMemoryTaskAuditLogRepository implements ITaskAuditLogRepository {
  constructor(private readonly db: InMemoryTaskDatabase) {}

  append(entry: TaskAuditEntry): Promise<void> {
    this.db.state.audit.push({ ...entry });
    return Promise.resolve();
  }
}
