import type {
  HolidayRecord,
  IWorkCalendarStore,
  ScheduleVersionRecord,
} from '../../../application/ports/work-calendar-store.port';
import type { WorkSchedule } from '../../../domain/work-schedule';

/** Lịch theo phiên bản + ngày lễ trong bộ nhớ (nhiều workspace) — cùng hợp đồng với Prisma (LSP). */
export class InMemoryWorkCalendarStore implements IWorkCalendarStore {
  readonly versions: (ScheduleVersionRecord & { workspaceId: string })[] = [];
  readonly holidayRows: (HolidayRecord & { workspaceId: string })[] = [];

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

  scheduleVersions(workspaceId: string): Promise<WorkSchedule[]> {
    return this.scheduleRecords(workspaceId);
  }

  scheduleRecords(workspaceId: string) {
    return Promise.resolve(
      this.versions
        .filter((v) => v.workspaceId === workspaceId)
        .map(({ workspaceId: _w, ...v }) => v)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
    );
  }

  saveScheduleVersion(workspaceId: string, record: ScheduleVersionRecord) {
    const i = this.versions.findIndex(
      (v) => v.workspaceId === workspaceId && v.effectiveFrom === record.effectiveFrom,
    );
    if (i >= 0) this.versions.splice(i, 1);
    this.versions.push({ ...record, workspaceId });
    return Promise.resolve();
  }

  putHoliday(workspaceId: string, holiday: HolidayRecord) {
    const row = this.holidayRows.find(
      (h) => h.workspaceId === workspaceId && h.date === holiday.date,
    );
    if (row) row.name = holiday.name;
    else this.holidayRows.push({ workspaceId, ...holiday });
    return Promise.resolve();
  }

  deleteHoliday(workspaceId: string, date: string) {
    const i = this.holidayRows.findIndex((h) => h.workspaceId === workspaceId && h.date === date);
    if (i >= 0) this.holidayRows.splice(i, 1);
    return Promise.resolve(i >= 0);
  }

  holidays(q: { workspaceId: string; from: string; to: string }) {
    return Promise.resolve(
      this.holidayRows
        .filter((h) => h.workspaceId === q.workspaceId && h.date >= q.from && h.date <= q.to)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(({ date, name }) => ({ date, name })),
    );
  }
}
