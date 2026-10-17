import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { describe, expect, it } from 'vitest';

import { callName, greetingAt, minuteOfDay, shouldPromptCheckIn } from './check-in-prompt';

// Thứ 5 2026-10-15, lịch Asia/Ho_Chi_Minh 08:00–17:30.
const at = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00+07:00`);
const base: AttendanceTodayDto = {
  serverNow: '2026-10-15T03:00:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  date: '2026-10-15',
  isWorkday: true,
  isHoliday: false,
  holidayName: null,
  schedule: { startMin: 480, endMin: 1050, breakStartMin: 720, breakEndMin: 780, graceMin: 0 },
  status: 'PENDING',
  firstIn: null,
  lastOut: null,
  inProgress: false,
  late: false,
  early: false,
  leave: null,
  absentHalf: false,
};

describe('shouldPromptCheckIn', () => {
  it('ngày làm, chưa vào, trong ca ⇒ hiện; cả trước giờ vào (07:00)', () => {
    expect(shouldPromptCheckIn(base, at('10:00'))).toBe(true);
    expect(shouldPromptCheckIn(base, at('07:00'))).toBe(true);
  });

  it('biên cuối ca: 17:29 hiện, 17:30 (endMin) và sau đó KHÔNG', () => {
    expect(shouldPromptCheckIn(base, at('17:29'))).toBe(true);
    expect(shouldPromptCheckIn(base, at('17:30'))).toBe(false);
    expect(shouldPromptCheckIn(base, at('21:00'))).toBe(false);
  });

  it.each([
    ['không phải ngày làm', { isWorkday: false }],
    ['ngày lễ', { isHoliday: true, holidayName: 'Lễ' }],
    ['đã chấm vào', { firstIn: '2026-10-15T01:00:00.000Z', status: 'PRESENT' }],
    ['nghỉ cả ngày', { leave: 'FULL', status: 'ON_LEAVE' }],
    ['ngoài nhiệm kỳ', { status: 'NOT_EMPLOYED' }],
    ['chưa có lịch', { schedule: null }],
  ])('%s ⇒ không hiện', (_name, patch) => {
    expect(shouldPromptCheckIn({ ...base, ...patch } as AttendanceTodayDto, at('10:00'))).toBe(
      false,
    );
  });

  it('nghỉ NỬA ngày vẫn hiện (còn nửa ca phải chấm)', () => {
    expect(shouldPromptCheckIn({ ...base, leave: 'AM' }, at('12:00'))).toBe(true);
  });

  it('giờ tính theo múi giờ của LỊCH, không theo máy', () => {
    // 10:00 UTC = 17:00 VN (còn ca) nhưng = 06:00 New York — chỉ múi giờ lịch có nghĩa.
    expect(minuteOfDay(Date.parse('2026-10-15T10:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(17 * 60);
    expect(shouldPromptCheckIn(base, Date.parse('2026-10-15T10:31:00Z'))).toBe(false);
  });
});

describe('greetingAt', () => {
  it.each([
    [0, 'Chào buổi sáng'],
    [10 * 60 + 59, 'Chào buổi sáng'],
    [11 * 60, 'Chào buổi trưa'],
    [13 * 60, 'Chào buổi chiều'],
    [17 * 60 + 59, 'Chào buổi chiều'],
    [18 * 60, 'Chào buổi tối'],
  ])('%i phút ⇒ %s', (minute, text) => {
    expect(greetingAt(minute)).toBe(text);
  });
});

describe('callName — tên gọi trong lời chào (demo TL: "Chào buổi chiều, mẫu)!")', () => {
  it.each([
    ['Olivia (dữ liệu mẫu)', 'Olivia'],
    ['Nguyễn Văn An', 'An'],
    ['  Trần   Thị  Lan ', 'Lan'],
    ['Lan', 'Lan'],
    ['Hana [HR] Lê', 'Lê'],
    ['(dữ liệu mẫu)', null],
    ['   ', null],
  ])('%j ⇒ %j', (fullName, expected) => {
    expect(callName(fullName)).toBe(expected);
  });
});
