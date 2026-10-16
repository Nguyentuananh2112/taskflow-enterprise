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
import type {
  ITaskAssignmentCleaner,
  IUserDirectory,
  IHrGrantNotifier,
  IWorkspaceRealtimeNotifier,
} from './application/ports/collaborators.port';
import type { IWorkspaceQueries } from './application/ports/queries.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from './application/ports/repositories.port';
import { AddMemberUseCase } from './application/use-cases/add-member.use-case';
import { HrAccess } from './application/adapters/hr-access';
import { HrAuditWriter } from './application/hr-audit-writer';
import type { IHrAuditLog } from './application/ports/hr-audit.port';
import type { IMemberDepartureLog, IMembershipTenureReader } from './application/ports/tenure.port';
import { ChangeMemberRoleUseCase } from './application/use-cases/change-member-role.use-case';
import { ListHrAuditLogsQuery } from './application/use-cases/list-hr-audit-logs.query';
import { SetMemberGrantsUseCase } from './application/use-cases/set-member-grants.use-case';
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
  InMemoryHrAuditLog,
  InMemoryMembershipRepository,
  InMemoryProjectRepository,
  InMemoryWorkspaceRepository,
} from './infrastructure/persistence/in-memory/in-memory-repositories';
import {
  InMemoryMemberDepartures,
  InMemoryMembershipTenureReader,
} from './infrastructure/persistence/in-memory/in-memory-tenure';
import { requireProject } from './presentation/membership';
import { HrController } from './presentation/hr.controller';
import { ProjectController } from './presentation/project.controller';
import { WorkspaceController } from './presentation/workspace.controller';
import { workspaceRoutes } from './presentation/workspace.routes';

export interface WorkspaceRepositories {
  workspaces: IWorkspaceRepository;
  memberships: IMembershipRepository;
  projects: IProjectRepository;
  queries: IWorkspaceQueries;
  /** Mốc 3: HrAuditLog — dùng chung với attendance / leave qua `HrAuditWriter` (T-037). */
  hrAudit: IHrAuditLog;
  /** T-037b: nhiệm kỳ đã kết thúc (ghi khi xóa thành viên) + đọc nhiệm kỳ cho bảng công. */
  departures: IMemberDepartureLog;
  tenure: IMembershipTenureReader;
}

/** Repository InMemory (dev/test); `directory` cần được đồng bộ với user của auth (composition root). */
export function createInMemoryWorkspaceRepositories() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryMembershipRepository();
  const projects = new InMemoryProjectRepository();
  const directory = new InMemoryUserDirectory();
  const queries = new InMemoryWorkspaceQueries(workspaces, memberships, projects, directory);
  const hrAudit = new InMemoryHrAuditLog((id) => directory.users.get(id)?.fullName);
  const departures = new InMemoryMemberDepartures();
  const tenure = new InMemoryMembershipTenureReader(memberships, departures);
  return { workspaces, memberships, projects, queries, directory, hrAudit, departures, tenure };
}

export interface WorkspaceModuleDeps {
  repos: WorkspaceRepositories;
  /** Tra user theo email/id — composition root bọc repository user của auth (ADR-093). */
  users: IUserDirectory;
  notifier: IWorkspaceRealtimeNotifier;
  /** HR_GRANTED / HR_REVOKED bền (ADR-123) — composition nối vào module notifications. */
  hrNotifier: IHrGrantNotifier;
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
  /** Mốc 3 (T-037): chốt mọi lệnh ghi `hr:manage` — attendance (T-038) / leave (T-039) gọi trong tx. */
  hrAccess: HrAccess;
  /** Mốc 3: ghi HrAuditLog trong transaction của bên gọi. */
  hrAudit: HrAuditWriter;
  /** T-037b: `IMembershipTenurePort` của attendance (khớp cấu trúc). */
  tenure: IMembershipTenureReader;
  accessChecker: WorkspaceProjectAccessChecker;
  provisioner: DefaultWorkspaceProvisioner;
  membershipReader: WorkspaceMembershipReader;
}

/** Composition của module Workspace/Member/Project (ADR-016). */
export function createWorkspaceModule(d: WorkspaceModuleDeps): WorkspaceModule {
  const { workspaces, memberships, projects, queries, hrAudit } = d.repos;
  const { uow, ids, clock, random, logger, notifier, cleaner, users } = d;
  const creator = new WorkspaceCreator({ workspaces, memberships, ids, clock });
  const access = new WorkspaceAccess({ workspaces, memberships });
  const audit = new HrAuditWriter({ hrAudit, ids, clock });

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
    addMember: new AddMemberUseCase({ memberships, workspaces, users, uow, ids, clock, logger }),
    changeRole: new ChangeMemberRoleUseCase({
      memberships,
      workspaces,
      users,
      cleaner,
      notifier,
      audit,
      hrNotifier: d.hrNotifier,
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
      departures: d.repos.departures,
      ids,
      clock,
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
        hr: new HrController({
          setGrants: new SetMemberGrantsUseCase({
            memberships,
            workspaces,
            users,
            audit,
            notifier,
            hrNotifier: d.hrNotifier,
            uow,
            clock,
            logger,
          }),
          listAuditLogs: new ListHrAuditLogsQuery({ hrAudit }),
          responder: d.responder,
        }),
        access,
        projectExists: requireProject(getProject),
        authenticate,
        limit: d.limit,
      }),
    access,
    hrAccess: new HrAccess({ workspaces, memberships }),
    hrAudit: audit,
    tenure: d.repos.tenure,
    accessChecker: new WorkspaceProjectAccessChecker({ workspaces, memberships, projects }),
    provisioner: new DefaultWorkspaceProvisioner({ creator, projects, random, ids, clock }),
    membershipReader: new WorkspaceMembershipReader({ queries }),
  };
}
