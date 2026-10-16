import type {
  IUserDirectory,
  IWorkspacePurger,
  UserSummary,
} from '../../../application/ports/collaborators.port';
import type {
  IWorkspaceQueries,
  MemberRow,
  Page,
  PageRequest,
} from '../../../application/ports/queries.port';
import type { ProjectSnapshot } from '../../../domain/project';
import type { MemberGrant, WorkspaceRole } from '../../../domain/roles';
import type { WorkspaceSnapshot } from '../../../domain/workspace';
import type {
  InMemoryMembershipRepository,
  InMemoryProjectRepository,
  InMemoryWorkspaceRepository,
} from './in-memory-repositories';

export class InMemoryUserDirectory implements IUserDirectory {
  readonly users = new Map<string, UserSummary>();

  seed(user: UserSummary): void {
    this.users.set(user.id, user);
  }
  findByEmail(normalizedEmail: string): Promise<UserSummary | null> {
    return Promise.resolve(
      [...this.users.values()].find((u) => u.email === normalizedEmail) ?? null,
    );
  }
  findById(id: string): Promise<UserSummary | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
}

function paginate<T extends { id: string }>(rows: T[], page: PageRequest): Page<T> {
  const start = page.after === undefined ? 0 : rows.findIndex((r) => r.id === page.after) + 1;
  const items = rows.slice(start, start + page.limit);
  const hasMore = start + page.limit < rows.length;
  return { items, nextAfter: hasMore ? (items.at(-1)?.id ?? null) : null };
}

const byJoinedThenId = (a: { joinedAt: Date; id: string }, b: { joinedAt: Date; id: string }) =>
  a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id);

export class InMemoryWorkspaceQueries implements IWorkspaceQueries {
  constructor(
    private readonly workspaces: InMemoryWorkspaceRepository,
    private readonly memberships: InMemoryMembershipRepository,
    private readonly projects: InMemoryProjectRepository,
    private readonly users: InMemoryUserDirectory,
  ) {}

  listActiveForUser(
    userId: string,
  ): Promise<
    { workspace: WorkspaceSnapshot; role: WorkspaceRole; grants: MemberGrant[]; joinedAt: Date }[]
  > {
    const result = this.memberships
      .rows()
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const ws = this.workspaces
          .rows()
          .find((w) => w.id === m.workspaceId && w.deletedAt === null);
        return ws
          ? [{ workspace: ws, role: m.role, grants: [...m.grants], joinedAt: m.joinedAt }]
          : [];
      });
    return Promise.resolve(result.slice(0, 100));
  }

  listDeletedOwnedBy(userId: string, now: Date): Promise<WorkspaceSnapshot[]> {
    const owned = new Set(
      this.memberships
        .rows()
        .filter((m) => m.userId === userId && m.role === 'OWNER')
        .map((m) => m.workspaceId),
    );
    return Promise.resolve(
      this.workspaces
        .rows()
        .filter(
          (w) => owned.has(w.id) && w.purgeAt !== null && w.purgeAt.getTime() > now.getTime(),
        ),
    );
  }

  listMembers(workspaceId: string, q: string | null, page: PageRequest): Promise<Page<MemberRow>> {
    // InMemory so khớp theo nghĩa đen (includes) — bản Prisma phải escape %/_/\ (security.md 6.7).
    const needle = q?.toLowerCase() ?? null;
    const rows = this.memberships
      .rows()
      .filter((m) => m.workspaceId === workspaceId)
      .flatMap((m) => {
        const user = this.users.users.get(m.userId);
        return user ? [{ ...m, email: user.email, fullName: user.fullName }] : [];
      })
      .filter(
        (r) => !needle || r.email.includes(needle) || r.fullName.toLowerCase().includes(needle),
      )
      .sort(byJoinedThenId);
    return Promise.resolve(paginate(rows, page));
  }

  listProjects(
    workspaceId: string,
    archived: 'false' | 'true' | 'all',
    page: PageRequest,
  ): Promise<Page<ProjectSnapshot>> {
    const rows = this.projects
      .rows()
      .filter((p) => p.workspaceId === workspaceId)
      .filter((p) => archived === 'all' || (archived === 'true') === (p.archivedAt !== null))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return Promise.resolve(paginate(rows, page));
  }
}

/** Mô phỏng cascade của Postgres trên 3 bảng InMemory; kiểm lại purge_at như bản thật. */
export class InMemoryWorkspacePurger implements IWorkspacePurger {
  constructor(
    private readonly workspaces: InMemoryWorkspaceRepository,
    private readonly memberships: InMemoryMembershipRepository,
    private readonly projects: InMemoryProjectRepository,
  ) {}

  purge(workspaceId: string, now: Date): Promise<boolean> {
    const ws = this.workspaces.rows().find((w) => w.id === workspaceId);
    if (!ws?.purgeAt || ws.purgeAt.getTime() > now.getTime()) return Promise.resolve(false);
    this.projects.deleteWhere((p) => p.workspaceId === workspaceId);
    this.memberships.deleteWhere((m) => m.workspaceId === workspaceId);
    this.workspaces.deleteWhere((w) => w.id === workspaceId);
    return Promise.resolve(true);
  }
}
