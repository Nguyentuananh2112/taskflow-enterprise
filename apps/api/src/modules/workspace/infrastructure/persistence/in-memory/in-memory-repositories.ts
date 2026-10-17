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
export abstract class Table<Row extends { id: string }> {
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
  /** ADR-110: cùng ngữ nghĩa bản Prisma — có điều kiện `version` + chưa xóa, rồi `version + 1`. */
  async save(workspace: Workspace): Promise<boolean> {
    const row = workspace.toSnapshot();
    const current = this.byId.get(row.id);
    if (!current || current.deletedAt !== null || current.version !== row.version) return false;
    await this.#write({ ...row, version: row.version + 1 });
    return true;
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
      version: row.version + 1,
    });
    return Promise.resolve(true);
  }
  archive(id: string, at: Date): Promise<boolean> {
    const row = this.byId.get(id);
    if (!row || row.deletedAt !== null || (row.archivedAt ?? null) !== null) {
      return Promise.resolve(false);
    }
    this.byId.set(id, { ...row, archivedAt: at, updatedAt: at, version: row.version + 1 });
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
  /** InMemory không có khóa (transaction tuần tự) — race chỉ chứng minh được ở test I (CC-HR-11). */
  findForShare(workspaceId: string, userId: string): Promise<Membership | null> {
    return this.find(workspaceId, userId);
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
  /**
   * ADR-110: có điều kiện `version` rồi `version + 1`; giữ `nextTaskNumber` hiện tại (chỉ
   * `allocateTaskNumber` tăng). Bản InMemory không thấy bảng workspace — điều kiện "workspace chưa
   * xóa" của bản Prisma do use case kiểm trước (membership 404).
   */
  save(project: Project): Promise<boolean> {
    const row = project.toSnapshot();
    const current = this.byId.get(row.id);
    if (!current || current.workspaceId !== row.workspaceId || current.version !== row.version) {
      return Promise.resolve(false);
    }
    this.byId.set(row.id, {
      ...row,
      nextTaskNumber: current.nextTaskNumber,
      version: row.version + 1,
    });
    return Promise.resolve(true);
  }
  listIds(workspaceId: string): Promise<string[]> {
    return Promise.resolve(
      this.rows()
        .filter((r) => r.workspaceId === workspaceId)
        .map((r) => r.id),
    );
  }
}

/** HrAuditLog InMemory — chỉ thêm; tên actor lấy qua `nameOf` (directory của composition). */
