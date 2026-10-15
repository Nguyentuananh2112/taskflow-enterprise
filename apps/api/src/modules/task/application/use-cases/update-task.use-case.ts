import type { TaskDto } from '@taskflow/contracts';

import type { TaskChanges } from '../../domain/task';
import type { TaskScope } from '../task-actor';
import { TaskCommands } from '../task-commands';

export type UpdateTaskInput = TaskChanges & { expectedVersion: number };

/** `PATCH …/tasks/:taskId` (test-spec §3.4). MEMBER sửa mọi task (ADR-041). `null` xóa description/dueDate. */
export class UpdateTaskUseCase {
  constructor(private readonly c: TaskCommands) {}

  execute(scope: TaskScope & { taskId: string; input: UpdateTaskInput }): Promise<TaskDto> {
    const { d } = this.c;
    const { actor } = scope;
    // Chỉ lấy đúng 4 trường được sửa — không spread input (field lạ không lọt vào entity).
    const { expectedVersion, title, description, priority, dueDate } = scope.input;
    const changes: TaskChanges = {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
    };
    return d.uow.run(async () => {
      const { project, task } = await this.c.loadTask(scope, scope.taskId);
      d.policy.assert(d.policy.can(actor, 'task:update'), 'task:update');
      this.c.assertWritable(project);
      await this.c.assertVersion(task, expectedVersion, project);
      const before = task.version;
      if (!task.update(changes, actor.userId, d.clock.now())) return this.c.dto(task, project);
      return this.c.persist(task, project, TaskCommands.metaOf(scope), {
        kind: 'save',
        expectedVersion: before,
      });
    });
  }
}
