import { ROLE_PERMISSIONS } from '@taskflow/contracts';

import {
  FakeClock,
  SequentialIdGenerator,
  SpyEventBus,
  SpyLogger,
  createSpy,
} from '../../../../test/support';
import type { ITaskRealtimeNotifier } from '../application/ports/collaborators.port';
import type { IRolePermissions, TaskActor, TaskRole, TaskScope } from '../application/task-actor';
import { TaskAssignmentCleaner } from '../application/task-assignment-cleaner';
import { TaskCommands, type TaskCommandDeps } from '../application/task-commands';
import { TaskPolicy } from '../application/task.policy';
import { AssignTaskUseCase } from '../application/use-cases/assign-task.use-case';
import { CreateTaskUseCase } from '../application/use-cases/create-task.use-case';
import { DeleteTaskUseCase } from '../application/use-cases/delete-task.use-case';
import { MoveTaskUseCase } from '../application/use-cases/move-task.use-case';
import { TaskQueries } from '../application/use-cases/task.queries';
import { UpdateTaskUseCase } from '../application/use-cases/update-task.use-case';
import { Task, type TaskProps } from '../domain/task';
import type { TaskStatus } from '../domain/task-status';
import { FractionalIndexRankGenerator } from '../infrastructure/rank/fractional-index-rank-generator';
import { inMemoryTaskBackend, type TaskBackend } from './task-backend';

