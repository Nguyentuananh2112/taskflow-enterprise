import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { describe, expect, it } from 'vitest';

import { statusText } from './today-box';

// TL #A1 (18/10): chấm công ngày nghỉ / ngày lễ được ghi nhận — câu trạng thái hôm nay nói đúng "Đang làm" / "Đã chấm
// ra" kèm nhãn ngày nghỉ / lễ (trước đây ngày nghỉ có IN hiện ngay "Đã chấm ra").
const base = {
  isWorkday: false,
  isHoliday: false,
  holidayName: null,
  leave: null,
  firstIn: null,
  lastOut: null,
  inProgress: false,
  notCheckedInYet: false,
  late: false,
  early: false,
} as unknown as AttendanceTodayDto;
const t = (patch: Partial<AttendanceTodayDto>): AttendanceTodayDto => ({ ...base, ...patch });
const IN = '2026-10-18T05:04:00.000Z';

describe('statusText (ô Hôm nay)', () => {
  it('ngày nghỉ chưa chấm ⇒ "Hôm nay không phải ngày làm"; lễ chưa chấm ⇒ "Hôm nay nghỉ lễ: …"', () => {
    expect(statusText(t({}))).toBe('Hôm nay không phải ngày làm');
    expect(statusText(t({ isHoliday: true, holidayName: 'Quốc khánh' }))).toBe(
      'Hôm nay nghỉ lễ: Quốc khánh',
    );
  });

  it('ngày nghỉ đã IN chưa OUT ⇒ "Đang làm · ngày nghỉ"; đã OUT ⇒ "Đã chấm ra · ngày nghỉ"', () => {
    expect(statusText(t({ firstIn: IN, inProgress: true }))).toBe('Đang làm · ngày nghỉ');
    expect(statusText(t({ firstIn: IN, lastOut: IN }))).toBe('Đã chấm ra · ngày nghỉ');
  });

  it('ngày lễ đã IN ⇒ "Đang làm · ngày lễ: tên"', () => {
    expect(
      statusText(
        t({
          isHoliday: true,
          isWorkday: true,
          holidayName: 'Quốc khánh',
          firstIn: IN,
          inProgress: true,
        }),
      ),
    ).toBe('Đang làm · ngày lễ: Quốc khánh');
  });
});
