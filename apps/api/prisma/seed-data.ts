// Seed dữ liệu GIẢ Mốc 3.5 (ADR-138): một công ty, đủ vai trò, workspace mẫu, chấm công + đơn nghỉ. Tách khỏi CLI
// (seed.ts) để test tầng I gọi thẳng (CO-07). Không có PII thật; email dùng tên miền dành riêng `example.test`.
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../src/generated/prisma/client';
import type { CompanyGrant } from '../src/generated/prisma/enums';
import { addDays, instantOf, toLocal, type LocalDate } from '../src/core/domain/local-time';
import { DEFAULT_SCHEDULE, isWorkday } from '../src/modules/attendance/domain/work-schedule';
import { CryptoRefreshTokenFactory } from '../src/modules/auth/infrastructure/security/crypto-refresh-token-factory';
import { seedWorkspaces } from './seed-projects';

const TZ = DEFAULT_SCHEDULE.timezone;
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // = ACTIVATION_TTL_MS của auth (link nhân viên 7 ngày)

/** Người mẫu — tên bịa. `grants` chỉ cho EMPLOYEE; Nina chờ kích hoạt; Quinn đã nghỉ (chỉ còn departure). */
const PEOPLE = {
  Olivia: { role: 'ADMIN' },
  Pam: { role: 'EMPLOYEE', grants: ['HR_MANAGE'] },
  Max: { role: 'EMPLOYEE', grants: ['PAYROLL_MANAGE'] },
  Mia: { role: 'EMPLOYEE' },
  Vic: { role: 'EMPLOYEE' },
  Otto: { role: 'EMPLOYEE' },
  Nina: { role: 'EMPLOYEE', pending: true },
  Quinn: { role: 'EMPLOYEE', departed: true },
} as const satisfies Record<
  string,
  { role: 'ADMIN' | 'EMPLOYEE'; grants?: CompanyGrant[]; pending?: true; departed?: true }
>;
export type SeedPerson = keyof typeof PEOPLE;

export interface SeedResult {
  users: Record<SeedPerson, string>;
  /** Link kích hoạt của Nina (`<web>/activate#t=…`) — CHỈ in ra console ở dev. */
  activationLink: string;
}

const day = (d: LocalDate) => new Date(`${d}T00:00:00.000Z`);
const monthStart = (d: LocalDate, back: number) => {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) - back;
  return `${String(Math.floor(idx / 12))}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
};
/** `count` ngày làm việc (lịch mặc định) gần nhất TRƯỚC `before`, cũ trước. */
function workdaysBefore(before: LocalDate, count: number): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = addDays(before, -1); out.length < count; d = addDays(d, -1)) {
    if (isWorkday(DEFAULT_SCHEDULE, d)) out.unshift(d);
  }
  return out;
}
const nextWorkday = (d: LocalDate): LocalDate =>
  isWorkday(DEFAULT_SCHEDULE, d) ? d : nextWorkday(addDays(d, 1));

export const SEED_TABLES =
  'notifications, hr_audit_logs, leave_requests, leave_balances, attendance_events, holidays, work_schedules, ' +
  'account_activation_tokens, company_member_departures, company_members, companies, task_audit_logs, tasks, ' +
  'projects, workspace_members, refresh_tokens, workspaces, users';

/** Xóa sạch rồi dựng lại toàn bộ dữ liệu mẫu. `now` cho test; mặc định giờ thật. */
export async function seedDatabase(
  prisma: PrismaClient,
  opts: { passwordHash: string; webOrigin: string; now?: Date },
): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const today = toLocal(now, TZ).date;
  const start = monthStart(today, 3); // nhiệm kỳ của mọi nhân viên mẫu (3 tháng trước)
  await prisma.$executeRawUnsafe(`TRUNCATE ${SEED_TABLES} CASCADE`);
  await prisma.company.create({ data: { id: 1, name: 'Công ty Mẫu' } });

  const users = {} as Record<SeedPerson, string>;
  for (const [name, p] of Object.entries(PEOPLE) as [SeedPerson, (typeof PEOPLE)[SeedPerson]][]) {
    const pending = 'pending' in p;
    const u = await prisma.user.create({
      data: {
        email: `${name.toLowerCase()}@example.test`,
        fullName: `${name} (dữ liệu mẫu)`,
        passwordHash: pending ? null : opts.passwordHash,
      },
    });
    users[name] = u.id;
    if ('departed' in p) continue;
    await prisma.companyMember.create({
      data: {
        userId: u.id,
        role: p.role,
        grants: 'grants' in p ? [...p.grants] : [],
        startDate: p.role === 'EMPLOYEE' ? day(pending ? today : start) : null,
      },
    });
  }
  // Quinn: nhiệm kỳ đã đóng hết tháng trước — vẫn có công tháng trước trong bảng công.
  const lastMonthEnd = addDays(monthStart(today, 0), -1);
  await prisma.companyMemberDeparture.create({
    data: {
      id: randomUUID(),
      userId: users.Quinn,
      role: 'EMPLOYEE',
      firstDay: day(start),
      lastDay: day(lastMonthEnd),
      leftAt: instantOf(addDays(lastMonthEnd, 1), 6 * 60, TZ),
      reason: 'OFFBOARDED',
    },
  });

  const activationLink = await issueActivation(prisma, users.Nina, users.Pam, now, opts.webOrigin);
  await seedAttendance(prisma, users, today, lastMonthEnd);
  await seedLeave(prisma, users, today, now);
  await seedWorkspaces(prisma, users);
  return { users, activationLink };
}

async function issueActivation(
  prisma: PrismaClient,
  userId: string,
  createdById: string,
  now: Date,
  webOrigin: string,
): Promise<string> {
  const { token, hash } = new CryptoRefreshTokenFactory().generate();
  await prisma.accountActivationToken.create({
    data: {
      id: randomUUID(),
      userId,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + ACTIVATION_TTL_MS),
      createdById,
    },
  });
  return `${webOrigin}/activate#t=${token}`;
}

