import { requestContext } from '../../../core/context/request-context';
import { ProjectArchivedError, ResourceNotFoundError } from '../../../core/errors';
import { Rank } from '../domain/rank';
import type { Task } from '../domain/task';
import type { TaskStatus } from '../domain/task-status';
import type { ProjectRef } from './ports/collaborators.port';
import { RankConflictError, type RankWrite } from './ports/task-repository.port';
import { auditValuesOf } from './task-audit';
import type { RealtimeEventMeta } from './task-actor';
import type { TaskCommands } from './task-commands';
import { toTaskDto } from './task-dto';
import { realtimeMessageOf } from './task-realtime';

/**
 * Rank dài hơn ngưỡng ⇒ cân bằng lại cả cột (T-033). Benchmark (report T-033): chèn liên tiếp vào
 * CÙNG một khe làm rank dài ~1 ký tự/5 lần chèn (1000 lần ⇒ 169–202 ký tự); thêm cuối/đầu cột
 * không làm dài. 64 ký tự ≈ 300+ lần chèn vào một khe.
 */
export const RANK_REBALANCE_THRESHOLD = 64;

/**
 * Review B T-033 F2: cột lớn hơn ⇒ KHÔNG rebalance (giữ khóa dài — vẫn là khóa hợp lệ, cột `rank` là
 * text không giới hạn), log cảnh báo. Trước A3 rebalance ghi từng task ⇒ 500 task ≈ 0,8 s (T-027b
 * §8.1). A3 ghi theo lô (một UPDATE + một INSERT audit); nâng ngưỡng này chỉ khi đo lại xong.
 */
export const RANK_REBALANCE_MAX_TASKS = 500;

/**
 * Cân bằng lại rank của MỘT cột, chạy BÊN TRONG transaction của lệnh move đã giữ `lockColumn`
 * (ADR-011 mở rộng). Không có actor "system" (ADR-014): actor là người đang move ⇒ mỗi task bị đổi
 * rank có `version + 1`, audit `MOVED` và realtime `task:moved` của chính nó — FE áp dụng theo
 * version như mọi move khác.
 */
export class TaskRankRebalancer {
  constructor(private readonly c: TaskCommands) {}

