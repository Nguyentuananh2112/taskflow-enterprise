import { FakeUnitOfWork } from '../../../../test/support';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { ITaskAuditLogRepository, TaskAuditEntry } from '../application/ports/audit-log.port';
import type {
  IAssigneeDirectory,
  ITaskProjectStore,
  IUserRefReader,
} from '../application/ports/collaborators.port';
import type { ITaskReadModel } from '../application/ports/task-read-model.port';
import type { ITaskRepository } from '../application/ports/task-repository.port';
import type { TaskProps } from '../domain/task';
import {
  InMemoryAssigneeDirectory,
  InMemoryTaskAuditLogRepository,
  InMemoryTaskProjectStore,
  InMemoryUserRefReader,
} from '../infrastructure/persistence/in-memory/in-memory-task-collaborators';
import {
  InMemoryTaskDatabase,
  type MemberRow,
  type ProjectRow,
  type UserRow,
} from '../infrastructure/persistence/in-memory/in-memory-task-database';
import { InMemoryTaskReadModel } from '../infrastructure/persistence/in-memory/in-memory-task-read-model';
import { InMemoryTaskRepository } from '../infrastructure/persistence/in-memory/in-memory-task.repository';

export type { MemberRow, ProjectRow, UserRow };

/**
 * Lưu trữ phía sau harness test của Task: cùng bộ test use case chạy trên InMemory (tầng A) và
 * Prisma/Postgres (tầng I — LSP, T-023). Phần "dữ liệu" (seed/đọc/sửa thẳng) là async để bản
 * Prisma hiện thực được; test KHÔNG chạm `db.state`.
 */
export interface TaskBackend {
  readonly uow: IUnitOfWork & { readonly rollbacks: number };
  readonly tasks: ITaskRepository;
  readonly projects: ITaskProjectStore;
  readonly assignees: IAssigneeDirectory;
  readonly users: IUserRefReader;
  readonly audit: ITaskAuditLogRepository;
  readonly readModel: ITaskReadModel;

  seedUser(user: UserRow): Promise<void>;
  seedWorkspace(id: string): Promise<void>;
  seedMember(member: MemberRow): Promise<void>;
  seedProject(project: ProjectRow): Promise<void>;
  /** Chèn thẳng một task (dữ liệu có sẵn) — không audit, không event. */
  insertTask(task: TaskProps): Promise<void>;

  taskRows(): Promise<TaskProps[]>;
  patchTask(id: string, patch: Partial<TaskProps>): Promise<void>;
  auditRows(): Promise<TaskAuditEntry[]>;
  projectRow(id: string): Promise<ProjectRow | undefined>;
  patchProject(
    id: string,
    patch: Partial<Pick<ProjectRow, 'archivedAt' | 'nextTaskNumber'>>,
  ): Promise<void>;
  /** Thêm hoặc đổi role thành viên. */
  setMember(member: MemberRow): Promise<void>;
}

export function inMemoryTaskBackend(): TaskBackend {
  const db = new InMemoryTaskDatabase();
  const users = new InMemoryUserRefReader(db);
  const ok = () => Promise.resolve();
  return {
    uow: new FakeUnitOfWork(db),
    tasks: new InMemoryTaskRepository(db),
    projects: new InMemoryTaskProjectStore(db),
    assignees: new InMemoryAssigneeDirectory(db),
    users,
    audit: new InMemoryTaskAuditLogRepository(db),
    readModel: new InMemoryTaskReadModel(db, users),

    seedUser: (u) => (db.state.users.set(u.id, { ...u }), ok()),
    seedWorkspace: ok,
    seedMember: (m) => (db.state.members.push({ ...m }), ok()),
    seedProject: (p) => (db.state.projects.set(p.id, { ...p }), ok()),
    insertTask: (t) => (db.state.tasks.set(t.id, { ...t }), ok()),

    taskRows: () => Promise.resolve([...db.state.tasks.values()].map((t) => ({ ...t }))),
    patchTask: (id, patch) => (Object.assign(db.state.tasks.get(id)!, patch), ok()),
    auditRows: () => Promise.resolve(db.state.audit.map((a) => ({ ...a }))),
    projectRow: (id) => {
      const row = db.state.projects.get(id);
      return Promise.resolve(row ? { ...row } : undefined);
    },
    patchProject: (id, patch) => (Object.assign(db.state.projects.get(id)!, patch), ok()),
    setMember: (m) => {
      const found = db.state.members.find(
        (r) => r.workspaceId === m.workspaceId && r.userId === m.userId,
      );
      if (found) found.role = m.role;
      else db.state.members.push({ ...m });
      return ok();
    },
  };
}
