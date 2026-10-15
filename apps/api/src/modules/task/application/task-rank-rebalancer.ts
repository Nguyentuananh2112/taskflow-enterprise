import { VersionConflictError } from '../../../core/errors';
import { Rank } from '../domain/rank';
import type { Task } from '../domain/task';
import type { TaskStatus } from '../domain/task-status';
import type { ProjectRef } from './ports/collaborators.port';
import { RankConflictError } from './ports/task-repository.port';
import type { RealtimeEventMeta } from './task-actor';
import type { TaskCommands } from './task-commands';

/**
 * Rank dài hơn ngưỡng ⇒ cân bằng lại cả cột (T-033). Benchmark (report T-033): chèn liên tiếp vào
 * CÙNG một khe làm rank dài ~1 ký tự/5 lần chèn (1000 lần ⇒ 169–202 ký tự); thêm cuối/đầu cột
 * không làm dài. 64 ký tự ≈ 300+ lần chèn vào một khe.
 */
export const RANK_REBALANCE_THRESHOLD = 64;

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
    // Thứ tự đích: các task khác theo rank hiện tại, chèn `moving` vào đúng chỗ của `wanted`.
    const at = others.findIndex((t) => wanted < t.rank);
    const ordered = [...others];
    ordered.splice(at === -1 ? others.length : at, 0, moving);
    const keys = d.ranks.spread(ordered.length);

    await d.tasks.stashColumnRanks(project.id, target);
    const now = d.clock.now();
    let movingRank = wanted;
    for (const [i, task] of ordered.entries()) {
      const key = keys[i]!;
      if (task.id === moving.id) {
        movingRank = key;
        // F1 (HIGH, review B T-033): `moving` ĐANG ở cột đích ⇒ pha 1 cũng đổi nó sang `~<id>`. Khóa mới
        // trùng rank cũ ⇒ `moveTo` của use case trả false và KHÔNG lưu ⇒ commit với rank tạm ⇒ mọi
        // create/append cột đó 500. Bất biến: rebalance ghi lại MỌI dòng đã stash trước khi trả về —
        // ghi lại rank cũ (không version/audit/event), giống nhánh "khóa trùng" của task khác dưới đây.
        if (moving.status === target && moving.rank === key) {
          if (!(await d.tasks.save(moving, moving.version))) throw new RankConflictError();
        }
        continue;
      }
      const expectedVersion = task.version;
      // Rank cũ (trước pha 1) vẫn nằm trong entity ⇒ audit/event ghi đúng from → to.
      if (!task.moveTo(target, Rank.of(key), meta.actorId, now)) {
        // Khóa mới trùng rank cũ: thứ tự không đổi (không version/audit/event) nhưng DB đang giữ
        // khóa tạm `~<id>` của pha 1 ⇒ BẮT BUỘC ghi lại rank.
        if (!(await d.tasks.save(task, expectedVersion))) throw new RankConflictError();
        continue;
      }
      try {
        await this.c.persist(task, project, meta, { kind: 'save', expectedVersion });
      } catch (err) {
        // Task trong cột vừa bị sửa song song (không qua khóa cột, vd update tiêu đề) ⇒ thử lại cả tx.
        if (err instanceof VersionConflictError) throw new RankConflictError();
        throw err;
      }
    }
    d.logger.info(
      {
        projectId: project.id,
        status: target,
        tasks: ordered.length,
        triggerRankLength: wanted.length,
        durationMs: Date.now() - startedAt,
      },
      'task.rank_rebalanced',
    );
    return movingRank;
  }
}
