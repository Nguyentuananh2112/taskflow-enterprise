import type {
  AttendanceDayDto,
  AttendanceTodayDto,
  ScheduleDto,
} from '@/shared/api/m3-provisional';

// Chấm công giả (T-041a) cho dev/test web: lịch mặc định T2–T7 08:00–17:30, nghỉ trưa 12:00–13:30,
// grace 0, múi giờ Asia/Ho_Chi_Minh (attendance-leave.md §0). `summarize` là bản RÚT GỌN của
// `summarizeDay` (đủ trạng thái cho UI) — quy tắc đầy đủ + test bảng ví dụ thuộc API thật (T-038).

export const MOCK_TZ = 'Asia/Ho_Chi_Minh';
export const MOCK_SCHEDULE: ScheduleDto = {
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
};

type Punch = { kind: 'IN' | 'OUT'; at: number; key: string };

const parts = (ms: number) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOCK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
};

/** T2–T7 là ngày làm (CN nghỉ). */
const isWorkday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;

export class MockAttendance {
  #punches = new Map<string, Punch[]>();
  constructor(private readonly now: () => number) {}

  #key = (wsId: string, userId: string, date: string) => `${wsId}|${userId}|${date}`;
  today = () => parts(this.now()).date;

  punches(wsId: string, userId: string, date: string): readonly Punch[] {
    return this.#punches.get(this.#key(wsId, userId, date)) ?? [];
  }

  /** Lượt đã có cùng key (idempotency) — để handler trả lại kết quả cũ. */
  findByKey(wsId: string, userId: string, key: string): Punch | undefined {
    for (const [k, list] of this.#punches) {
      if (k.startsWith(`${wsId}|${userId}|`)) {
        const hit = list.find((p) => p.key === key);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  punch(wsId: string, userId: string, kind: Punch['kind'], key: string): void {
    const k = this.#key(wsId, userId, this.today());
    this.#punches.set(k, [...(this.#punches.get(k) ?? []), { kind, at: this.now(), key }]);
  }

  summarize(wsId: string, userId: string, date: string): AttendanceDayDto {
    const list = this.punches(wsId, userId, date);
    const firstIn = list.find((p) => p.kind === 'IN');
    const outs = list.filter((p) => p.kind === 'OUT' && firstIn && p.at >= firstIn.at);
    const lastOut = outs.at(-1);
    const workday = isWorkday(date);
    const today = this.today();
    const nowMin = parts(this.now()).minute;
    const past = date < today || (date === today && nowMin >= MOCK_SCHEDULE.endMin);
    const status = !workday
      ? 'OFF'
      : firstIn
        ? lastOut || !past
          ? 'PRESENT'
          : 'MISSING_OUT'
        : past
          ? 'ABSENT'
          : 'PENDING';
    const inMin = firstIn ? parts(firstIn.at).minute : null;
    const outMin = lastOut ? parts(lastOut.at).minute : null;
    const lateMin =
      inMin !== null && inMin > MOCK_SCHEDULE.startMin + MOCK_SCHEDULE.graceMin
        ? inMin - MOCK_SCHEDULE.startMin
        : 0;
    const earlyMin =
      outMin !== null && outMin < MOCK_SCHEDULE.endMin ? MOCK_SCHEDULE.endMin - outMin : 0;
    const workedMin =
      inMin !== null && outMin !== null
        ? Math.max(
            0,
            Math.min(outMin, MOCK_SCHEDULE.endMin) - Math.max(inMin, MOCK_SCHEDULE.startMin),
          )
        : 0;
    return {
      date,
      isWorkday: workday,
      status,
      late: lateMin > 0,
      early: earlyMin > 0,
      absentHalf: false,
      firstIn: firstIn ? new Date(firstIn.at).toISOString() : null,
      lastOut: lastOut ? new Date(lastOut.at).toISOString() : null,
      workedMin,
      lateMin,
      earlyMin,
      leave: null,
      holidayName: null,
    };
  }

  todayDto(wsId: string, userId: string): AttendanceTodayDto {
    const day = this.summarize(wsId, userId, this.today());
    return {
      serverNow: new Date(this.now()).toISOString(),
      timezone: MOCK_TZ,
      date: day.date,
      isWorkday: day.isWorkday,
      isHoliday: false,
      holidayName: null,
      schedule: day.isWorkday ? MOCK_SCHEDULE : null,
      status: day.status,
      late: day.late,
      early: day.early,
      absentHalf: false,
      inProgress: day.firstIn !== null && day.lastOut === null && day.status === 'PRESENT',
      firstIn: day.firstIn,
      lastOut: day.lastOut,
      leave: null,
    };
  }
}
