import {
  FakeClock,
  FakeRandom,
  FakeUnitOfWork,
  SequentialIdGenerator,
  SpyLogger,
  createSpy,
} from '../../../../test/support';
import type {
  ITaskAssignmentCleaner,
  IWorkspaceRealtimeNotifier,
} from '../application/ports/collaborators.port';
import type { Actor } from '../application/workspace-shared';
import { WorkspaceCreator } from '../application/workspace-creator';
import { Membership } from '../domain/membership';
import { Project } from '../domain/project';
import type { WorkspaceRole } from '../domain/roles';
import { Workspace } from '../domain/workspace';
import {
  InMemoryMembershipRepository,
  InMemoryProjectRepository,
  InMemoryWorkspaceRepository,
} from '../infrastructure/persistence/in-memory/in-memory-repositories';
import {
  InMemoryUserDirectory,
  InMemoryWorkspacePurger,
  InMemoryWorkspaceQueries,
} from '../infrastructure/persistence/in-memory/in-memory-queries';

export const NOW = '2026-11-01T00:00:00.000Z';

/** Module Task giả (ADR-093): ghi lời gọi + có trong transaction không; trả số task cấu hình được. */
export class SpyTaskAssignmentCleaner implements ITaskAssignmentCleaner {
  readonly calls: {
    input: { workspaceId: string; userId: string; actorId: string };
    inTransaction: boolean;
  }[] = [];
  readonly assigned = new Map<string, number>();

  constructor(private readonly uow: { readonly inTransaction: boolean }) {}

  unassignAllForUser(input: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<{ unassignedTaskCount: number }> {
    this.calls.push({ input, inTransaction: this.uow.inTransaction });
    const count = this.assigned.get(input.userId) ?? 0;
    this.assigned.set(input.userId, 0);
    return Promise.resolve({ unassignedTaskCount: count });
  }
}

export function createWorkspaceHarness(random = new FakeRandom()) {
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryMembershipRepository();
  const projects = new InMemoryProjectRepository();
  const users = new InMemoryUserDirectory();
  const uow = new FakeUnitOfWork(workspaces, memberships, projects);
  const queries = new InMemoryWorkspaceQueries(workspaces, memberships, projects, users);
  const purger = new InMemoryWorkspacePurger(workspaces, memberships, projects);
  const notifier = createSpy<IWorkspaceRealtimeNotifier>(uow);
  const cleaner = new SpyTaskAssignmentCleaner(uow);
  const logger = new SpyLogger();
  const creator = new WorkspaceCreator({ workspaces, memberships, ids, clock });

  const h = {
    clock,
    ids,
    random,
    workspaces,
    memberships,
    projects,
    users,
    uow,
    queries,
    purger,
    notifier,
    cleaner,
    logger,
    creator,

    user(name: string) {
      const id = `user-${name.toLowerCase()}`;
      users.seed({ id, email: `${name.toLowerCase()}@example.com`, fullName: name });
      return id;
    },

    async workspace(slug: string, members: Record<string, WorkspaceRole>) {
      const ws = Workspace.create({
        id: `ws-${slug}`,
        name: slug.toUpperCase(),
        slug,
        now: clock.now(),
      });
      await workspaces.add(ws);
      for (const [name, role] of Object.entries(members)) {
        const userId = h.user(name);
        await memberships.add(
          Membership.create({ id: ids.next(), workspaceId: ws.id, userId, role, now: clock.now() }),
        );
      }
      return ws.id;
    },

    async project(workspaceId: string, keyPrefix: string, archived = false) {
      const p = Project.create({
        id: `p-${keyPrefix.toLowerCase()}`,
        workspaceId,
        name: keyPrefix,
        keyPrefix,
        description: null,
        now: clock.now(),
      });
      if (archived) p.archive(clock.now());
      await projects.add(p);
      return p.id;
    },

    actor(workspaceId: string, name: string, role: WorkspaceRole): Actor {
      return { userId: `user-${name.toLowerCase()}`, workspaceId, role };
    },

    roleOf(workspaceId: string, name: string) {
      return (
        memberships
          .rows()
          .find((m) => m.workspaceId === workspaceId && m.userId === `user-${name.toLowerCase()}`)
          ?.role ?? null
      );
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
  h.user('Nina');
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
