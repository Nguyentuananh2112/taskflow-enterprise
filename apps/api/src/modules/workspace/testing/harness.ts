import {
  FakeClock,
  FakeRandom,
  FakeUnitOfWork,
  SequentialIdGenerator,
  SpyLogger,
  createSpy,
  type UowStep,
} from '../../../../test/support';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type {
  IUserDirectory,
  IWorkspacePurger,
  IWorkspaceRealtimeNotifier,
  UserSummary,
} from '../application/ports/collaborators.port';
import { HrAuditWriter } from '../application/hr-audit-writer';
import type { HrAuditEntry, IHrAuditLog } from '../application/ports/hr-audit.port';
import type {
  IMemberDepartureLog,
  IMembershipTenureReader,
  MemberDeparture,
} from '../application/ports/tenure.port';
import {
  InMemoryMemberDepartures,
  InMemoryMembershipTenureReader,
} from '../infrastructure/persistence/in-memory/in-memory-tenure';
import type { IWorkspaceQueries } from '../application/ports/queries.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../application/ports/repositories.port';
import type { Actor } from '../application/workspace-shared';
import { WorkspaceCreator } from '../application/workspace-creator';
import { Membership, type MembershipSnapshot } from '../domain/membership';
import { Project, type ProjectSnapshot } from '../domain/project';
import type { WorkspaceRole } from '../domain/roles';
import { Workspace, type WorkspaceSnapshot } from '../domain/workspace';
import {
  InMemoryHrAuditLog,
  InMemoryMembershipRepository,
  InMemoryProjectRepository,
  InMemoryWorkspaceRepository,
} from '../infrastructure/persistence/in-memory/in-memory-repositories';
import {
  InMemoryUserDirectory,
  InMemoryWorkspacePurger,
  InMemoryWorkspaceQueries,
} from '../infrastructure/persistence/in-memory/in-memory-queries';
import { fixtureId } from './fixture-ids';
import { SpyTaskAssignmentCleaner } from './spies';

export { GHOST_ID, pid, uid, wsid } from './fixture-ids';
export { SpyTaskAssignmentCleaner } from './spies';
export const NOW = '2026-11-01T00:00:00.000Z';

type Rows<T> = { rows(): T[] | Promise<T[]> };

/**
 * Phần lưu trữ của harness — InMemory mặc định; integration truyền bản Prisma để chạy lại ĐÚNG
 * bộ test use case (LSP, T-020). `rows()` có thể async ⇒ test luôn `await`.
 */
export interface WorkspaceBackend {
  workspaces: IWorkspaceRepository & Rows<WorkspaceSnapshot>;
  memberships: IMembershipRepository & Rows<MembershipSnapshot>;
  projects: IProjectRepository & Rows<ProjectSnapshot>;
  users: IUserDirectory & { seed(user: UserSummary): void | Promise<void> };
  queries: IWorkspaceQueries;
  hrAudit: IHrAuditLog & Rows<HrAuditEntry>;
  departures: IMemberDepartureLog & Rows<MemberDeparture>;
  tenure: IMembershipTenureReader;
  purger: IWorkspacePurger;
  uow: IUnitOfWork & {
    readonly steps: UowStep[];
    readonly commits: number;
    readonly rollbacks: number;
  };
}

export function inMemoryWorkspaceBackend(): WorkspaceBackend {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryMembershipRepository();
  const projects = new InMemoryProjectRepository();
  const users = new InMemoryUserDirectory();
  const hrAudit = new InMemoryHrAuditLog((id) => users.users.get(id)?.fullName);
  const departures = new InMemoryMemberDepartures();
  return {
    workspaces,
    memberships,
    projects,
    users,
    queries: new InMemoryWorkspaceQueries(workspaces, memberships, projects, users),
    hrAudit,
    departures,
    tenure: new InMemoryMembershipTenureReader(memberships, departures),
    purger: new InMemoryWorkspacePurger(workspaces, memberships, projects),
    uow: new FakeUnitOfWork(workspaces, memberships, projects, hrAudit, departures),
  };
}

