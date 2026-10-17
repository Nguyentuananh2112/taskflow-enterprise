import { afterEach, describe, expect, it } from 'vitest';

import { serverClock } from './server-clock';

afterEach(() => serverClock.resetForTest());

describe('serverClock', () => {
  it('chưa có response ⇒ giờ máy; observe ⇒ bây giờ = giờ máy + độ lệch của server', () => {
    const before = Date.now();
    expect(serverClock.now()).toBeGreaterThanOrEqual(before);
    serverClock.observe('2031-03-10T03:00:00.000Z', Date.parse('2026-10-17T00:00:00.000Z'));
    const offset = Date.parse('2031-03-10T03:00:00.000Z') - Date.parse('2026-10-17T00:00:00.000Z');
    expect(Math.abs(serverClock.now() - (Date.now() + offset))).toBeLessThan(50);
  });

  it('chuỗi giờ hỏng ⇒ bỏ qua, giữ độ lệch cũ', () => {
    serverClock.observe('2031-03-10T03:00:00.000Z', 0);
    const offset = serverClock.now() - Date.now();
    serverClock.observe('không phải giờ');
    expect(Math.abs(serverClock.now() - Date.now() - offset)).toBeLessThan(50);
  });
});
