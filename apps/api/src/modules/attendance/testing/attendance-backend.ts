import { FakeUnitOfWork } from '../../../../test/support';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type {
  AttendanceEventRecord,
  IAttendanceEventStore,
} from '../application/ports/attendance-event-store.port';
import type { ICorrectionStore } from '../application/ports/correction-store.port';
import type { IWorkCalendarStore } from '../application/ports/work-calendar-store.port';
import type { WorkSchedule } from '../domain/work-schedule';
import { InMemoryAttendanceEventStore } from '../infrastructure/persistence/in-memory/in-memory-attendance';
import { InMemoryWorkCalendarStore } from '../infrastructure/persistence/in-memory/in-memory-work-calendar';

/**
 * Phần lưu trữ của harness attendance — đổi được để chạy LẠI cùng bộ test tầng A trên Postgres (runner LSP
 * `test/integration/lsp/attendance.*.lsp.int.ts`, như module task). Test chỉ đọc / dựng dữ liệu qua đây.
 */
export interface AttendanceBackend {
  events: IAttendanceEventStore;
  calendar: IWorkCalendarStore;
  /** Đơn bổ sung giờ (T-056) — bỏ trống ⇒ harness đơn dùng bản in-memory. */
  corrections?: ICorrectionStore;
  uow: IUnitOfWork;
  /** Dữ liệu nền (user cho FK) — chạy trước mỗi harness. */
  seed(): Promise<void>;
  /** Mọi lượt chấm, theo `occurredAt` rồi `id`. */
  eventRows(): Promise<AttendanceEventRecord[]>;
  addScheduleVersion(schedule: WorkSchedule, createdBy: string): Promise<void>;
  addHoliday(date: string, name: string): Promise<void>;
}

export const byTime = (a: AttendanceEventRecord, b: AttendanceEventRecord) =>
  a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function inMemoryAttendanceBackend(): AttendanceBackend {
  const events = new InMemoryAttendanceEventStore();
  const calendar = new InMemoryWorkCalendarStore();
  return {
    events,
    calendar,
    uow: new FakeUnitOfWork(),
    seed: () => Promise.resolve(),
    eventRows: () => Promise.resolve(events.rows.map((e) => ({ ...e })).sort(byTime)),
    addScheduleVersion: (schedule, createdBy) =>
      calendar.saveScheduleVersion({ ...schedule, createdBy, createdAt: new Date(0) }),
    addHoliday: (date, name) => {
      calendar.holidayRows.push({ date, name });
      return Promise.resolve();
    },
  };
}
