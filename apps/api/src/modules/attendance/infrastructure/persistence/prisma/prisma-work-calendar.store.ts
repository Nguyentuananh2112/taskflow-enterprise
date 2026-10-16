import type { WorkSchedule } from '../../../domain/work-schedule';
import type { IWorkCalendarStore } from '../../../application/ports/work-calendar-store.port';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';

/**
 * Lịch theo phiên bản + ngày lễ (đọc). Không có dòng nào ⇒ trả rỗng; domain dùng `DEFAULT_SCHEDULE`
 * (migration 3 không seed — TL).
 */
export class PrismaWorkCalendarStore implements IWorkCalendarStore {
  constructor(private readonly db: DbProvider) {}

  async scheduleVersions(workspaceId: string): Promise<WorkSchedule[]> {
    const rows = await this.db().workSchedule.findMany({ where: { workspaceId } });
    return rows.map((r) => ({
      effectiveFrom: toDateOnly(r.effectiveFrom),
      timezone: r.timezone,
      workdays: r.workdays,
      startMin: r.startMin,
      endMin: r.endMin,
      breakStartMin: r.breakStartMin,
      breakEndMin: r.breakEndMin,
      graceMin: r.graceMin,
    }));
  }

  async holidays(q: { workspaceId: string; from: string; to: string }) {
    const rows = await this.db().holiday.findMany({
      where: {
        workspaceId: q.workspaceId,
        date: { gte: fromDateOnly(q.from), lte: fromDateOnly(q.to) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({ date: toDateOnly(r.date), name: r.name }));
  }
}
