import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../../../test/support';
import { scheduleTimeZoneNow } from './schedule-timezone';

const version = (effectiveFrom: string, timezone: string) => ({
  effectiveFrom,
  timezone,
  workdays: 0b0011111,
  startMin: 480,
  endMin: 1020,
  breakStartMin: 720,
  breakEndMin: 780,
  graceMin: 0,
});
const calendarOf = (...versions: ReturnType<typeof version>[]) => ({
  scheduleVersions: () => Promise.resolve(versions),
});

describe('scheduleTimeZoneNow (T-062b — nguồn múi giờ của module company)', () => {
  it('chưa có lịch ⇒ Asia/Ho_Chi_Minh (DEFAULT_SCHEDULE)', async () => {
    const calendar = calendarOf();
    expect(await scheduleTimeZoneNow(calendar, new FakeClock('2026-11-17T03:00:00.000Z'))).toBe(
      'Asia/Ho_Chi_Minh',
    );
  });

  it('lịch Europe/Berlin hiệu lực từ hôm nay ⇒ Europe/Berlin; trước ngày hiệu lực ⇒ vẫn lịch cũ', async () => {
    const calendar = calendarOf(version('2026-11-17', 'Europe/Berlin'));
    expect(await scheduleTimeZoneNow(calendar, new FakeClock('2026-11-17T12:00:00.000Z'))).toBe(
      'Europe/Berlin',
    );
    expect(await scheduleTimeZoneNow(calendar, new FakeClock('2026-11-10T12:00:00.000Z'))).toBe(
      'Asia/Ho_Chi_Minh',
    );
  });
});
