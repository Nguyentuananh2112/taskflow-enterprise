import type { DeleteTaskResponse } from '@taskflow/contracts';

import type { TaskScope } from '../task-actor';
import { TaskCommands } from '../task-commands';

/**
 * `DELETE …/tasks/:taskId` (ADR-022/045, test-spec §3.5): xóa mềm, `version + 1`. `expectedVersion`
 * tùy chọn; ghi luôn có điều kiện theo version vừa đọc nên ghi song song vẫn ra 409.
 */
export class DeleteTaskUseCase {
  constructor(private readonly c: TaskCommands) {}

  execute(
    scope: TaskScope & { taskId: string; input: { expectedVersion?: number } },
  ): Promise<DeleteTaskResponse> {
    const { d } = this.c;
    const { actor } = scope;
    return d.uow.run(async () => {
      const { project, task } = await this.c.loadTask(scope, scope.taskId);
      d.policy.assert(d.policy.canDelete(actor, task), 'task:delete:any');
      this.c.assertWritable(project);
      if (scope.input.expectedVersion !== undefined) {
        await this.c.assertVersion(task, scope.input.expectedVersion, project);
      }
      const before = task.version;
      task.softDelete(actor.userId, d.clock.now());
      await this.c.persist(task, project, TaskCommands.metaOf(scope), {
        kind: 'save',
        expectedVersion: before,
      });
      return { id: task.id, version: task.version };
    });
  }
}