  /**
   * `moving` sẽ được đặt vào `target` ở vị trí rank `wanted` (quá dài). Ghi rank mới cho mọi task
   * KHÁC trong cột, trả rank mới (ngắn) cho `moving` — use case tự lưu `moving`.
   */
  async rebalance(input: {
    project: ProjectRef;
    target: TaskStatus;
    moving: Task;
    wanted: string;
    meta: RealtimeEventMeta;
  }): Promise<string> {
    const { d } = this.c;
    const startedAt = Date.now();
    const { project, target, moving, wanted, meta } = input;
    const others = (await d.tasks.listColumn(project.id, target)).filter((t) => t.id !== moving.id);
    if (others.length + 1 > RANK_REBALANCE_MAX_TASKS) {
      d.logger.warn(
        {
          projectId: project.id,
          status: target,
          tasks: others.length + 1,
          rankLength: wanted.length,
        },
        'task.rank_rebalance_skipped_large_column',
      );
      return wanted;
    }
    // Thứ tự đích: các task khác theo rank hiện tại, chèn `moving` vào đúng chỗ của `wanted`.
    const at = others.findIndex((t) => wanted < t.rank);
    const ordered = [...others];
    ordered.splice(at === -1 ? others.length : at, 0, moving);
    const keys = d.ranks.spread(ordered.length);

    await d.tasks.stashColumnRanks(project.id, target);
    const now = d.clock.now();
    let movingRank = wanted;
    // Bất biến (F1 + A3): MỌI dòng đã stash nằm trong `writes` ⇒ được ghi lại trong một câu UPDATE.
    const writes: RankWrite[] = [];
    const moved: Task[] = [];
    for (const [i, task] of ordered.entries()) {
      const key = keys[i]!;
      if (task.id === moving.id) {
        movingRank = key;
        // F1 (HIGH, review B T-033): `moving` ĐANG ở cột đích và khóa mới trùng rank cũ ⇒ `moveTo` của
        // use case trả false và KHÔNG lưu ⇒ phải ghi lại rank cũ ở đây (không version/audit/event).
        // Các trường hợp khác use case tự lưu `moving` sau khi pha 1 xong.
        if (moving.status === target && moving.rank === key) {
          writes.push({ task: moving, expectedVersion: moving.version });
        }
        continue;
      }
      // Rank cũ (trước pha 1) vẫn nằm trong entity ⇒ audit/event ghi đúng from → to. `moveTo` trả
      // false CHỈ khi khóa mới trùng rank cũ ⇒ ghi lại đúng rank đó, version giữ nguyên (không client
      // nào thấy rank đổi mà version không đổi).
      const expectedVersion = task.version;
      if (task.moveTo(target, Rank.of(key), meta.actorId, now)) moved.push(task);
      writes.push({ task, expectedVersion });
    }
    if ((await d.tasks.saveRanks(writes)) !== writes.length) await this.writeConflict(project);
    await this.recordMoves(moved, project, meta);
    d.logger.info(
      {
        projectId: project.id,
        status: target,
        tasks: ordered.length,
        written: writes.length,
        triggerRankLength: wanted.length,
        durationMs: Date.now() - startedAt,
      },
      'task.rank_rebalanced',
    );
    return movingRank;
  }
  /**
   * Thiếu dòng: task trong cột vừa bị sửa/xóa song song (không qua khóa cột, vd sửa tiêu đề) ⇒ thử
   * lại cả transaction; project vừa archive ⇒ 422; project/ws biến mất ⇒ 404 (như `save` từng dòng).
   */
  private async writeConflict(project: ProjectRef): Promise<never> {
    const fresh = await this.c.d.projects.findInWorkspace({
      workspaceId: project.workspaceId,
      projectId: project.id,
    });
    if (!fresh) throw new ResourceNotFoundError('project');
    if (fresh.isArchived) throw new ProjectArchivedError(project.id);
    throw new RankConflictError();
  }

  /**
   * Audit một câu INSERT, đọc user một lần, phát sau commit trong MỘT hook — vẫn đúng 1 audit MOVED
   * + 1 `task:moved` cho mỗi task đổi rank (giữ contract realtime, ADR-012).
   */
  private async recordMoves(moved: Task[], project: ProjectRef, meta: RealtimeEventMeta) {
    const { d } = this.c;
    const requestId = requestContext.requestId() ?? null;
    const batch = moved.map((task) => ({ task, events: task.pullDomainEvents() }));
    await d.audit.appendMany(
      batch.flatMap(({ task, events }) =>
        events.map((event) => ({
          id: d.ids.next(),
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          actorId: event.actorId,
          requestId,
          createdAt: event.occurredAt,
          ...auditValuesOf(event),
        })),
      ),
    );
    const userIds = moved.flatMap((t) => [t.assigneeId, t.createdById]);
    const refs = await d.users.findRefs([...new Set(userIds.filter((id) => id !== null))]);
    const messages = batch.map(({ task, events }) => ({
      task,
      message: realtimeMessageOf(events, toTaskDto(task, project.keyPrefix, refs)),
    }));
    d.uow.afterCommit(async function rebalanceBroadcast() {
      for (const { task, message } of messages) {
        if (!message) continue;
        try {
          await d.notifier.emitToProject({ projectId: task.projectId, ...message }, meta);
        } catch (err) {
          d.logger.error(
            { err, taskId: task.id, projectId: task.projectId },
            'task.realtime_failed',
          );
        }
      }
    });
    d.uow.afterCommit(async function rebalanceEvents() {
      try {
        await d.events.publish(batch.flatMap(({ events }) => events));
      } catch (err) {
        d.logger.error({ err, projectId: project.id }, 'task.events_publish_failed');
      }
    });
  }
}
