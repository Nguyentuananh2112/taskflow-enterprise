import type { LocalDate } from '../../domain/local-time';
import type { WorkSchedule } from '../../domain/work-schedule';

export interface HolidayRecord {
  date: LocalDate;
  name: string;
}

/** Một phiên bản lịch đã lưu (kèm người lưu) — `GET attendance/schedules`. */
export interface ScheduleVersionRecord extends WorkSchedule {
  createdBy: string;
  createdAt: Date;
}

/** Lịch làm việc (theo phiên bản) + ngày lễ của CÔNG TY (một bộ — ADR-136). Ghi chạy TRONG `uow.run` của use case. */
export interface IWorkCalendarStore {
  /** Mọi phiên bản lịch (thứ tự bất kỳ); chưa lưu phiên bản nào ⇒ rỗng (domain dùng `DEFAULT_SCHEDULE`). */
  scheduleVersions(): Promise<WorkSchedule[]>;
  /** Như `scheduleVersions` kèm người lưu, sắp `effectiveFrom` tăng dần. */
  scheduleRecords(): Promise<ScheduleVersionRecord[]>;
  /** Lưu phiên bản; trùng `effectiveFrom` ⇒ THAY phiên bản đó (kể cả người lưu, giờ lưu). */
  saveScheduleVersion(record: ScheduleVersionRecord): Promise<void>;
  holidays(q: { from: LocalDate; to: LocalDate }): Promise<HolidayRecord[]>;
  /** Tạo hoặc đổi tên ngày lễ. */
  putHoliday(holiday: HolidayRecord): Promise<void>;
  /** `false` khi ngày đó không có lễ. */
  deleteHoliday(date: LocalDate): Promise<boolean>;
}
