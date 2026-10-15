import { ResourceConflictError } from '../../../../../core/errors';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../../../application/ports/repositories.port';
import { Membership, type MembershipSnapshot } from '../../../domain/membership';
import { Project, type ProjectSnapshot } from '../../../domain/project';
import { Workspace, type WorkspaceSnapshot } from '../../../domain/workspace';

/** Bảng InMemory có snapshot/restore để FakeUnitOfWork rollback thật. */
abstract class Table<Row extends { id: string }> {
  protected byId = new Map<string, Row>();

  rows(): Row[] {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }
  snapshot(): unknown {
    return new Map([...this.byId].map(([k, v]) => [k, { ...v }]));
  }
  restore(snapshot: unknown): void {
    this.byId = snapshot as Map<string, Row>;
  }
  deleteWhere(match: (row: Row) => boolean): void {
    for (const [id, row] of this.byId) if (match(row)) this.byId.delete(id);
  }
}

export class InMemoryWorkspaceRepository
  extends Table<WorkspaceSnapshot>
  implements IWorkspaceRepository
{
  findById(id: string): Promise<Workspace | null> {
    const row = this.byId.get(id);
    return Promise.resolve(row ? Workspace.reconstitute(row) : null);
  }
  add(workspace: Workspace): Promise<void> {
    return this.#write(workspace.toSnapshot());
  }
  save(workspace: Workspace): Promise<void> {
    return this.#write(workspace.toSnapshot());
  }
  restoreIfWithinGrace(id: string, now: Date): Promise<boolean> {
    const row = this.byId.get(id);
    if (!row?.deletedAt || !row.purgeAt || row.purgeAt.getTime() <= now.getTime()) {
      return Promise.resolve(false);
    }
    this.byId.set(id, {
      ...row,
      deletedAt: null,
      purgeAt: null,
      deletedById: null,
      updatedAt: now,
    });
    return Promise.resolve(true);
  }
  listPurgeable(now: Date, limit: number): Promise<string[]> {
    const ids = this.rows()
      .filter((r) => r.purgeAt !== null && r.purgeAt.getTime() <= now.getTime())
      .map((r) => r.id);
    return Promise.resolve(ids.slice(0, limit));
  }
  #write(row: WorkspaceSnapshot): Promise<void> {
    // UNIQUE(slug) toàn bảng — kể cả ws đang xóa mềm (slug giữ chỗ, ADR-050).
    if (this.rows().some((r) => r.slug === row.slug && r.id !== row.id)) {
      return Promise.reject(new ResourceConflictError({ reason: 'taken', field: 'slug' }));
    }
    this.byId.set(row.id, { ...row });
    return Promise.resolve();
  }
}

export class InMemoryMembershipRepository
  extends Table<MembershipSnapshot>
  implements IMembershipRepository
{
  find(workspaceId: string, userId: string): Promise<Membership | null> {
    const row = this.#find(workspaceId, userId);
    return Promise.resolve(row ? Membership.reconstitute(row) : null);
  }
  add(membership: Membership): Promise<void> {
    const row = membership.toSnapshot();
    if (this.#find(row.workspaceId, row.userId)) {
      return Promise.reject(new ResourceConflictError({ reason: 'already_member' }));
    }
    this.byId.set(row.id, row);
    return Promise.resolve();
  }
  save(membership: Membership): Promise<void> {
    this.byId.set(membership.id, membership.toSnapshot());
    return Promise.resolve();
  }
  remove(workspaceId: string, userId: string): Promise<void> {
    this.deleteWhere((r) => r.workspaceId === workspaceId && r.userId === userId);
    return Promise.resolve();
  }
  /** InMemory không có khóa — race LAST_OWNER chỉ chứng minh được ở test I (ROL-05, REM-07). */
  lockOwners(workspaceId: string): Promise<string[]> {
    const owners = this.rows()
      .filter((r) => r.workspaceId === workspaceId && r.role === 'OWNER')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => r.userId);
    return Promise.resolve(owners);
  }
  listUserIds(workspaceId: string): Promise<string[]> {
    return Promise.resolve(
      this.rows()
        .filter((r) => r.workspaceId === workspaceId)
        .map((r) => r.userId),
    );
  }
  #find(workspaceId: string, userId: string): MembershipSnapshot | undefined {
    return [...this.byId.values()].find(
      (r) => r.workspaceId === workspaceId && r.userId === userId,
    );
  }
}

export class InMemoryProjectRepository
  extends Table<ProjectSnapshot>
  implements IProjectRepository
{
  findInWorkspace(workspaceId: string, projectId: string): Promise<Project | null> {
    const row = this.byId.get(projectId);
    // Có phạm vi tenant: project thuộc ws khác ⇒ như không tồn tại (ADR-020).
    return Promise.resolve(
      row && row.workspaceId === workspaceId ? Project.reconstitute(row) : null,
    );
  }
  add(project: Project): Promise<void> {
    const row = project.toSnapshot();
    if (
      this.rows().some((r) => r.workspaceId === row.workspaceId && r.keyPrefix === row.keyPrefix)
    ) {
      return Promise.reject(new ResourceConflictError({ reason: 'taken', field: 'keyPrefix' }));
    }
    this.byId.set(row.id, row);
    return Promise.resolve();
  }
  save(project: Project): Promise<void> {
    this.byId.set(project.id, project.toSnapshot());
    return Promise.resolve();
  }
  listIds(workspaceId: string): Promise<string[]> {
    return Promise.resolve(
      this.rows()
        .filter((r) => r.workspaceId === workspaceId)
        .map((r) => r.id),
    );
  }
}
