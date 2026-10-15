import type { TaskDto } from '@taskflow/contracts';

import { requestContext } from '../../../core/context/request-context';
import type { IClock, IIdGenerator } from '../../../core/domain';
import {
  BusinessRuleViolationError,
  ProjectArchivedError,
  ResourceConflictError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../core/errors';
import type { IEventBus } from '../../../core/events/event-bus';
import type { ILogger } from '../../../core/logging/logger';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { Task } from '../domain/task';
import type { ITaskAuditLogRepository } from './ports/audit-log.port';
import type {
  IAssigneeDirectory,
  IRankGenerator,
  ITaskProjectStore,
  ITaskRealtimeNotifier,
  IUserRefReader,
  ProjectRef,
} from './ports/collaborators.port';
import { RankConflictError, type ITaskRepository } from './ports/task-repository.port';
import { auditValuesOf } from './task-audit';
import type { RealtimeEventMeta, TaskScope } from './task-actor';
import { buildTaskDto } from './task-dto';
import type { TaskPolicy } from './task.policy';
import { realtimeMessageOf } from './task-realtime';

export interface TaskCommandDeps {
  tasks: ITaskRepository;
  projects: ITaskProjectStore;
  assignees: IAssigneeDirectory;
  users: IUserRefReader;
  audit: ITaskAuditLogRepository;
  ranks: IRankGenerator;
  notifier: ITaskRealtimeNotifier;
  events: IEventBus;
  uow: IUnitOfWork;
  clock: IClock;
  ids: IIdGenerator;
  policy: TaskPolicy;
  logger: ILogger;
}

/** Trùng rank: thử lại cả transaction tối đa 3 lần rồi 409 (data-and-api §1.3). */
export const RANK_RETRY_LIMIT = 3;

/**
 * Các bước dùng chung của lệnh ghi task, theo thứ tự kiểm của test-spec §0.4:
 * 404 → 403 → 422 → 409 → domain → no-op → ghi + audit trong transaction → phát sau commit.
 */
export class TaskCommands {
  constructor(readonly d: TaskCommandDeps) {}

  /** ADR-020 lớp 2: project ∈ workspace, nếu không ⇒ 404 (không lộ tồn tại). */
  async loadProject(scope: TaskScope): Promise<ProjectRef> {
    const project = await this.d.projects.findInWorkspace({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    if (!project) throw new ResourceNotFoundError('project');
    return project;
  }

  /** Task ∈ project ∈ workspace và chưa xóa mềm, nếu không ⇒ 404 (R16). */
  async loadTask(scope: TaskScope, taskId: string): Promise<{ project: ProjectRef; task: Task }> {
    const project = await this.loadProject(scope);
    const task = await this.d.tasks.findLive(scope.workspaceId, scope.projectId, taskId);
    if (!task) throw new ResourceNotFoundError('task');
    return { project, task };
  }

  assertWritable(project: ProjectRef): void {
    if (project.isArchived) throw new ProjectArchivedError(project.id);
  }

  /** R6/ADR-044: assignee là thành viên hiện tại với role ≥ MEMBER (user ẩn danh ⇒ `null`). */
  async assertAssignable(workspaceId: string, userId: string): Promise<void> {
    const role = await this.d.assignees.roleOf({ workspaceId, userId });
    if (role === null || role === 'VIEWER') {
      throw new BusinessRuleViolationError(
        'ASSIGNEE_NOT_MEMBER',
        'Người được giao phải là thành viên có quyền nhận việc.',
      );
    }
  }

  /** ADR-010: lệch version ⇒ 409 kèm `current` (TaskDto mới nhất) để FE hòa giải không refetch. */
  async assertVersion(task: Task, expected: number, project: ProjectRef): Promise<void> {
    if (task.version === expected) return;
    throw new VersionConflictError(task.version, await this.dto(task, project));
  }

  /** Vỏ realtime của lệnh: actor + `X-Client-Id` (data-and-api §4.3). */
  static metaOf(scope: TaskScope): RealtimeEventMeta {
    return { actorId: scope.actor.userId, originClientId: scope.clientId ?? null };
  }

  dto(task: Task, project: ProjectRef): Promise<TaskDto> {
    return buildTaskDto(this.d.users, task, project.keyPrefix);
  }

  /**
   * Ghi task đã đổi (UPDATE có điều kiện version), một dòng audit cho mỗi domain event, rồi hẹn
   * phát realtime + domain event SAU commit. Trả DTO sau khi ghi.
   */
  async persist(
    task: Task,
    project: ProjectRef,
    meta: RealtimeEventMeta,
    write: { kind: 'add' } | { kind: 'save'; expectedVersion: number },
  ): Promise<TaskDto> {
    if (write.kind === 'add') {
      await this.d.tasks.add(task);
    } else if (!(await this.d.tasks.save(task, write.expectedVersion))) {
      await this.conflictFromStore(task, project);
    }
    const events = task.pullDomainEvents();
    const requestId = requestContext.requestId() ?? null;
    for (const event of events) {
      await this.d.audit.append({
        id: this.d.ids.next(),
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorId: event.actorId,
        requestId,
        createdAt: event.occurredAt,
        ...auditValuesOf(event),
      });
    }
    const dto = await this.dto(task, project);
    const message = realtimeMessageOf(events, dto);
    this.d.uow.afterCommit(() =>
      this.bestEffort('task.realtime_failed', task, async () => {
        if (message)
          await this.d.notifier.emitToProject({ projectId: task.projectId, ...message }, meta);
      }),
    );
    this.d.uow.afterCommit(() =>
      this.bestEffort('task.events_publish_failed', task, () => this.d.events.publish(events)),
    );
    return dto;
  }

  /** Chạy `work` trong transaction; trùng rank ⇒ thử lại với hàng xóm đọc mới (tối đa 3 lần). */
  async inTransactionWithRankRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.d.uow.run(work);
      } catch (err) {
        if (!(err instanceof RankConflictError)) throw err;
        this.d.logger.warn({ attempt }, 'task.rank_conflict_retry');
        if (attempt >= RANK_RETRY_LIMIT) {
          throw new ResourceConflictError({ field: 'rank', reason: 'RANK_COLLISION' });
        }
      }
    }
  }

  /** `save` trả false: version trong DB đã khác lúc đọc (UC-MV24) ⇒ đọc lại và trả 409. */
  private async conflictFromStore(task: Task, project: ProjectRef): Promise<never> {
    const current = await this.d.tasks.findLive(task.workspaceId, task.projectId, task.id);
    if (!current) throw new ResourceNotFoundError('task');
    throw new VersionConflictError(current.version, await this.dto(current, project));
  }

  private async bestEffort(msg: string, task: Task, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      this.d.logger.error({ err, taskId: task.id, projectId: task.projectId }, msg);
    }
  }
}
