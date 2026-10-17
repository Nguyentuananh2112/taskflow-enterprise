import type { AttendanceDayDto } from '@taskflow/contracts/attendance';
import { describe, expect, it } from 'vitest';

import { calendarWeeks, clockShort, dayText, employmentNote } from './calendar';

const TZ = 'Asia/Ho_Chi_Minh';
const day = (date: string, patch: Partial<AttendanceDayDto> = {}): AttendanceDayDto => ({
  date,
  timezone: TZ,
  isWorkday: true,
  holidayName: null,
  workedMin: 0,
  lateMin: 0,
  earlyMin: 0,
  status: 'PENDING',
  late: false,
  early: false,
  absentHalf: false,
  inProgress: false,
  firstIn: null,
  lastOut: null,
  leave: null,
  ...patch,
});
const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();

describe('clockShort', () => {
  it('"8:02" không số 0 đầu, theo múi giờ lịch; "17:35"; "0:30"', () => {
    expect(clockShort(vn('2026-10-15', '08:02'), TZ)).toBe('8:02');
    expect(clockShort(vn('2026-10-15', '17:35'), TZ)).toBe('17:35');
    expect(clockShort(vn('2026-10-16', '00:30'), TZ)).toBe('0:30');
  });
});

describe('calendarWeeks (T2→CN)', () => {
  const month = (first: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(`${first}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10) };
    });

  it('10/2026 bắt đầu thứ 5 ⇒ 3 ô đệm đầu; 5 tuần; mỗi tuần 7 ô', () => {
    const weeks = calendarWeeks(month('2026-10-01', 31));
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0]?.[3]?.date).toBe('2026-10-01');
    expect(weeks[4]?.[5]?.date).toBe('2026-10-31'); // thứ 7
    expect(weeks[4]?.[6]).toBeNull();
  });

  it('tháng bắt đầu Chủ nhật (03/2026) ⇒ 6 ô đệm, CN ở cột cuối', () => {
    const weeks = calendarWeeks(month('2026-03-01', 31));
    expect(weeks[0]?.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0]?.[6]?.date).toBe('2026-03-01');
    expect(weeks).toHaveLength(6);
  });
});

describe('dayText — câu chữ đời thường', () => {
  const today = '2026-10-15';
  it('đi làm đúng giờ ⇒ "Đi làm" + "8:02–17:35"', () => {
    const t = dayText(
      day('2026-10-14', {
        status: 'PRESENT',
        firstIn: vn('2026-10-14', '08:02'),
        lastOut: vn('2026-10-14', '17:35'),
      }),
      today,
    );
    expect(t).toMatchObject({ label: 'Đi làm', detail: '8:02–17:35', tone: 'work' });
  });

  it('đi muộn / về sớm ⇒ số phút; quên chấm ra ⇒ ghi rõ', () => {
    expect(dayText(day('2026-10-14', { status: 'PRESENT', lateMin: 37 }), today).label).toBe(
      'Đi muộn 37 phút',
    );
    expect(dayText(day('2026-10-14', { status: 'PRESENT', earlyMin: 15 }), today).label).toBe(
      'Về sớm 15 phút',
    );
    expect(
      dayText(
        day('2026-10-14', { status: 'MISSING_OUT', firstIn: vn('2026-10-14', '08:00') }),
        today,
      ),
    ).toMatchObject({ label: 'Đi làm', detail: 'Quên chấm ra', tone: 'late' });
  });

  it('vắng / nghỉ phép cả ngày hay nửa ngày / lễ có tên / Chủ nhật', () => {
    expect(dayText(day('2026-10-13', { status: 'ABSENT' }), today).label).toBe('Vắng');
    expect(dayText(day('2026-10-13', { status: 'ON_LEAVE', leave: 'FULL' }), today)).toMatchObject({
      label: 'Nghỉ phép',
      detail: 'cả ngày',
    });
    expect(dayText(day('2026-10-13', { status: 'ON_LEAVE', leave: 'AM' }), today).detail).toBe(
      'buổi sáng',
    );
    expect(
      dayText(day('2026-09-02', { status: 'HOLIDAY', holidayName: 'Quốc khánh' }), today),
    ).toMatchObject({ label: 'Ngày lễ', detail: 'Quốc khánh' });
    expect(dayText(day('2026-10-11', { status: 'OFF', isWorkday: false }), today).label).toBe(
      'Chủ nhật',
    );
  });

  it('ngày quá thời hạn lưu (RETENTION_EXPIRED, R27) ⇒ "Ngoài thời hạn lưu", trung tính, không phải "Vắng"', () => {
    expect(dayText(day('2024-09-02', { status: 'RETENTION_EXPIRED' }), today)).toMatchObject({
      label: 'Ngoài thời hạn lưu',
      tone: 'off',
    });
  });

  it('muộn lâu ⇒ viết theo giờ: "Đi muộn 2 giờ", "Đi muộn 1 giờ 5 phút"', () => {
    expect(dayText(day('2026-10-14', { status: 'PRESENT', lateMin: 120 }), today).label).toBe(
      'Đi muộn 2 giờ',
    );
    expect(dayText(day('2026-10-14', { status: 'PRESENT', lateMin: 65 }), today).label).toBe(
      'Đi muộn 1 giờ 5 phút',
    );
  });

  it('TƯƠNG LAI vẫn hiện điều đã biết trước: lễ (tên), phép đã duyệt (cả ngày / nửa ngày); Chủ nhật tương lai trống', () => {
    expect(
      dayText(day('2026-10-30', { status: 'HOLIDAY', holidayName: 'Lễ công ty' }), today),
    ).toMatchObject({ label: 'Ngày lễ', detail: 'Lễ công ty' });
    expect(dayText(day('2026-10-20', { status: 'ON_LEAVE', leave: 'FULL' }), today)).toMatchObject({
      label: 'Nghỉ phép',
      detail: 'cả ngày',
    });
    expect(dayText(day('2026-10-21', { status: 'PENDING', leave: 'PM' }), today)).toMatchObject({
      label: 'Nghỉ phép',
      detail: 'buổi chiều',
    });
    expect(dayText(day('2026-10-25', { status: 'OFF', isWorkday: false }), today).label).toBe('');
  });

  it('ngày TƯƠNG LAI ⇒ trống (không "Chưa tới giờ"); hôm nay chưa chấm ⇒ "Chưa chấm"; ngoài nhiệm kỳ ⇒ trống', () => {
    expect(dayText(day('2026-10-16'), today).label).toBe('');
    expect(dayText(day('2026-10-15'), today).label).toBe('Chưa chấm');
    expect(dayText(day('2026-10-01', { status: 'NOT_EMPLOYED' }), today).label).toBe('');
  });
});

describe('employmentNote — gộp ngày ngoài nhiệm kỳ', () => {
  it('16 ngày NOT_EMPLOYED đầu tháng ⇒ MỘT câu "Bạn bắt đầu làm từ 17/10"', () => {
    const days = [
      ...Array.from({ length: 16 }, (_, i) =>
        day(`2026-10-${String(i + 1).padStart(2, '0')}`, { status: 'NOT_EMPLOYED' }),
      ),
      day('2026-10-17'),
      day('2026-10-18'),
    ];
    expect(employmentNote(days)).toEqual({ started: 'Bạn bắt đầu làm từ 17/10', left: null });
  });

  it('rời giữa tháng ⇒ "Bạn đã nghỉ làm từ dd/MM" (ngày đầu tiên ngoài nhiệm kỳ); cả tháng trong nhiệm kỳ ⇒ không câu nào', () => {
    const days = [
      day('2026-10-01', { status: 'PRESENT' }),
      day('2026-10-02', { status: 'NOT_EMPLOYED' }),
      day('2026-10-03', { status: 'NOT_EMPLOYED' }),
    ];
    expect(employmentNote(days)).toEqual({ started: null, left: 'Bạn đã nghỉ làm từ 02/10' });
    expect(employmentNote([day('2026-10-01'), day('2026-10-02')])).toEqual({
      started: null,
      left: null,
    });
  });
});
