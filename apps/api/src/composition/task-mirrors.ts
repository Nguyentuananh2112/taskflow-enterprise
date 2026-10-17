// Chế độ bộ nhớ: InMemoryTaskDatabase của module Task giữ bản sao project / member / workspace-đã-xóa
// riêng (bản Prisma đọc thẳng bảng chung). Các decorator dưới phản chiếu mọi lần ghi của Workspace
// sang. Bản sao nằm trong cùng InMemoryUnitOfWork ⇒ rollback cùng nhau.
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../modules/workspace/application/ports/repositories.port';
import type { Membership } from '../modules/workspace/domain/membership';
import type { Project } from '../modules/workspace/domain/project';
import type { Workspace } from '../modules/workspace/domain/workspace';
import type { InMemoryTaskDatabase } from '../modules/task/infrastructure/persistence/in-memory/in-memory-task-database';

export class TaskMirroredProjects implements IProjectRepository {
  constructor(
    private readonly inner: IProjectRepository,
    private readonly db: InMemoryTaskDatabase,
  ) {}

  #reflect(project: Project): void {
    const existing = this.db.state.projects.get(project.id);
    this.db.state.projects.set(project.id, {
      id: project.id,
      workspaceId: project.workspaceId,
      keyPrefix: project.keyPrefix,
      nextTaskNumber: existing?.nextTaskNumber ?? 1,
      archivedAt: project.isArchived ? (existing?.archivedAt ?? new Date()) : null,
    });
  }

  findInWorkspace(workspaceId: string, projectId: string) {
    return this.inner.findInWorkspace(workspaceId, projectId);
  }

  listIds(workspaceId: string) {
    return this.inner.listIds(workspaceId);
  }

  async add(project: Project): Promise<void> {
    await this.inner.add(project);
    this.#reflect(project);
  }

  /** ADR-110 (T-032): ghi có điều kiện `version` — chỉ phản chiếu khi thực sự ghi. */
  async save(project: Project): Promise<boolean> {
    const saved = await this.inner.save(project);
    if (saved) this.#reflect(project);
    return saved;
  }
}

export class TaskMirroredMemberships implements IMembershipRepository {
  constructor(
    private readonly inner: IMembershipRepository,
    private readonly db: InMemoryTaskDatabase,
  ) {}

  #upsert(m: Membership): void {
    const members = this.db.state.members.filter(
      (r) => !(r.workspaceId === m.workspaceId && r.userId === m.userId),
    );
    members.push({ workspaceId: m.workspaceId, userId: m.userId, role: m.role });
    this.db.state.members = members;
  }

  find(workspaceId: string, userId: string) {
    return this.inner.find(workspaceId, userId);
  }

  lockOwners(workspaceId: string) {
    return this.inner.lockOwners(workspaceId);
  }

  findForShare(workspaceId: string, userId: string) {
    return this.inner.findForShare(workspaceId, userId);
  }

  listUserIds(workspaceId: string) {
    return this.inner.listUserIds(workspaceId);
  }

  listWorkspaceIdsOfUser(userId: string) {
    return this.inner.listWorkspaceIdsOfUser(userId);
  }

  async add(membership: Membership): Promise<void> {
    await this.inner.add(membership);
    this.#upsert(membership);
  }

  async save(membership: Membership): Promise<void> {
    await this.inner.save(membership);
    this.#upsert(membership);
  }

  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.inner.remove(workspaceId, userId);
    this.db.state.members = this.db.state.members.filter(
      (r) => !(r.workspaceId === workspaceId && r.userId === userId),
    );
  }
}

export class TaskMirroredWorkspaces implements IWorkspaceRepository {
  constructor(
    private readonly inner: IWorkspaceRepository,
    private readonly db: InMemoryTaskDatabase,
  ) {}

  #reflect(workspace: Workspace): void {
    if (workspace.isDeleted) this.db.state.deletedWorkspaces.add(workspace.id);
    else this.db.state.deletedWorkspaces.delete(workspace.id);
  }

  findById(id: string) {
    return this.inner.findById(id);
  }

  archive(id: string, at: Date) {
    return this.inner.archive(id, at);
  }
  listPurgeable(now: Date, limit: number) {
    return this.inner.listPurgeable(now, limit);
  }

  async add(workspace: Workspace): Promise<void> {
    await this.inner.add(workspace);
    this.#reflect(workspace);
  }

  /** ADR-110 (T-032): ghi có điều kiện `version` — chỉ phản chiếu khi thực sự ghi. */
  async save(workspace: Workspace): Promise<boolean> {
    const saved = await this.inner.save(workspace);
    if (saved) this.#reflect(workspace);
    return saved;
  }

  async restoreIfWithinGrace(id: string, now: Date): Promise<boolean> {
    const restored = await this.inner.restoreIfWithinGrace(id, now);
    if (restored) this.db.state.deletedWorkspaces.delete(id);
    return restored;
  }
}