/** Lượt Vào/Ra WEB: 5 ngày làm việc gần nhất cho nhân viên đang làm; Quinn 3 ngày cuối tháng trước. */
async function seedAttendance(
  prisma: PrismaClient,
  u: Record<SeedPerson, string>,
  today: LocalDate,
  lastMonthEnd: LocalDate,
) {
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
    for (const date of workdaysBefore(today, 5)) {
      rows.push(punch(u[name], date, 'IN', 7 * 60 + 50 + i * 3)); // 07:50…08:02 — Otto đi muộn
      rows.push(punch(u[name], date, 'OUT', 17 * 60 + 35 + i));
    }
  }
  for (const date of workdaysBefore(addDays(lastMonthEnd, 1), 3)) {
    rows.push(punch(u.Quinn, date, 'IN', 7 * 60 + 55), punch(u.Quinn, date, 'OUT', 17 * 60 + 31));
  }
  await prisma.attendanceEvent.createMany({ data: rows });
  // Hai ngày lễ bịa ở tháng sau (lịch làm việc = mặc định, không lưu phiên bản nào).
  const nextMonth = monthStart(today, -1);
  await prisma.holiday.createMany({
    data: [
      { date: day(addDays(nextMonth, 9)), name: 'Ngày lễ mẫu (bịa) 1' },
      { date: day(addDays(nextMonth, 10)), name: 'Ngày lễ mẫu (bịa) 2' },
    ],
  });
}

/** Đơn nghỉ: Mia đã duyệt (tuần sau), Vic chờ duyệt (lý do nhạy cảm giả), Otto bị từ chối. */
async function seedLeave(
  prisma: PrismaClient,
  u: Record<SeedPerson, string>,
  today: LocalDate,
  now: Date,
) {
  const d1 = nextWorkday(addDays(today, 7));
  const approved = await prisma.leaveRequest.create({
    data: {
      userId: u.Mia,
      type: 'ANNUAL',
      startDate: day(d1),
      endDate: day(nextWorkday(addDays(d1, 1))),
      status: 'APPROVED',
      decidedById: u.Pam,
      decidedAt: now,
      version: 2,
    },
  });
  const d2 = nextWorkday(addDays(today, 3));
  const pending = await prisma.leaveRequest.create({
    data: {
      userId: u.Vic,
      type: 'SICK',
      startDate: day(d2),
      endDate: day(d2),
      reason: 'Khám bệnh (mẫu)',
    },
  });
  const d3 = nextWorkday(addDays(today, 14));
  await prisma.leaveRequest.create({
    data: {
      userId: u.Otto,
      type: 'UNPAID',
      startDate: day(d3),
      endDate: day(d3),
      dayPart: 'AM',
      status: 'REJECTED',
      decidedById: u.Pam,
      decidedAt: now,
      decisionNote: 'Trùng lịch giao hàng (mẫu)',
      version: 2,
    },
  });
  // Thông báo như luồng thật: HR (Pam, Olivia) thấy đơn chờ; Mia thấy đơn đã duyệt.
  await prisma.notification.createMany({
    data: [
      { recipientId: u.Pam, type: 'LEAVE_SUBMITTED', refId: pending.id, actorId: u.Vic },
      { recipientId: u.Olivia, type: 'LEAVE_SUBMITTED', refId: pending.id, actorId: u.Vic },
      { recipientId: u.Mia, type: 'LEAVE_APPROVED', refId: approved.id, actorId: u.Pam },
    ],
  });
}
