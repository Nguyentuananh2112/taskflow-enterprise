import type { WorkSchedule } from '../../../domain/work-schedule';
import type {
  HolidayRecord,
  IWorkCalendarStore,
  ScheduleVersionRecord,
} from '../../../application/ports/work-calendar-store.port';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';

/**
 * Lịch theo phiên bản + ngày lễ của công ty (một bộ — company-level ADR-136). Không có dòng nào ⇒ trả rỗng; domain dùng `DEFAULT_SCHEDULE`
 * (migration 3 không seed — TL).
 */
export class PrismaWorkCalendarStore implements IWorkCalendarStore {
  constructor(private readonly db: DbProvider) {}

  async scheduleVersions(): Promise<WorkSchedule[]> {
    return (await this.scheduleRecords()).map(
      ({ createdBy: _c, createdAt: _a, ...schedule }) => schedule,
    );
  }

  async scheduleRecords(): Promise<ScheduleVersionRecord[]> {
    const rows = await this.db().workSchedule.findMany({
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

  async saveScheduleVersion(v: ScheduleVersionRecord): Promise<void> {
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
      where: { effectiveFrom },
      create: { effectiveFrom, ...data },
      update: data,
    });
  }

  async holidays(q: { from: string; to: string }) {
    const rows = await this.db().holiday.findMany({
      where: {
        date: { gte: fromDateOnly(q.from), lte: fromDateOnly(q.to) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({ date: toDateOnly(r.date), name: r.name }));
  }

  async putHoliday(h: HolidayRecord): Promise<void> {
    const date = fromDateOnly(h.date);
    await this.db().holiday.upsert({
      where: { date },
      create: { date, name: h.name },
      update: { name: h.name },
    });
  }

  async deleteHoliday(date: string): Promise<boolean> {
    const { count } = await this.db().holiday.deleteMany({
      where: { date: fromDateOnly(date) },
    });
    return count > 0;
  }
}
