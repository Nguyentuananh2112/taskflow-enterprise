// Seed dữ liệu GIẢ Mốc 5 (TL 18/10 — localhost thiếu dữ liệu HR): hồ sơ nhân viên (ngày vào khác nhau, có người ≥ 5
// năm thâm niên), chính sách phép năm nay, chấm công MỌI ngày làm từ đầu nhiệm kỳ tới hôm qua (vài ngày đi muộn, nghỉ
// phép đã duyệt), một ngày tháng này thiếu giờ ra + đơn bổ sung giờ PENDING để HR duyệt thử. Không có PII thật.
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../src/generated/prisma/client';
import { addDays, instantOf, type LocalDate } from '../src/core/domain/local-time';
import { DEFAULT_SCHEDULE, isWorkday } from '../src/modules/attendance/domain/work-schedule';

const TZ = DEFAULT_SCHEDULE.timezone;
const day = (d: LocalDate) => new Date(`${d}T00:00:00.000Z`);

type Staff = 'Pam' | 'Max' | 'Mia' | 'Vic' | 'Otto' | 'Nina' | 'Olivia';

/** Hồ sơ 4 trường (ADR-128). Ngày vào trước nhiệm kỳ seed = nhân viên lâu năm (thâm niên phép / phụ cấp). */
const PROFILES: Record<
  Exclude<Staff, 'Olivia'>,
  { years: number; department: string; jobTitle: string }
> = {
  Pam: { years: 10, department: 'Nhân sự', jobTitle: 'Trưởng phòng nhân sự' },
  Max: { years: 7, department: 'Kế toán', jobTitle: 'Kế toán trưởng' },
  Mia: { years: 5, department: 'Sản phẩm', jobTitle: 'Thiết kế sản phẩm' },
  Vic: { years: 2, department: 'Kỹ thuật', jobTitle: 'Lập trình viên' },
  Otto: { years: 0, department: 'Kỹ thuật', jobTitle: 'Kiểm thử' },
  Nina: { years: 0, department: 'Kinh doanh', jobTitle: 'Chuyên viên kinh doanh' },
};

/** Ngày vào = `years` năm trước `start` (năm 0 = đúng ngày bắt đầu nhiệm kỳ / hôm nay với Nina). */
const yearsBefore = (d: LocalDate, years: number): LocalDate =>
  `${String(Number(d.slice(0, 4)) - years)}${d.slice(4)}`;

export async function seedHr(
  prisma: PrismaClient,
  u: Record<Staff, string>,
  dates: { today: LocalDate; start: LocalDate },
): Promise<void> {
  const { today, start } = dates;
  for (const [name, p] of Object.entries(PROFILES) as [
    keyof typeof PROFILES,
    (typeof PROFILES)['Pam'],
  ][]) {
    await prisma.employeeProfile.create({
      data: {
        userId: u[name],
        hireDate: day(yearsBefore(name === 'Nina' ? today : start, p.years)),
        department: p.department,
        jobTitle: p.jobTitle,
        updatedById: u.Pam,
      },
    });
  }
  // Chính sách phép năm nay: mức luật + bật chuyển phép (tối đa 5 ngày, hết hạn cuối tháng 3) để thấy "Chuyển sang".
  await prisma.leavePolicy.create({
    data: {
      year: Number(today.slice(0, 4)),
      carryOverEnabled: true,
      carryOverMaxDays: 5,
      carryOverExpiryMonth: 3,
      updatedById: u.Pam,
    },
  });
}

/** Ngày làm việc (lịch mặc định) trong [from, to), cũ trước. */
export function workdaysBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) if (isWorkday(DEFAULT_SCHEDULE, d)) out.push(d);
  return out;
}

/**
 * Chấm công từ đầu nhiệm kỳ tới HÔM QUA cho nhân viên đang làm: Otto đi muộn thứ Hai; Mia nghỉ phép năm 2 ngày (đơn
 * APPROVED, không có lượt chấm); Vic ngày làm gần nhất của THÁNG NÀY chỉ có giờ vào (MISSING_OUT) + đơn bổ sung giờ ra
 * PENDING. Trả ngày thiếu giờ ra (test).
 */
export async function seedAttendanceHistory(
  prisma: PrismaClient,
  u: Record<Staff, string>,
  dates: { today: LocalDate; start: LocalDate; now: Date },
): Promise<{ missingOutDate: LocalDate | null; leaveDays: LocalDate[] }> {
  const { today, start, now } = dates;
  const days = workdaysBetween(start, today);
  const thisMonth = days.filter((d) => d.slice(0, 7) === today.slice(0, 7));
  const missingOutDate = thisMonth.at(-1) ?? null;
  // Nghỉ phép của Mia: 2 ngày làm liền nhau ở giữa nhiệm kỳ.
  const mid = Math.floor(days.length / 2);
  const leaveDays = days.slice(mid, mid + 2);
  const punch = (userId: string, date: LocalDate, kind: 'IN' | 'OUT', minute: number) => ({
    userId,
    kind,
    source: 'WEB' as const,
    occurredAt: instantOf(date, minute, TZ),
    workDate: day(date),
    createdById: userId,
  });
  const rows = [];
  for (const [i, name] of (['Pam', 'Max', 'Mia', 'Vic', 'Otto'] as const).entries()) {
    for (const date of days) {
      if (name === 'Mia' && leaveDays.includes(date)) continue;
      const monday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
      const inAt = name === 'Otto' && monday ? 8 * 60 + 25 : 7 * 60 + 50 + i * 2; // Otto muộn 25' mỗi thứ Hai
      rows.push(punch(u[name], date, 'IN', inAt));
      if (name === 'Vic' && date === missingOutDate) continue; // quên chấm ra
      rows.push(punch(u[name], date, 'OUT', 17 * 60 + 32 + i));
    }
  }
  await prisma.attendanceEvent.createMany({ data: rows });
  if (leaveDays.length === 2) {
    await prisma.leaveRequest.create({
      data: {
        userId: u.Mia,
        type: 'ANNUAL',
        startDate: day(leaveDays[0]!),
        endDate: day(leaveDays[1]!),
        status: 'APPROVED',
        decidedById: u.Pam,
        decidedAt: now,
        version: 2,
      },
    });
  }
  if (missingOutDate) {
    await prisma.attendanceCorrectionRequest.create({
      data: {
        id: randomUUID(),
        userId: u.Vic,
        workDate: day(missingOutDate),
        kind: 'OUT',
        minuteOfDay: 17 * 60 + 40,
        reason: 'Quên chấm ra (mẫu)',
        idempotencyKey: randomUUID(),
      },
    });
  }
  return { missingOutDate, leaveDays };
}