// Fixture chuẩn test-spec-task.md §0.2.
export const NOW = '2026-10-15T08:00:00.000Z';
const id = (n: number) => `0199e5a2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
export const W1 = id(1);
export const W2 = id(2);
export const P1 = id(11);
export const P2 = id(12);
export const P3 = id(13);
export const Q1 = id(14);
export const U = {
  Olivia: id(21),
  Pam: id(22),
  Mia: id(23),
  Max: id(24),
  Vic: id(25),
  Otto: id(26),
  Zed: id(27),
} as const;
export type Person = keyof typeof U;
const ROLE_IN_W1: Partial<Record<Person, TaskRole>> = {
  Olivia: 'OWNER',
  Pam: 'PM',
  Mia: 'MEMBER',
  Max: 'MEMBER',
  Vic: 'VIEWER',
};
export const actor = (p: Person): TaskActor => ({ userId: U[p], role: ROLE_IN_W1[p] ?? 'VIEWER' });

/** Bảng quyền dạng dữ liệu của contracts — khớp RBAC của Workspace nhờ test parity (ADR-080). */
export const contractsPermissions: IRolePermissions = {
  allows: (role, permission) => ROLE_PERMISSIONS[role].includes(permission),
};

async function seedFixtures(b: TaskBackend): Promise<void> {
  for (const [name, userId] of Object.entries(U)) {
    // Zed đã ẩn danh hóa (D2): DB lưu tên thay thế, membership đã xóa.
    const deleted = name === 'Zed';
    await b.seedUser({
      id: userId,
      fullName: deleted ? 'Người dùng đã xóa' : name,
      deletedAt: deleted ? new Date(NOW) : null,
    });
  }
  await b.seedWorkspace(W1);
  await b.seedWorkspace(W2);
  for (const [p, role] of Object.entries(ROLE_IN_W1)) {
    await b.seedMember({ workspaceId: W1, userId: U[p as Person], role });
  }
  await b.seedMember({ workspaceId: W2, userId: U.Otto, role: 'OWNER' });
  const project = (pid: string, workspaceId: string, keyPrefix: string, archived = false) =>
    b.seedProject({
      id: pid,
      workspaceId,
      keyPrefix,
      nextTaskNumber: 1,
      archivedAt: archived ? new Date(NOW) : null,
    });
  await project(P1, W1, 'TF');
  await project(P2, W1, 'ARC', true);
  await project(P3, W1, 'WEB');
  await project(Q1, W2, 'TF');
}

/** Harness test-spec §0: use case thật trên `backend` (InMemory mặc định, Prisma ở tầng I). */
export async function createTaskHarness(backend: TaskBackend = inMemoryTaskBackend()) {
  await seedFixtures(backend);
  const { uow } = backend;
  const events = new SpyEventBus();
  const notifier = createSpy<ITaskRealtimeNotifier>(uow);
  const logger = new SpyLogger();
  const clock = new FakeClock(NOW);
  const policy = new TaskPolicy(contractsPermissions);
  const deps: TaskCommandDeps = {
    tasks: backend.tasks,
    projects: backend.projects,
    assignees: backend.assignees,
    users: backend.users,
    audit: backend.audit,
    ranks: new FractionalIndexRankGenerator(),
    notifier,
    events,
    uow,
    clock,
    ids: new SequentialIdGenerator(),
    policy,
    logger,
  };
  const commands = new TaskCommands(deps);
  let seq = 0;

  type SeedInput = Partial<TaskProps> & { rank: string };
  const buildTask = (
    over: SeedInput,
    project: { workspaceId: string },
    projectId: string,
    number: number,
  ): TaskProps => {
    seq += 1;
    return {
      id: id(1000 + seq),
      workspaceId: project.workspaceId,
      projectId,
      number,
      title: `Task ${number}`,
      description: null,
      status: 'TODO',
      priority: 'MEDIUM',
      version: 1,
      dueDate: null,
      assigneeId: null,
      createdById: U.Mia,
      deletedAt: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      ...over,
    };
  };
  const seedTask = async (over: SeedInput): Promise<TaskProps> => {
    const projectId = over.projectId ?? P1;
    const project = (await backend.projectRow(projectId))!;
    // Số mặc định = bộ đếm của project (như dữ liệu thật) — không trùng số use case đã cấp.
    const props = buildTask(over, project, projectId, over.number ?? project.nextTaskNumber);
    await backend.insertTask(Task.reconstitute(props).toPrimitives());
    if (project.nextTaskNumber <= props.number) {
      await backend.patchProject(projectId, { nextTaskNumber: props.number + 1 });
    }
    return props;
  };
  /** Nhiều task của CÙNG project (P1) trong một lệnh chèn — cột lớn chạy nhanh cả trên Postgres. */
  const seedTasks = async (overs: readonly Omit<SeedInput, 'projectId' | 'number'>[]) => {
    const project = (await backend.projectRow(P1))!;
    const all = overs.map((over, i) => buildTask(over, project, P1, project.nextTaskNumber + i));
    await backend.insertTasks(all.map((p) => Task.reconstitute(p).toPrimitives()));
    await backend.patchProject(P1, { nextTaskNumber: project.nextTaskNumber + all.length });
    return all;
  };
  const row = async (taskId: string) => (await backend.taskRows()).find((t) => t.id === taskId)!;

  return {
    backend,
    deps,
    uow,
    events,
    notifier,
    logger,
    clock,
    policy,
    create: new CreateTaskUseCase(commands),
    move: new MoveTaskUseCase(commands),
    assign: new AssignTaskUseCase(commands),
    update: new UpdateTaskUseCase(commands),
    remove: new DeleteTaskUseCase(commands),
    queries: new TaskQueries({ readModel: backend.readModel, projects: backend.projects, policy }),
    cleaner: new TaskAssignmentCleaner(commands),
    scope: (p: Person, projectId = P1, extra: Partial<TaskScope> = {}): TaskScope => ({
      workspaceId: W1,
      projectId,
      actor: actor(p),
      ...extra,
    }),
    seedTask,
    seedTasks,
    row,
    patchTask: (taskId: string, patch: Partial<TaskProps>) => backend.patchTask(taskId, patch),
    taskCount: async () => (await backend.taskRows()).length,
    allAudit: () => backend.auditRows(),
    auditOf: async (taskId: string) =>
      (await backend.auditRows()).filter((a) => a.taskId === taskId),
    project: async (projectId: string) => (await backend.projectRow(projectId))!,
    /** Id task sống của một cột (P1), theo thứ tự byte của rank. */
    column: async (status: TaskStatus, projectId = P1) =>
      (await backend.taskRows())
        .filter((t) => t.projectId === projectId && t.status === status && t.deletedAt === null)
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
        .map((t) => t.id),
    emitted: () => notifier.calls.filter((c) => c.method === 'emitToProject'),
    randomId: () => id(9999),
  };
}

export type TaskHarness = Awaited<ReturnType<typeof createTaskHarness>>;
