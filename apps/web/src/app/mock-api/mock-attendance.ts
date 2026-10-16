import type {
  AttendanceDayDto,
  AttendanceEventDto,
  AttendanceTodayDto,
  WorkShiftDto,
} from '@taskflow/contracts/attendance';

// Chấm công giả (T-041a) cho dev/test web: lịch mặc định T2–T7 08:00–17:30, nghỉ trưa 12:00–13:30,
// grace 0, múi giờ Asia/Ho_Chi_Minh (attendance-leave.md §0). `summarize` là bản RÚT GỌN của
// `summarizeDay` (đủ trạng thái cho UI) — quy tắc đầy đủ + test bảng ví dụ thuộc API thật (T-038).

export const MOCK_TZ = 'Asia/Ho_Chi_Minh';
export const MOCK_SCHEDULE: WorkShiftDto = {
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
};

type UserRef = { id: string; fullName: string };
type Punch = {
  id: string;
  kind: 'IN' | 'OUT';
  at: number;
  key: string;
  by: UserRef;
  ip: string | null;
  userAgent: string | null;
  voided?: { at: number; by: UserRef; reason: string };
  /** T-041c: lượt HR thêm (`ADJUSTMENT`, `by` = HR, `note` = lý do); mặc định WEB. */
  source?: 'WEB' | 'ADJUSTMENT';
  note?: string;
};

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

/** Ngày lịch (múi giờ của lịch mock) của một thời điểm ISO. */
export const localDate = (iso: string) => parts(Date.parse(iso)).date;

/** T2–T7 là ngày làm (CN nghỉ). */
const isWorkday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;

export class MockAttendance {
  #punches = new Map<string, Punch[]>();
  constructor(private readonly now: () => number) {}

  #key = (wsId: string, userId: string, date: string) => `${wsId}|${userId}|${date}`;
  today = () => parts(this.now()).date;
  serverNow = () => new Date(this.now()).toISOString();

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

  punch(
    wsId: string,
    by: UserRef,
    kind: Punch['kind'],
    key: string,
    meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
  ): void {
    const k = this.#key(wsId, by.id, this.today());
    const punch: Punch = { id: crypto.randomUUID(), kind, at: this.now(), key, by, ...meta };
    this.#punches.set(k, [...(this.#punches.get(k) ?? []), punch]);
  }

  /** HR hủy lượt (test/dev): lượt vẫn còn trong log, không tính vào bảng công. */
  voidPunch(wsId: string, userId: string, date: string, id: string, by: UserRef, reason: string) {
    const hit = this.punches(wsId, userId, date).find((p) => p.id === id);
    if (hit) hit.voided = { at: this.now(), by, reason };
  }

  /** HR thêm lượt (T-041c): giữ thứ tự theo giờ để `summarize` lấy đúng IN sớm nhất / OUT muộn nhất. */
  adjust(
    wsId: string,
    userId: string,
    date: string,
    p: { kind: Punch['kind']; at: number; by: UserRef; note: string },
  ): string {
    const k = this.#key(wsId, userId, date);
    const id = crypto.randomUUID();
    const punch: Punch = { id, key: id, ip: null, userAgent: null, source: 'ADJUSTMENT', ...p };
    this.#punches.set(
      k,
      [...(this.#punches.get(k) ?? []), punch].sort((a, b) => a.at - b.at),
    );
    return id;
  }

  /** Mọi (user, ngày, lượt) của workspace — phía HR (`MockHr`) tự lọc: tìm lượt theo id, người đã rời. */
  *entries(wsId: string): Generator<{ userId: string; date: string; punches: readonly Punch[] }> {
    for (const [k, punches] of this.#punches) {
      const [w, userId = '', date = ''] = k.split('|');
      if (w === wsId) yield { userId, date, punches };
    }
  }

  events(wsId: string, userId: string, date: string): AttendanceEventDto[] {
    return this.punches(wsId, userId, date).map((p) => ({
      id: p.id,
      userId,
      kind: p.kind,
      source: p.source ?? 'WEB',
      occurredAt: new Date(p.at).toISOString(),
      workDate: date,
      note: p.note ?? null,
      createdBy: p.by,
      voidedAt: p.voided ? new Date(p.voided.at).toISOString() : null,
      voidedBy: p.voided?.by ?? null,
      voidReason: p.voided?.reason ?? null,
      ip: p.ip,
      userAgent: p.userAgent,
    }));
  }

  /** `joinedDate` (theo múi giờ lịch): ngày trước đó, không có lượt chấm ⇒ NOT_EMPLOYED (TL chốt). */
  summarize(wsId: string, userId: string, date: string, joinedDate?: string): AttendanceDayDto {
    const list = this.punches(wsId, userId, date).filter((p) => !p.voided);
    const firstIn = list.find((p) => p.kind === 'IN');
    const outs = list.filter((p) => p.kind === 'OUT' && firstIn && p.at >= firstIn.at);
    const lastOut = outs.at(-1);
    const workday = isWorkday(date);
    const today = this.today();
    const nowMin = parts(this.now()).minute;
    const past = date < today || (date === today && nowMin >= MOCK_SCHEDULE.endMin);
    const notEmployed = joinedDate !== undefined && date < joinedDate && list.length === 0;
    const status = notEmployed
      ? 'NOT_EMPLOYED'
      : !workday
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
      timezone: MOCK_TZ,
      isWorkday: workday && !notEmployed,
      status,
      late: lateMin > 0,
      early: earlyMin > 0,
      absentHalf: false,
      inProgress: firstIn !== undefined && lastOut === undefined && status === 'PRESENT',
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
      inProgress: day.inProgress,
      firstIn: day.firstIn,
      lastOut: day.lastOut,
      leave: null,
    };
  }
}
