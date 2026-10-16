import type { IUserDirectory, UserSummary } from '../../../application/ports/collaborators.port';
import type {
  IWorkspaceQueries,
  MemberRow,
  Page,
  PageRequest,
} from '../../../application/ports/queries.port';
import type { ProjectSnapshot } from '../../../domain/project';
import type { MemberGrant, WorkspaceRole } from '../../../domain/roles';
import type { WorkspaceSnapshot } from '../../../domain/workspace';
import type { DbProvider } from './db';

const MAX_MY_WORKSPACES = 100;
const WS = {
  id: true,
  name: true,
  slug: true,
  deletedAt: true,
  purgeAt: true,
  deletedById: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
const PROJECT = {
  id: true,
  workspaceId: true,
  name: true,
  keyPrefix: true,
  description: true,
  nextTaskNumber: true,
  version: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Keyset: lấy `limit + 1` dòng để biết còn trang sau. */
function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextAfter: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

/** `%`, `_`, `\` theo nghĩa đen trong ILIKE (security.md 6.7). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Phía đọc (ADR-015): `select` thẳng, mọi truy vấn có phạm vi tenant và loại ws đã xóa mềm. */
export class PrismaWorkspaceQueries implements IWorkspaceQueries {
  constructor(private readonly db: DbProvider) {}

  async listActiveForUser(
    userId: string,
  ): Promise<
    { workspace: WorkspaceSnapshot; role: WorkspaceRole; grants: MemberGrant[]; joinedAt: Date }[]
  > {
    const rows = await this.db().workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: MAX_MY_WORKSPACES,
      select: { role: true, grants: true, joinedAt: true, workspace: { select: WS } },
    });
    return rows.map((r) => ({
      workspace: r.workspace,
      role: r.role,
      grants: r.grants,
      joinedAt: r.joinedAt,
    }));
  }

  async listDeletedOwnedBy(userId: string, now: Date): Promise<WorkspaceSnapshot[]> {
    return this.db().workspace.findMany({
      where: { purgeAt: { gt: now }, members: { some: { userId, role: 'OWNER' } } },
      orderBy: { deletedAt: 'desc' },
      select: WS,
    });
  }

  async listMembers(
    workspaceId: string,
    q: string | null,
    page: PageRequest,
  ): Promise<Page<MemberRow>> {
    const pattern = q === null ? null : `%${escapeLike(q)}%`;
    // Keyset (joined_at, id) + ILIKE có ESCAPE tường minh; tham số hóa hoàn toàn qua $queryRaw.
    const rows = await this.db().$queryRaw<
      {
        id: string;
        workspace_id: string;
        user_id: string;
        role: WorkspaceRole;
        grants: MemberGrant[];
        joined_at: Date;
        updated_at: Date;
        email: string;
        full_name: string;
      }[]
    >`
      SELECT m.id, m.workspace_id, m.user_id, m.role, m.grants::text[] AS grants, m.joined_at, m.updated_at,
             u.email, u.full_name
        FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ${workspaceId}::uuid
         AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = m.workspace_id AND w.deleted_at IS NULL)
         AND (${pattern}::text IS NULL OR u.email ILIKE ${pattern} ESCAPE '\\' OR u.full_name ILIKE ${pattern} ESCAPE '\\')
         AND (${page.after ?? null}::uuid IS NULL OR (m.joined_at, m.id) > (
              SELECT a.joined_at, a.id FROM workspace_members a
               WHERE a.id = ${page.after ?? null}::uuid AND a.workspace_id = ${workspaceId}::uuid))
       ORDER BY m.joined_at, m.id
       LIMIT ${page.limit + 1}`;
    return toPage(
      rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        role: r.role,
        grants: r.grants,
        joinedAt: r.joined_at,
        updatedAt: r.updated_at,
        email: r.email,
        fullName: r.full_name,
      })),
      page.limit,
    );
  }

  async listProjects(
    workspaceId: string,
    archived: 'false' | 'true' | 'all',
    page: PageRequest,
  ): Promise<Page<ProjectSnapshot>> {
    const archivedFilter =
      archived === 'all' ? {} : { archivedAt: archived === 'true' ? { not: null } : null };
    const cursor = page.after
      ? await this.db().project.findFirst({
          where: { id: page.after, workspaceId },
          select: { createdAt: true, id: true },
        })
      : null;
    const rows = await this.db().project.findMany({
      where: {
        workspaceId,
        workspace: { deletedAt: null }, // X7
        ...archivedFilter,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      select: PROJECT,
    });
    return toPage(rows, page.limit);
  }
}

/** Đọc bảng `users` (chỉ đọc). User đã xóa/ẩn danh hóa ⇒ null (không thêm được làm thành viên). */
export class PrismaUserDirectory implements IUserDirectory {
  constructor(private readonly db: DbProvider) {}

  findByEmail(normalizedEmail: string): Promise<UserSummary | null> {
    return this.db().user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: { id: true, email: true, fullName: true },
    });
  }
  findById(id: string): Promise<UserSummary | null> {
    return this.db().user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, email: true, fullName: true },
    });
  }
}
