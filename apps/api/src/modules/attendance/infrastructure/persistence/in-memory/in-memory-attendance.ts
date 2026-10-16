import type { WorkSchedule } from '../../../domain/work-schedule';
import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceEventRecord,
  type IAttendanceEventStore,
} from '../../../application/ports/attendance-event-store.port';
import type {
  HolidayRecord,
  IWorkCalendarStore,
  ScheduleVersionRecord,
} from '../../../application/ports/work-calendar-store.port';

/**
 * Bản in-memory cùng hợp đồng với Prisma (LSP): mô phỏng 2 unique index một phần của thiết kế §3 —
 * (ws, user, workDate) cho IN WEB chưa hủy, và (ws, user, source, idempotencyKey).
 */
export class InMemoryAttendanceEventStore implements IAttendanceEventStore {
  readonly rows: AttendanceEventRecord[] = [];

  listForUser(q: { workspaceId: string; userId: string; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (e) =>
            e.workspaceId === q.workspaceId &&
            e.userId === q.userId &&
            e.workDate >= q.from &&
            e.workDate <= q.to,
        )
        .map((e) => ({ ...e })),
    );
  }

  findByIdempotencyKey(q: {
    workspaceId: string;
    userId: string;
    source: AttendanceEventRecord['source'];
    key: string;
  }) {
    const row = this.rows.find(
      (e) =>
        e.workspaceId === q.workspaceId &&
        e.userId === q.userId &&
        e.source === q.source &&
        e.idempotencyKey === q.key,
    );
    return Promise.resolve(row ? { ...row } : null);
  }

  add(event: AttendanceEventRecord): Promise<void> {
    const same = (e: AttendanceEventRecord) =>
      e.workspaceId === event.workspaceId && e.userId === event.userId;
    if (
      event.kind === 'IN' &&
      event.source === 'WEB' &&
      event.voidedAt === null &&
      this.rows.some(
        (e) =>
          same(e) &&
          e.kind === 'IN' &&
          e.source === 'WEB' &&
          e.voidedAt === null &&
          e.workDate === event.workDate,
      )
    ) {
      return Promise.reject(new AlreadyCheckedInError());
    }
    if (
      event.idempotencyKey !== null &&
      this.rows.some(
        (e) => same(e) && e.source === event.source && e.idempotencyKey === event.idempotencyKey,
      )
    ) {
      return Promise.reject(new IdempotencyKeyTakenError());
    }
    this.rows.push({ ...event });
    return Promise.resolve();
  }

  findById(workspaceId: string, id: string) {
    const row = this.rows.find((e) => e.workspaceId === workspaceId && e.id === id);
    return Promise.resolve(row ? { ...row } : null);
  }

  void(q: {
    workspaceId: string;
    id: string;
    voidedAt: Date;
    voidedBy: string;
    voidReason: string;
  }) {
    const row = this.rows.find(
      (e) => e.workspaceId === q.workspaceId && e.id === q.id && e.voidedAt === null,
    );
    if (!row) return Promise.resolve(false);
    Object.assign(row, { voidedAt: q.voidedAt, voidedBy: q.voidedBy, voidReason: q.voidReason });
    return Promise.resolve(true);
  }

  listForUsers(q: { workspaceId: string; userIds: readonly string[]; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (e) =>
            e.workspaceId === q.workspaceId &&
            q.userIds.includes(e.userId) &&
            e.workDate >= q.from &&
            e.workDate <= q.to,
        )
        .map((e) => ({ ...e })),
    );
  }

  userIdsWithEvents(q: { workspaceId: string; from: string; to: string }) {
    return Promise.resolve([
      ...new Set(
        this.rows
          .filter(
            (e) => e.workspaceId === q.workspaceId && e.workDate >= q.from && e.workDate <= q.to,
          )
          .map((e) => e.userId),
      ),
    ]);
  }

  hasAnyForUser(workspaceId: string, userId: string) {
    return Promise.resolve(
      this.rows.some((e) => e.workspaceId === workspaceId && e.userId === userId),
    );
  }
}

export class InMemoryWorkCalendarStore implements IWorkCalendarStore {
  readonly versions: (ScheduleVersionRecord & { workspaceId: string })[] = [];
  readonly holidayRows: (HolidayRecord & { workspaceId: string })[] = [];

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
