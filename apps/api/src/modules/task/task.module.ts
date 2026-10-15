import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../../core/domain';
import type { IEventBus } from '../../core/events/event-bus';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import type { ITaskAuditLogRepository } from './application/ports/audit-log.port';
import type {
  IAssigneeDirectory,
  ITaskProjectStore,
  ITaskRealtimeNotifier,
  IUserRefReader,
} from './application/ports/collaborators.port';
import type { ITaskReadModel } from './application/ports/task-read-model.port';
import type { ITaskRepository } from './application/ports/task-repository.port';
import type { IRolePermissions } from './application/task-actor';
import { TaskAssignmentCleaner } from './application/task-assignment-cleaner';
import { TaskCommands } from './application/task-commands';
import { TaskPolicy } from './application/task.policy';
import { AssignTaskUseCase } from './application/use-cases/assign-task.use-case';
import { CreateTaskUseCase } from './application/use-cases/create-task.use-case';
import { DeleteTaskUseCase } from './application/use-cases/delete-task.use-case';
import { MoveTaskUseCase } from './application/use-cases/move-task.use-case';
import { TaskQueries } from './application/use-cases/task.queries';
import { UpdateTaskUseCase } from './application/use-cases/update-task.use-case';
import {
  InMemoryAssigneeDirectory,
  InMemoryTaskAuditLogRepository,
  InMemoryTaskProjectStore,
  InMemoryUserRefReader,
} from './infrastructure/persistence/in-memory/in-memory-task-collaborators';
import { InMemoryTaskDatabase } from './infrastructure/persistence/in-memory/in-memory-task-database';
import { InMemoryTaskReadModel } from './infrastructure/persistence/in-memory/in-memory-task-read-model';
import { InMemoryTaskRepository } from './infrastructure/persistence/in-memory/in-memory-task.repository';
import { FractionalIndexRankGenerator } from './infrastructure/rank/fractional-index-rank-generator';
import { TaskController } from './presentation/task.controller';
import { taskRoutes } from './presentation/task.routes';
import type { TaskMembershipSource } from './presentation/task-membership';

export interface TaskRepositories {
  tasks: ITaskRepository;
  readModel: ITaskReadModel;
  projects: ITaskProjectStore;
  assignees: IAssigneeDirectory;
  users: IUserRefReader;
  audit: ITaskAuditLogRepository;
}

/**
 * Repository InMemory (dev/test). `db` giữ bản sao project/user/member riêng — composition root phản
 * chiếu từ Workspace/Auth sang (chế độ bộ nhớ). Prisma (T-023) đọc thẳng bảng chung, không cần.
 */
export function createInMemoryTaskRepositories() {
  const db = new InMemoryTaskDatabase();
  const users = new InMemoryUserRefReader(db);
  return {
    db,
    tasks: new InMemoryTaskRepository(db),
    readModel: new InMemoryTaskReadModel(db, users),
    projects: new InMemoryTaskProjectStore(db),
    assignees: new InMemoryAssigneeDirectory(db),
    users,
    audit: new InMemoryTaskAuditLogRepository(db),
  };
}

export interface TaskModuleDeps {
  repos: TaskRepositories;
  /** Ma trận quyền (contracts ROLE_PERMISSIONS) — Workspace là nguồn, wire ở composition root. */
  permissions: IRolePermissions;
  /** Gateway realtime (sau commit). Payload `task:*` do use case dựng sẵn (task-realtime.ts). */
  notifier: ITaskRealtimeNotifier;
  membership: TaskMembershipSource;
  events: IEventBus;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface TaskModule {
  /** Router gắn tại `TASKS_PATH` (cần `authenticate` của auth). */
  routes(authenticate: RequestHandler): Router;
  /** Hiện thực `ITaskAssignmentCleaner` của Workspace (ADR-044, ADR-093). */
  cleaner: TaskAssignmentCleaner;
}

/** Composition của module Task (ADR-016): wire nội bộ module, port ngoài được tiêm vào. */
export function createTaskModule(d: TaskModuleDeps): TaskModule {
  const policy = new TaskPolicy(d.permissions);
  const commands = new TaskCommands({
    ...d.repos,
    ranks: new FractionalIndexRankGenerator(),
    notifier: d.notifier,
    events: d.events,
    uow: d.uow,
    clock: d.clock,
    ids: d.ids,
    policy,
    logger: d.logger,
  });
  const controller = new TaskController({
    create: new CreateTaskUseCase(commands),
    update: new UpdateTaskUseCase(commands),
    move: new MoveTaskUseCase(commands),
    assign: new AssignTaskUseCase(commands),
    remove: new DeleteTaskUseCase(commands),
    queries: new TaskQueries({ readModel: d.repos.readModel, projects: d.repos.projects, policy }),
    responder: d.responder,
  });
  return {
    routes: (authenticate) =>
      taskRoutes({
        controller,
        membership: d.membership,
        permissions: d.permissions,
        scope: { projects: d.repos.projects, tasks: d.repos.tasks },
        authenticate,
        limit: d.limit,
      }),
    cleaner: new TaskAssignmentCleaner(commands),
  };
}
