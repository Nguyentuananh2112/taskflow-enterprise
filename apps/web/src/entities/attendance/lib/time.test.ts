import { describe, expect, it } from 'vitest';

import { dateIn, duration, minutesToClock, serverOffsetMs, timeOfDay } from './time';

const VN = 'Asia/Ho_Chi_Minh';

describe('giờ theo múi giờ của lịch (không theo máy)', () => {
  it('timeOfDay: UTC 01:05 = 08:05 giờ Việt Nam', () => {
    expect(timeOfDay('2026-10-16T01:05:00.000Z', VN)).toBe('08:05');
  });
  it('ra sau 00:00 thuộc workDate hôm trước ⇒ "(+1)"', () => {
    // 17:30Z ngày 16 = 00:30 ngày 17 giờ VN
    expect(timeOfDay('2026-10-16T17:30:00.000Z', VN, '2026-10-16')).toBe('00:30 (+1)');
    expect(timeOfDay('2026-10-16T10:30:00.000Z', VN, '2026-10-16')).toBe('17:30');
  });
  it('dateIn đổi ngày theo múi giờ; DST Europe/Berlin (2026-10-25 lùi giờ)', () => {
    expect(dateIn('2026-10-16T17:30:00.000Z', VN)).toBe('2026-10-17');
    expect(timeOfDay('2026-10-25T00:30:00.000Z', 'Europe/Berlin')).toBe('02:30'); // còn CEST
    expect(timeOfDay('2026-10-25T01:30:00.000Z', 'Europe/Berlin')).toBe('02:30'); // đã CET
  });
  it('minutesToClock / duration', () => {
    expect(minutesToClock(480)).toBe('08:00');
    expect(minutesToClock(1050)).toBe('17:30');
    expect(duration(45)).toBe('45 phút');
    expect(duration(120)).toBe('2 giờ');
    expect(duration(125)).toBe('2 giờ 5 phút');
  });
  it('độ lệch server', () => {
    expect(serverOffsetMs('2026-10-16T01:00:05.000Z', Date.parse('2026-10-16T01:00:00.000Z'))).toBe(
      5000,
    );
  });
});
