import { FakeUnitOfWork } from '../../../../test/support';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type {
  AttendanceEventRecord,
  IAttendanceEventStore,
} from '../application/ports/attendance-event-store.port';
import type { IWorkCalendarStore } from '../application/ports/work-calendar-store.port';
import type { WorkSchedule } from '../domain/work-schedule';
import {
  InMemoryAttendanceEventStore,
  InMemoryWorkCalendarStore,
} from '../infrastructure/persistence/in-memory/in-memory-attendance';

/**
 * Phần lưu trữ của harness attendance — đổi được để chạy LẠI cùng bộ test tầng A trên Postgres (runner LSP
 * `test/integration/lsp/attendance.*.lsp.int.ts`, như module task). Test chỉ đọc / dựng dữ liệu qua đây.
 */
export interface AttendanceBackend {
  events: IAttendanceEventStore;
  calendar: IWorkCalendarStore;
  uow: IUnitOfWork;
  /** Dữ liệu nền (workspace, user cho FK) — chạy trước mỗi harness. */
  seed(): Promise<void>;
  /** Mọi lượt chấm, theo `occurredAt` rồi `id`. */
  eventRows(): Promise<AttendanceEventRecord[]>;
  addScheduleVersion(workspaceId: string, schedule: WorkSchedule, createdBy: string): Promise<void>;
  addHoliday(workspaceId: string, date: string, name: string): Promise<void>;
}

export const byTime = (a: AttendanceEventRecord, b: AttendanceEventRecord) =>
  a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function inMemoryAttendanceBackend(workspaceId: string): AttendanceBackend {
  const events = new InMemoryAttendanceEventStore();
  const calendar = new InMemoryWorkCalendarStore(workspaceId);
  return {
    events,
    calendar,
    uow: new FakeUnitOfWork(),
    seed: () => Promise.resolve(),
    eventRows: () => Promise.resolve(events.rows.map((e) => ({ ...e })).sort(byTime)),
    addScheduleVersion: (ws, schedule) => {
      if (ws === workspaceId) calendar.versions.push(schedule);
      return Promise.resolve();
    },
    addHoliday: (ws, date, name) => {
      calendar.holidayRows.push({ workspaceId: ws, date, name });
      return Promise.resolve();
    },
  };
}
