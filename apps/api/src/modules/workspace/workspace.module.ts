import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator, IRandom } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { WorkspaceMembershipReader } from './application/adapters/membership-reader';
import { WorkspaceProjectAccessChecker } from './application/adapters/project-access-checker';
import { WorkspaceAccess } from './application/adapters/workspace-access';
import { DefaultWorkspaceProvisioner } from './application/adapters/workspace-provisioner';
import { WorkspaceExit } from './application/adapters/workspace-exit';
import type {
  ITaskAssignmentCleaner,
  ICompanyMembershipGate,
  IUserDirectory,
  IWorkspaceRealtimeNotifier,
} from './application/ports/collaborators.port';
import type { IWorkspaceQueries } from './application/ports/queries.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from './application/ports/repositories.port';
import { AddMemberUseCase } from './application/use-cases/add-member.use-case';
import { ChangeMemberRoleUseCase } from './application/use-cases/change-member-role.use-case';
import { CreateProjectUseCase } from './application/use-cases/create-project.use-case';
import { CreateWorkspaceUseCase } from './application/use-cases/create-workspace.use-case';
import { DeleteWorkspaceUseCase } from './application/use-cases/delete-workspace.use-case';
import { ListMembersQuery } from './application/use-cases/list-members.query';
import { GetProjectQuery, ListProjectsQuery } from './application/use-cases/project.queries';
import { RemoveMemberUseCase } from './application/use-cases/remove-member.use-case';
import { RestoreWorkspaceUseCase } from './application/use-cases/restore-workspace.use-case';
import { SetProjectArchivedUseCase } from './application/use-cases/set-project-archived.use-case';
import { UpdateProjectUseCase } from './application/use-cases/update-project.use-case';
import { UpdateWorkspaceUseCase } from './application/use-cases/update-workspace.use-case';
import {
  GetWorkspaceQuery,
  ListMyWorkspacesQuery,
} from './application/use-cases/workspace.queries';
import { WorkspaceCreator } from './application/workspace-creator';
import {
  InMemoryUserDirectory,
  InMemoryWorkspaceQueries,
} from './infrastructure/persistence/in-memory/in-memory-queries';
import {
  InMemoryMembershipRepository,
  InMemoryProjectRepository,
  InMemoryWorkspaceRepository,
} from './infrastructure/persistence/in-memory/in-memory-repositories';
import { requireProject } from './presentation/membership';
import { ProjectController } from './presentation/project.controller';
import { WorkspaceController } from './presentation/workspace.controller';
import { workspaceRoutes } from './presentation/workspace.routes';

export interface WorkspaceRepositories {
  workspaces: IWorkspaceRepository;
  memberships: IMembershipRepository;
  projects: IProjectRepository;
  queries: IWorkspaceQueries;
}

/** Repository InMemory (dev/test); `directory` cần được đồng bộ với user của auth (composition root). */
export function createInMemoryWorkspaceRepositories() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryMembershipRepository();
  const projects = new InMemoryProjectRepository();
  const directory = new InMemoryUserDirectory();
  const queries = new InMemoryWorkspaceQueries(workspaces, memberships, projects, directory);
  return { workspaces, memberships, projects, queries, directory };
}

export interface WorkspaceModuleDeps {
  repos: WorkspaceRepositories;
  /** Tra user theo email/id — composition root bọc repository user của auth (ADR-093). */
  users: IUserDirectory;
  notifier: IWorkspaceRealtimeNotifier;
  /** Mốc 3.5: còn thuộc công ty + chưa quá `access_until` (module company, nối ở composition). */
  company: ICompanyMembershipGate;
  cleaner: ITaskAssignmentCleaner;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  clock: IClock;
  random: IRandom;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface WorkspaceModule {
  /** Router cần `authenticate` của auth — tạo sau khi có module auth. */
  routes(authenticate: RequestHandler): Router;
  access: WorkspaceAccess;
  accessChecker: WorkspaceProjectAccessChecker;
  provisioner: DefaultWorkspaceProvisioner;
  membershipReader: WorkspaceMembershipReader;
  /** `IWorkspaceExitPort` của company — rời mọi ws khi hoàn tất nghỉ việc (T-062). */
  exit: WorkspaceExit;
}

/** Composition của module Workspace/Member/Project (ADR-016). */
export function createWorkspaceModule(d: WorkspaceModuleDeps): WorkspaceModule {
  const { workspaces, memberships, projects, queries } = d.repos;
  const { uow, ids, clock, random, logger, notifier, cleaner, users, company } = d;
  const creator = new WorkspaceCreator({ workspaces, memberships, ids, clock });
  const access = new WorkspaceAccess({ workspaces, memberships, company });

  const workspaceController = new WorkspaceController({
    listMine: new ListMyWorkspacesQuery({ queries, clock }),
    create: new CreateWorkspaceUseCase({ creator, uow, random }),
    get: new GetWorkspaceQuery({ workspaces }),
    update: new UpdateWorkspaceUseCase({ workspaces, uow, clock, logger }),
    remove: new DeleteWorkspaceUseCase({
      workspaces,
      memberships,
      projects,
      notifier,
      uow,
      clock,
      logger,
    }),
    restore: new RestoreWorkspaceUseCase({ workspaces, memberships, uow, clock, logger }),
    listMembers: new ListMembersQuery({ queries }),
    addMember: new AddMemberUseCase({
      memberships,
      workspaces,
      users,
      company,
      uow,
      ids,
      clock,
      logger,
    }),
    changeRole: new ChangeMemberRoleUseCase({
      memberships,
      workspaces,
      users,
      cleaner,
      notifier,
      uow,
      clock,
      logger,
    }),
    removeMember: new RemoveMemberUseCase({
      memberships,
      workspaces,
      projects,
      cleaner,
      notifier,
      uow,
      logger,
    }),
    responder: d.responder,
  });
  const getProject = new GetProjectQuery({ projects });
  const projectController = new ProjectController({
    list: new ListProjectsQuery({ queries }),
    create: new CreateProjectUseCase({ projects, workspaces, uow, ids, clock }),
    get: getProject,
    update: new UpdateProjectUseCase({ projects, workspaces, notifier, uow, clock }),
    setArchived: new SetProjectArchivedUseCase({ projects, workspaces, notifier, uow, clock }),
    responder: d.responder,
  });

  return {
    routes: (authenticate) =>
      workspaceRoutes({
        workspaces: workspaceController,
        projects: projectController,
        access,
        projectExists: requireProject(getProject),
        authenticate,
        limit: d.limit,
      }),
    access,
    accessChecker: new WorkspaceProjectAccessChecker({
      workspaces,
      memberships,
      projects,
      company,
    }),
    provisioner: new DefaultWorkspaceProvisioner({ creator, projects, random, ids, clock }),
    membershipReader: new WorkspaceMembershipReader({ queries }),
    exit: new WorkspaceExit({
      workspaces,
      memberships,
      projects,
      queries,
      cleaner,
      notifier,
      uow,
      logger,
    }),
  };
}
