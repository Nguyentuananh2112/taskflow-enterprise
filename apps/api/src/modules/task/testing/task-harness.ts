import { ROLE_PERMISSIONS } from '@taskflow/contracts';

import {
  FakeClock,
  FakeUnitOfWork,
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
import {
  InMemoryAssigneeDirectory,
  InMemoryTaskAuditLogRepository,
  InMemoryTaskProjectStore,
  InMemoryUserRefReader,
} from '../infrastructure/persistence/in-memory/in-memory-task-collaborators';
import { InMemoryTaskDatabase } from '../infrastructure/persistence/in-memory/in-memory-task-database';
import { InMemoryTaskReadModel } from '../infrastructure/persistence/in-memory/in-memory-task-read-model';
import { InMemoryTaskRepository } from '../infrastructure/persistence/in-memory/in-memory-task.repository';
import { FractionalIndexRankGenerator } from '../infrastructure/rank/fractional-index-rank-generator';

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

export function createTaskHarness() {
  const db = new InMemoryTaskDatabase();
  const s = db.state;
  for (const [name, userId] of Object.entries(U)) {
    s.users.set(userId, {
      id: userId,
      fullName: name,
      deletedAt: name === 'Zed' ? new Date(NOW) : null,
    });
  }
  for (const [p, role] of Object.entries(ROLE_IN_W1))
    s.members.push({ workspaceId: W1, userId: U[p as Person], role });
  s.members.push({ workspaceId: W2, userId: U.Otto, role: 'OWNER' });
  const project = (pid: string, workspaceId: string, keyPrefix: string, archived = false) =>
    s.projects.set(pid, {
      id: pid,
      workspaceId,
      keyPrefix,
      nextTaskNumber: 1,
      archivedAt: archived ? new Date(NOW) : null,
    });
  project(P1, W1, 'TF');
  project(P2, W1, 'ARC', true);
  project(P3, W1, 'WEB');
  project(Q1, W2, 'TF');

  const uow = new FakeUnitOfWork(db);
  const users = new InMemoryUserRefReader(db);
  const tasks = new InMemoryTaskRepository(db);
  const audit = new InMemoryTaskAuditLogRepository(db);
  const events = new SpyEventBus();
  const notifier = createSpy<ITaskRealtimeNotifier>(uow);
  const logger = new SpyLogger();
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const policy = new TaskPolicy(contractsPermissions);
  const projects = new InMemoryTaskProjectStore(db);
  const deps: TaskCommandDeps = {
    tasks,
    projects,
    assignees: new InMemoryAssigneeDirectory(db),
    users,
    audit,
    ranks: new FractionalIndexRankGenerator(),
    notifier,
    events,
    uow,
    clock,
    ids,
    policy,
    logger,
  };
  const commands = new TaskCommands(deps);
  let seq = 0;

  return {
    db,
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
    queries: new TaskQueries({ readModel: new InMemoryTaskReadModel(db, users), projects, policy }),
    cleaner: new TaskAssignmentCleaner(commands),
    scope: (p: Person, projectId = P1, extra: Partial<TaskScope> = {}): TaskScope => ({
      workspaceId: W1,
      projectId,
      actor: actor(p),
      ...extra,
    }),
    /** Chèn thẳng một task (như dữ liệu có sẵn) — không audit, không event. */
    seedTask(over: Partial<TaskProps> & { rank: string }): TaskProps {
      seq += 1;
      const projectId = over.projectId ?? P1;
      const row = db.state.projects.get(projectId)!;
      const number = over.number ?? row.nextTaskNumber;
      row.nextTaskNumber = Math.max(row.nextTaskNumber, number + 1);
      const props: TaskProps = {
        id: id(1000 + seq),
        workspaceId: row.workspaceId,
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
      db.state.tasks.set(props.id, Task.reconstitute(props).toPrimitives());
      return props;
    },
    // Luôn đọc `db.state` hiện tại: rollback của FakeUnitOfWork thay cả object state.
    row: (taskId: string) => db.state.tasks.get(taskId)!,
    auditOf: (taskId: string) => db.state.audit.filter((a) => a.taskId === taskId),
    emitted: () => notifier.calls.filter((c) => c.method === 'emitToProject'),
    randomId: () => id(9999),
  };
}

export type TaskHarness = ReturnType<typeof createTaskHarness>;
