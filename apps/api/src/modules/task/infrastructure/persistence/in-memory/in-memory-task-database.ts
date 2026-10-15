import type { TaskProps } from '../../../domain/task';
import type { TaskAuditEntry } from '../../../application/ports/audit-log.port';
import type { TaskRole } from '../../../application/task-actor';

export interface ProjectRow {
  id: string;
  workspaceId: string;
  keyPrefix: string;
  nextTaskNumber: number;
  archivedAt: Date | null;
}

export interface UserRow {
  id: string;
  fullName: string;
  deletedAt: Date | null;
}

export interface MemberRow {
  workspaceId: string;
  userId: string;
  role: TaskRole;
}

interface State {
  tasks: Map<string, TaskProps>;
  projects: Map<string, ProjectRow>;
  users: Map<string, UserRow>;
  members: MemberRow[];
  audit: TaskAuditEntry[];
  /** Workspace đã xóa mềm — mọi truy cập ⇒ như không tồn tại (ADR-047). */
  deletedWorkspaces: Set<string>;
}

const clone = (s: State): State => ({
  tasks: new Map([...s.tasks].map(([k, v]) => [k, { ...v }])),
  projects: new Map([...s.projects].map(([k, v]) => [k, { ...v }])),
  users: new Map([...s.users].map(([k, v]) => [k, { ...v }])),
  members: s.members.map((m) => ({ ...m })),
  audit: s.audit.map((a) => ({ ...a })),
  deletedWorkspaces: new Set(s.deletedWorkspaces),
});

/**
 * "Bảng" dùng chung của các adapter InMemory module Task — mô phỏng một DB để FakeUnitOfWork
 * rollback được mọi thứ cùng lúc (task, bộ đếm số, audit). Chỉ dùng cho test/dev.
 */
export class InMemoryTaskDatabase {
  state: State = {
    tasks: new Map(),
    projects: new Map(),
    users: new Map(),
    members: [],
    audit: [],
    deletedWorkspaces: new Set(),
  };

  snapshot(): unknown {
    return clone(this.state);
  }

  restore(snapshot: unknown): void {
    this.state = clone(snapshot as State);
  }

  liveProject(workspaceId: string, projectId: string): ProjectRow | undefined {
    if (this.state.deletedWorkspaces.has(workspaceId)) return undefined;
    const row = this.state.projects.get(projectId);
    return row && row.workspaceId === workspaceId ? row : undefined;
  }
}
