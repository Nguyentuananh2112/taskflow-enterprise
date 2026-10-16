import type { LocalDate } from '../../domain/local-time';
import type { WorkSchedule } from '../../domain/work-schedule';

export interface HolidayRecord {
  date: LocalDate;
  name: string;
}

/** Lịch làm việc (theo phiên bản) + ngày lễ của workspace — đọc. Ghi (HR) ở port riêng. */
export interface IWorkCalendarStore {
  /** Mọi phiên bản lịch của workspace (thứ tự bất kỳ); workspace mới có sẵn phiên bản seed. */
  scheduleVersions(workspaceId: string): Promise<WorkSchedule[]>;
  holidays(q: { workspaceId: string; from: LocalDate; to: LocalDate }): Promise<HolidayRecord[]>;
}
