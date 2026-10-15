import type { TaskDto } from '@taskflow/contracts';

import { ProjectArchivedError, ResourceNotFoundError } from '../../../../core/errors';
import { Task } from '../../domain/task';
import type { TaskPriority } from '../../domain/task-status';
import type { TaskScope } from '../task-actor';
import { TaskCommands } from '../task-commands';

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

/**
 * `POST …/tasks` (data-and-api §2.7, test-spec §3.1). Task mới luôn ở TODO, cuối cột (R12).
 * Số TF-n cấp bằng `UPDATE … RETURNING` trong cùng transaction (§1.2); rollback ⇒ số bị đốt.
 */
export class CreateTaskUseCase {
  constructor(private readonly c: TaskCommands) {}

  execute(scope: TaskScope & { input: CreateTaskInput }): Promise<TaskDto> {
    const { d } = this.c;
    const { actor, input, workspaceId, projectId } = scope;
    return this.c.inTransactionWithRankRetry(async () => {
      const project = await this.c.loadProject(scope);
      d.policy.assert(d.policy.can(actor, 'task:create'), 'task:create');
      d.policy.assert(d.policy.canAssignOnCreate(actor, input.assigneeId), 'task:assign:any');
      this.c.assertWritable(project);
      if (input.assigneeId) await this.c.assertAssignable(workspaceId, input.assigneeId);

      const number = await d.projects.allocateTaskNumber({ workspaceId, projectId });
      if (number === null) {
        // Vừa bị archive (hoặc xóa) giữa lúc đọc và lúc cấp số — phân biệt để trả đúng mã.
        const again = await d.projects.findInWorkspace({ workspaceId, projectId });
        throw again ? new ProjectArchivedError(projectId) : new ResourceNotFoundError('project');
      }
      const task = Task.create({
        id: d.ids.next(),
        workspaceId,
        projectId,
        number,
        title: input.title,
        description: input.description ?? null,
        ...(input.priority ? { priority: input.priority } : {}),
        dueDate: input.dueDate ?? null,
        assigneeId: input.assigneeId ?? null,
        rank: d.ranks.between(await d.tasks.lastRank(projectId, 'TODO'), null),
        createdById: actor.userId,
        now: d.clock.now(),
      });
      return this.c.persist(task, project, TaskCommands.metaOf(scope), { kind: 'add' });
    });
  }
}
