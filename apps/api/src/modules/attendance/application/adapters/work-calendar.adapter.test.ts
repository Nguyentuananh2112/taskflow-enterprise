import { describe, expect, it } from 'vitest';

import { DEFAULT_SCHEDULE } from '../../domain/work-schedule';
import { inMemoryAttendanceBackend } from '../../testing/attendance-backend';
import { AttendanceWorkCalendar } from './work-calendar.adapter';

describe('AttendanceWorkCalendar (WorkCalendarPort của leave)', () => {
  it('chưa lưu lịch ⇒ DEFAULT_SCHEDULE: T2–T7 làm, CN nghỉ; đủ mọi ngày gồm hai đầu', async () => {
    const days = await new AttendanceWorkCalendar(inMemoryAttendanceBackend().calendar).workingDays(
      {
        from: '2026-11-14',
        to: '2026-11-16',
      },
    );
    expect(days).toEqual([
      { date: '2026-11-14', isWorkday: true, isHoliday: false, schedule: DEFAULT_SCHEDULE },
      { date: '2026-11-15', isWorkday: false, isHoliday: false, schedule: DEFAULT_SCHEDULE },
      { date: '2026-11-16', isWorkday: true, isHoliday: false, schedule: DEFAULT_SCHEDULE },
    ]);
  });

  it('đổi lịch giữa khoảng ⇒ mỗi ngày theo phiên bản của nó; ngày lễ của đúng workspace; from > to ⇒ rỗng', async () => {
    const backend = inMemoryAttendanceBackend();
    const store = backend.calendar;
    const mf = {
      ...DEFAULT_SCHEDULE,
      effectiveFrom: '2026-11-16',
      workdays: 0b0011111,
      timezone: 'UTC',
    };
    await store.saveScheduleVersion({ ...mf, createdBy: 'h', createdAt: new Date(0) });
    await store.putHoliday({ date: '2026-11-17', name: 'Lễ' });
    const cal = new AttendanceWorkCalendar(store);
    const days = await cal.workingDays({ from: '2026-11-14', to: '2026-11-21' });
    expect(days.map((d) => [d.date, d.isWorkday, d.isHoliday, d.schedule.timezone])).toEqual([
      ['2026-11-14', true, false, 'Asia/Ho_Chi_Minh'],
      ['2026-11-15', false, false, 'Asia/Ho_Chi_Minh'],
      ['2026-11-16', true, false, 'UTC'],
      ['2026-11-17', true, true, 'UTC'],
      ['2026-11-18', true, false, 'UTC'],
      ['2026-11-19', true, false, 'UTC'],
      ['2026-11-20', true, false, 'UTC'],
      ['2026-11-21', false, false, 'UTC'],
    ]);
    expect(await cal.workingDays({ from: '2026-11-21', to: '2026-11-20' })).toEqual([]);
  });
});
