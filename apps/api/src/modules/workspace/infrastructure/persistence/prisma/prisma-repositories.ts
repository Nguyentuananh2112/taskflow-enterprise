import { ResourceConflictError } from '../../../../../core/errors';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../../../application/ports/repositories.port';
import { Membership } from '../../../domain/membership';
import { Project } from '../../../domain/project';
import { Workspace } from '../../../domain/workspace';
import { CONFLICTS, uniqueConstraintOf, type DbProvider } from './db';

/** Unique ⇒ 409 đúng contract; lỗi khác ném nguyên. */
async function mapConflicts<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    const conflict = CONFLICTS[uniqueConstraintOf(err) ?? ''];
    if (conflict) throw new ResourceConflictError(conflict);
    throw err;
  }
}

const WS = {
  id: true,
  name: true,
  slug: true,
  deletedAt: true,
  purgeAt: true,
  deletedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaWorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly db: DbProvider) {}

  async findById(id: string): Promise<Workspace | null> {
    const row = await this.db().workspace.findUnique({ where: { id }, select: WS });
    return row ? Workspace.reconstitute(row) : null;
  }
  async add(workspace: Workspace): Promise<void> {
    await mapConflicts(() =>
      this.db().workspace.create({ data: workspace.toSnapshot(), select: { id: true } }),
    );
  }
  async save(workspace: Workspace): Promise<void> {
    const { id, createdAt: _c, ...data } = workspace.toSnapshot();
    await mapConflicts(() =>
      this.db().workspace.update({ where: { id }, data, select: { id: true } }),
    );
  }
  /** Loại trừ với purge: chỉ khôi phục khi `deleted_at IS NOT NULL AND purge_at > now` (WSR-05). */
  async restoreIfWithinGrace(id: string, now: Date): Promise<boolean> {
    const { count } = await this.db().workspace.updateMany({
      where: { id, deletedAt: { not: null }, purgeAt: { gt: now } },
      data: { deletedAt: null, purgeAt: null, deletedById: null, updatedAt: now },
    });
    return count === 1;
  }
  async listPurgeable(now: Date, limit: number): Promise<string[]> {
    const rows = await this.db().workspace.findMany({
      where: { purgeAt: { lte: now } }, // dùng partial index workspaces_purge_at_idx
      orderBy: { purgeAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

const MEMBER = {
  id: true,
  workspaceId: true,
  userId: true,
  role: true,
  joinedAt: true,
  updatedAt: true,
} as const;

export class PrismaMembershipRepository implements IMembershipRepository {
  constructor(private readonly db: DbProvider) {}

  async find(workspaceId: string, userId: string): Promise<Membership | null> {
    const row = await this.db().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: MEMBER,
    });
    return row ? Membership.reconstitute(row) : null;
  }
  async add(membership: Membership): Promise<void> {
    await mapConflicts(() =>
      this.db().workspaceMember.create({ data: membership.toSnapshot(), select: { id: true } }),
    );
  }
  async save(membership: Membership): Promise<void> {
    const { id, role, updatedAt } = membership.toSnapshot();
    await this.db().workspaceMember.update({
      where: { id },
      data: { role, updatedAt },
      select: { id: true },
    });
  }
  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.db().workspaceMember.deleteMany({ where: { workspaceId, userId } });
  }
  /**
   * ADR-046: khóa MỌI dòng OWNER theo thứ tự id (tránh deadlock). Ở READ COMMITTED, transaction thứ
   * hai chờ khóa rồi đánh giá lại `role = 'OWNER'` ⇒ dòng vừa bị hạ không còn được đếm (ROL-05).
   * Dùng index (workspace_id, role) — ADR-051.
   */
  async lockOwners(workspaceId: string): Promise<string[]> {
    const rows = await this.db().$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM workspace_members
       WHERE workspace_id = ${workspaceId}::uuid AND role = 'OWNER'
       ORDER BY id
       FOR UPDATE`;
    return rows.map((r) => r.user_id);
  }
  async listUserIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db().workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}

const PROJECT = {
  id: true,
  workspaceId: true,
  name: true,
  keyPrefix: true,
  description: true,
  nextTaskNumber: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaProjectRepository implements IProjectRepository {
  constructor(private readonly db: DbProvider) {}

  /** Có phạm vi tenant (ADR-020): `WHERE id AND workspace_id` — không `findUnique({ id })` trần. */
  async findInWorkspace(workspaceId: string, projectId: string): Promise<Project | null> {
    const row = await this.db().project.findFirst({
      where: { id: projectId, workspaceId },
      select: PROJECT,
    });
    return row ? Project.reconstitute(row) : null;
  }
  async add(project: Project): Promise<void> {
    await mapConflicts(() =>
      this.db().project.create({ data: project.toSnapshot(), select: { id: true } }),
    );
  }
  /** Không ghi `next_task_number` — cột đó chỉ do `allocateTaskNumber` tăng (UPDATE … RETURNING). */
  async save(project: Project): Promise<void> {
    const { id, workspaceId, name, description, archivedAt, updatedAt } = project.toSnapshot();
    await this.db().project.updateMany({
      where: { id, workspaceId },
      data: { name, description, archivedAt, updatedAt },
    });
  }
  async listIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db().project.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
