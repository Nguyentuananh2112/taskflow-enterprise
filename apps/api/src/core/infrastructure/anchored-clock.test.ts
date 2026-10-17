import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../../test/support';
import { AnchoredClock } from './anchored-clock';
import { clocksForEnv } from './system';

describe('AnchoredClock (TEST_CLOCK_ANCHOR)', () => {
  it('neo + trôi: lúc tạo = mốc; giờ thật chạy bao nhiêu thì mốc chạy bấy nhiêu (không đóng băng)', () => {
    const real = new FakeClock('2026-11-15T12:34:56.789Z'); // Chủ nhật, 19:34 VN
    const clock = new AnchoredClock(new Date('2026-11-17T10:00:00+07:00'), real);
    expect(clock.now().toISOString()).toBe('2026-11-17T03:00:00.000Z');
    real.advance(1);
    expect(clock.now().toISOString()).toBe('2026-11-17T03:00:00.001Z');
    real.advance(90 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-11-17T04:30:00.001Z');
    expect(real.now().toISOString()).toBe('2026-11-15T14:04:56.790Z');
  });

  it('hai lần gọi liền nhau không lùi; mốc trong quá khứ cũng trôi tiến', () => {
    const real = new FakeClock('2026-11-15T00:00:00.000Z');
    const clock = new AnchoredClock(new Date('2020-01-01T00:00:00Z'), real);
    const a = clock.now().getTime();
    real.advance(5);
    expect(clock.now().getTime() - a).toBe(5);
  });

  it('clocksForEnv: không có mốc ⇒ một đồng hồ thật dùng chung, không log; có mốc ⇒ giờ nghiệp vụ neo, giờ thật giữ nguyên, log cảnh báo', () => {
    const warns: unknown[] = [];
    const logger = { warn: (obj: object) => void warns.push(obj) };
    const plain = clocksForEnv(undefined, logger);
    expect(plain.businessClock).toBe(plain.clock);
    expect(warns).toEqual([]);
    const anchored = clocksForEnv('2026-11-17T10:00:00+07:00', logger);
    expect(anchored.businessClock).not.toBe(anchored.clock);
    expect(
      Math.abs(anchored.businessClock.now().getTime() - Date.parse('2026-11-17T03:00:00Z')),
    ).toBeLessThan(5_000);
    expect(Math.abs(anchored.clock.now().getTime() - Date.now())).toBeLessThan(5_000);
    expect(warns).toEqual([{ anchor: '2026-11-17T10:00:00+07:00' }]);
  });
});
