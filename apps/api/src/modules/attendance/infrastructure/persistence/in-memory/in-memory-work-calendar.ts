import type {
  HolidayRecord,
  IWorkCalendarStore,
  ScheduleVersionRecord,
} from '../../../application/ports/work-calendar-store.port';
import type { WorkSchedule } from '../../../domain/work-schedule';

/** Lịch theo phiên bản + ngày lễ của công ty trong bộ nhớ — cùng hợp đồng với Prisma (LSP). */
export class InMemoryWorkCalendarStore implements IWorkCalendarStore {
  readonly versions: ScheduleVersionRecord[] = [];
  readonly holidayRows: HolidayRecord[] = [];

  snapshot(): unknown {
    return structuredClone({ versions: this.versions, holidays: this.holidayRows });
  }

  restore(snapshot: unknown): void {
    const { versions, holidays } = snapshot as {
      versions: InMemoryWorkCalendarStore['versions'];
      holidays: InMemoryWorkCalendarStore['holidayRows'];
    };
    this.versions.splice(0, this.versions.length, ...versions);
    this.holidayRows.splice(0, this.holidayRows.length, ...holidays);
  }

  scheduleVersions(): Promise<WorkSchedule[]> {
    return this.scheduleRecords();
  }

  scheduleRecords() {
    return Promise.resolve(
      this.versions
        .map((v) => ({ ...v }))
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
    );
  }

  saveScheduleVersion(record: ScheduleVersionRecord) {
    const i = this.versions.findIndex((v) => v.effectiveFrom === record.effectiveFrom);
    if (i >= 0) this.versions.splice(i, 1);
    this.versions.push({ ...record });
    return Promise.resolve();
  }

  putHoliday(holiday: HolidayRecord) {
    const row = this.holidayRows.find((h) => h.date === holiday.date);
    if (row) row.name = holiday.name;
    else this.holidayRows.push({ ...holiday });
    return Promise.resolve();
  }

  deleteHoliday(date: string) {
    const i = this.holidayRows.findIndex((h) => h.date === date);
    if (i >= 0) this.holidayRows.splice(i, 1);
    return Promise.resolve(i >= 0);
  }

  holidays(q: { from: string; to: string }) {
    return Promise.resolve(
      this.holidayRows
        .filter((h) => h.date >= q.from && h.date <= q.to)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(({ date, name }) => ({ date, name })),
    );
  }
}
