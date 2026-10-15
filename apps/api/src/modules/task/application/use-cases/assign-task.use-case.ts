import type { TaskDto } from '@taskflow/contracts';

import type { TaskScope } from '../task-actor';
import { TaskCommands } from '../task-commands';

export interface AssignTaskInput {
  expectedVersion: number;
  /** `null` = bỏ gán. */
  assigneeId: string | null;
}

/**
 * `PATCH …/tasks/:taskId/assignee` (ADR-041/044, test-spec §3.3). Thứ tự: 404 → 403 (Policy) →
 * 422 archived → 422 ASSIGNEE_NOT_MEMBER → 409 → no-op. Kiểm membership của assignee trong
 * transaction (bản Prisma `FOR SHARE`) để xếp hàng với hạ role/xóa thành viên (§1.9).
 */
export class AssignTaskUseCase {
  constructor(private readonly c: TaskCommands) {}

  execute(scope: TaskScope & { taskId: string; input: AssignTaskInput }): Promise<TaskDto> {
    const { d } = this.c;
    const { actor, input } = scope;
    return d.uow.run(async () => {
      const { project, task } = await this.c.loadTask(scope, scope.taskId);
      d.policy.assert(d.policy.canAssign(actor, task, input.assigneeId), 'task:assign:any');
      this.c.assertWritable(project);
      if (input.assigneeId !== null && input.assigneeId !== task.assigneeId) {
        await this.c.assertAssignable(scope.workspaceId, input.assigneeId);
      }
      await this.c.assertVersion(task, input.expectedVersion, project);
      const expectedVersion = task.version;
      if (!task.assignTo(input.assigneeId, actor.userId, d.clock.now())) {
        return this.c.dto(task, project);
      }
      return this.c.persist(task, project, TaskCommands.metaOf(scope), {
        kind: 'save',
        expectedVersion,
      });
    });
  }
}
