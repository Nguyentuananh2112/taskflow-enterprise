import type { ILogger } from '../../../../core/logging/logger';
import { yearOf, type LeaveKit } from '../leave-kit';
import type { ILeaveEmployeeDirectory } from '../ports/leave-read-model.port';

const PAGE = 200;

/**
 * Job `leave-carryover` (T-057, ADR-131): chụp phép chuyển sang của NĂM HIỆN TẠI cho mọi nhân viên đang làm còn
 * NULL. Chạy theo interval (mẫu T-033), idempotent: mỗi người một transaction, khóa đúng thứ tự (policy SHARED →
 * leave:<user>), ghi `ifNull` — chạy lại / chạy song song với đường ghi không đổi kết quả (CC-HR-24). Đã chụp ⇒ bỏ qua.
 */
export class LeaveCarryoverJob {
  constructor(
    private readonly kit: LeaveKit,
    private readonly employees: ILeaveEmployeeDirectory,
    private readonly logger: ILogger,
  ) {}

  async runOnce(signal?: AbortSignal): Promise<{ year: number; snapshotted: number }> {
    const today = await this.kit.today();
    const year = yearOf(today);
    let snapshotted = 0;
    let after: { id: string; fullName: string } | null = null;
    for (;;) {
      const page = await this.employees.listEmployees(after, PAGE);
      for (const user of page) {
        if (signal?.aborted) {
          this.logger.info({ year, snapshotted, aborted: true }, 'leave.carryover_summary');
          return { year, snapshotted };
        }
        const done = await this.kit.d.uow.run(async () => {
          await this.kit.lockFor(user.id);
          return this.kit.snapshotCarried(user.id, year, today);
        });
        if (done) snapshotted += 1;
      }
      if (page.length < PAGE) break;
      after = page.at(-1)!;
    }
    this.logger.info({ year, snapshotted }, 'leave.carryover_summary');
    return { year, snapshotted };
  }
}
