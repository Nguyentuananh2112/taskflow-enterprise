import type { TaskDto } from '@taskflow/contracts';

import { BusinessRuleViolationError } from '../../../../core/errors';
import { Rank } from '../../domain/rank';
import type { Task } from '../../domain/task';
import { assertTransition, type TaskStatus } from '../../domain/task-status';
import type { TaskScope } from '../task-actor';
import { TaskCommands } from '../task-commands';
import { RANK_REBALANCE_THRESHOLD, TaskRankRebalancer } from '../task-rank-rebalancer';

export interface MoveTaskInput {
  expectedVersion: number;
  status?: TaskStatus;
  /** Task nằm NGAY TRÊN vị trí mới. */
  afterId?: string | null;
  /** Task nằm NGAY DƯỚI vị trí mới. */
  beforeId?: string | null;
}

const invalidAnchor = () =>
  new BusinessRuleViolationError('INVALID_ANCHOR', 'Vị trí thả không hợp lệ.');

/**
 * `PATCH …/tasks/:taskId/move` (ADR-010/011, test-spec §3.2). Server tính rank từ hàng xóm
 * **thực tế** trong DB, không tin rank của client: ưu tiên `afterId`, rồi `beforeId`, không có
 * thì cuối cột. Task đã nằm trong khoảng đó ⇒ no-op (R15).
 */
export class MoveTaskUseCase {
  constructor(private readonly c: TaskCommands) {}

  execute(scope: TaskScope & { taskId: string; input: MoveTaskInput }): Promise<TaskDto> {
    const { d } = this.c;
    const { actor, input } = scope;
    return this.c.inTransactionWithRankRetry(async () => {
      const first = await this.c.loadTask(scope, scope.taskId);
      d.policy.assert(d.policy.can(actor, 'task:move'), 'task:move');
      this.c.assertWritable(first.project);
      const target = input.status ?? first.task.status;
      // T-033: khóa cột đích TRƯỚC khi đọc hàng xóm, rồi đọc lại task — rebalance commit trong lúc
      // chờ khóa không làm entity cũ (tránh 409 oan, không tính rank theo cột đang được tính lại).
      await d.tasks.lockColumn(scope.projectId, target);
      const { project, task } = await this.c.loadTask(scope, scope.taskId);
      this.c.assertWritable(project);
      await this.c.assertVersion(task, input.expectedVersion, project);

      assertTransition(task.status, target);
      let rank = await this.resolveRank(scope, task, target, input);
      const meta = TaskCommands.metaOf(scope);
      if (rank.length > RANK_REBALANCE_THRESHOLD) {
        rank = await new TaskRankRebalancer(this.c).rebalance({
          project,
          target,
          moving: task,
          wanted: rank,
          meta,
        });
      }
      const expectedVersion = task.version;
      if (!task.moveTo(target, Rank.of(rank), actor.userId, d.clock.now())) {
        return this.c.dto(task, project);
      }
      return this.c.persist(task, project, meta, { kind: 'save', expectedVersion });
    });
  }

  private async resolveRank(
    scope: TaskScope,
    task: Task,
    target: TaskStatus,
    input: MoveTaskInput,
  ): Promise<string> {
    const { tasks, ranks } = this.c.d;
    let lower: string | null;
    let upper: string | null;
    if (input.afterId) {
      lower = (await this.anchor(scope, task, target, input.afterId)).rank;
      upper = await tasks.rankAfter(task.projectId, target, lower, task.id);
    } else if (input.beforeId) {
      upper = (await this.anchor(scope, task, target, input.beforeId)).rank;
      lower = await tasks.rankBefore(task.projectId, target, upper, task.id);
    } else {
      lower = await tasks.lastRank(task.projectId, target, task.id);
      upper = null;
    }
    const alreadyThere =
      target === task.status &&
      (lower === null || lower < task.rank) &&
      (upper === null || task.rank < upper);
    return alreadyThere ? task.rank : ranks.between(lower, upper);
  }

  /** R11: anchor là task sống của CÙNG project, ở cột đích, khác chính nó (sai ⇒ 422, không 404). */
  private async anchor(
    scope: TaskScope,
    task: Task,
    target: TaskStatus,
    id: string,
  ): Promise<Task> {
    if (id === task.id) throw invalidAnchor();
    const anchor = await this.c.d.tasks.findLive(scope.workspaceId, scope.projectId, id);
    if (!anchor || anchor.status !== target) throw invalidAnchor();
    return anchor;
  }
}
