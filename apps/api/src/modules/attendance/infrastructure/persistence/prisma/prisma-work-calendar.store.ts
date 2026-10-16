import type { WorkSchedule } from '../../../domain/work-schedule';
import type {
  HolidayRecord,
  IWorkCalendarStore,
  ScheduleVersionRecord,
} from '../../../application/ports/work-calendar-store.port';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';

/**
 * Lịch theo phiên bản + ngày lễ. Không có dòng nào ⇒ trả rỗng; domain dùng `DEFAULT_SCHEDULE`
 * (migration 3 không seed — TL).
 */
export class PrismaWorkCalendarStore implements IWorkCalendarStore {
  constructor(private readonly db: DbProvider) {}

  async scheduleVersions(workspaceId: string): Promise<WorkSchedule[]> {
    return (await this.scheduleRecords(workspaceId)).map(
      ({ createdBy: _c, createdAt: _a, ...schedule }) => schedule,
    );
  }

  async scheduleRecords(workspaceId: string): Promise<ScheduleVersionRecord[]> {
    const rows = await this.db().workSchedule.findMany({
      where: { workspaceId },
      orderBy: { effectiveFrom: 'asc' },
    });
    return rows.map((r) => ({
      effectiveFrom: toDateOnly(r.effectiveFrom),
      timezone: r.timezone,
      workdays: r.workdays,
      startMin: r.startMin,
      endMin: r.endMin,
      breakStartMin: r.breakStartMin,
      breakEndMin: r.breakEndMin,
      graceMin: r.graceMin,
      createdBy: r.createdById,
      createdAt: r.createdAt,
    }));
  }

  async saveScheduleVersion(workspaceId: string, v: ScheduleVersionRecord): Promise<void> {
    const data = {
      timezone: v.timezone,
      workdays: v.workdays,
      startMin: v.startMin,
      endMin: v.endMin,
      breakStartMin: v.breakStartMin,
      breakEndMin: v.breakEndMin,
      graceMin: v.graceMin,
      createdById: v.createdBy,
      createdAt: v.createdAt,
    };
    const effectiveFrom = fromDateOnly(v.effectiveFrom);
    await this.db().workSchedule.upsert({
      where: { workspaceId_effectiveFrom: { workspaceId, effectiveFrom } },
      create: { workspaceId, effectiveFrom, ...data },
      update: data,
    });
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

  async putHoliday(workspaceId: string, h: HolidayRecord): Promise<void> {
    const date = fromDateOnly(h.date);
    await this.db().holiday.upsert({
      where: { workspaceId_date: { workspaceId, date } },
      create: { workspaceId, date, name: h.name },
      update: { name: h.name },
    });
  }

  async deleteHoliday(workspaceId: string, date: string): Promise<boolean> {
    const { count } = await this.db().holiday.deleteMany({
      where: { workspaceId, date: fromDateOnly(date) },
    });
    return count > 0;
  }
}