export function createWorkspaceHarness(
  random = new FakeRandom(),
  backend: WorkspaceBackend = inMemoryWorkspaceBackend(),
) {
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const { workspaces, memberships, projects, users, uow } = backend;
  const notifier = createSpy<IWorkspaceRealtimeNotifier>(uow);
  const cleaner = new SpyTaskAssignmentCleaner(uow);
  const logger = new SpyLogger();
  const creator = new WorkspaceCreator({ workspaces, memberships, ids, clock });
  const audit = new HrAuditWriter({ hrAudit: backend.hrAudit, ids, clock });
  const seeded = new Set<string>();

  const h = {
    ...backend,
    clock,
    ids,
    random,
    notifier,
    cleaner,
    logger,
    creator,
    audit,

    /** Seed user (một lần mỗi tên); id cố định theo tên — `uid(name)`. */
    async user(name: string) {
      const id = fixtureId('user', name);
      if (!seeded.has(id)) {
        seeded.add(id);
        await users.seed({ id, email: `${name.toLowerCase()}@example.com`, fullName: name });
      }
      return id;
    },

    async member(workspaceId: string, name: string, role: WorkspaceRole) {
      const userId = await h.user(name);
      await memberships.add(
        Membership.create({ id: ids.next(), workspaceId, userId, role, now: clock.now() }),
      );
      return userId;
    },

    async workspace(slug: string, members: Record<string, WorkspaceRole>) {
      const ws = Workspace.create({
        id: fixtureId('ws', slug),
        name: slug.toUpperCase(),
        slug,
        now: clock.now(),
      });
      await workspaces.add(ws);
      for (const [name, role] of Object.entries(members)) await h.member(ws.id, name, role);
      return ws.id;
    },

    async project(workspaceId: string, keyPrefix: string, archived = false) {
      const p = Project.create({
        id: fixtureId('project', keyPrefix),
        workspaceId,
        name: keyPrefix,
        keyPrefix,
        description: null,
        now: clock.now(),
      });
      if (archived) p.archive(clock.now());
      await projects.add(p);
      // +1ms: thứ tự tạo rõ ràng cho cả InMemory (thứ tự chèn) lẫn Postgres (ORDER BY created_at, id).
      clock.advance(1);
      return p.id;
    },

    actor(workspaceId: string, name: string, role: WorkspaceRole): Actor {
      return { userId: fixtureId('user', name), workspaceId, role };
    },

    async roleOf(workspaceId: string, name: string) {
      const userId = fixtureId('user', name);
      const rows = await memberships.rows();
      return rows.find((m) => m.workspaceId === workspaceId && m.userId === userId)?.role ?? null;
    },
  };
  return h;
}

export type WorkspaceHarness = ReturnType<typeof createWorkspaceHarness>;

/** test-spec §0.3: ws A (Alice OWNER, Pam PM, Mia MEMBER, Vic VIEWER) và ws B (Bob OWNER); Nina có tài khoản. */
export async function givenWorkspaceA(
  h: WorkspaceHarness,
  extra: Record<string, WorkspaceRole> = {},
) {
  const A = await h.workspace('acme', {
    Alice: 'OWNER',
    Pam: 'PM',
    Mia: 'MEMBER',
    Vic: 'VIEWER',
    ...extra,
  });
  const B = await h.workspace('bravo', { Bob: 'OWNER' });
  await h.user('Nina');
  return {
    A,
    B,
    alice: h.actor(A, 'Alice', 'OWNER'),
    pam: h.actor(A, 'Pam', 'PM'),
    mia: h.actor(A, 'Mia', 'MEMBER'),
    vic: h.actor(A, 'Vic', 'VIEWER'),
    olga: h.actor(A, 'Olga', 'OWNER'),
    bob: h.actor(B, 'Bob', 'OWNER'),
  };
}
