// Backend Postgres cho harness attendance (LSP, như task): cùng hợp đồng `AttendanceBackend` với bản
// in-memory ⇒ chạy lại nguyên bộ test use case tầng A trên repo Prisma + unique index một phần thật.
import { PrismaAttendanceEventStore } from '../../../src/modules/attendance/infrastructure/persistence/prisma/prisma-attendance-event.store';
import { PrismaCorrectionStore } from '../../../src/modules/attendance/infrastructure/persistence/prisma/prisma-correction.store';
import { PrismaWorkCalendarStore } from '../../../src/modules/attendance/infrastructure/persistence/prisma/prisma-work-calendar.store';
import {
  byTime,
  type AttendanceBackend,
} from '../../../src/modules/attendance/testing/attendance-backend';
import { FIXTURE } from '../../../src/modules/attendance/testing/attendance-fixture';
import { RecordingUnitOfWork, testPrisma } from '../support/prisma-test-kit';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export function prismaAttendanceBackend(): AttendanceBackend {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  const prisma = testPrisma();
  const events = new PrismaAttendanceEventStore(db);
  return {
    uow,
    events,
    calendar: new PrismaWorkCalendarStore(db),
    corrections: new PrismaCorrectionStore(db),
    async seed() {
      for (const [id, fullName] of Object.entries(FIXTURE.users)) {
        await prisma.user.create({
          data: { id, email: `${id}@example.test`, fullName, passwordHash: 'x' },
        });
      }
    },
    async eventRows() {
      const rows = await prisma.attendanceEvent.findMany({ select: { userId: true } });
      const out = [];
      for (const userId of new Set(rows.map((r) => r.userId))) {
        out.push(...(await events.listForUser({ userId, from: '1970-01-01', to: '2999-12-31' })));
      }
      return out.sort(byTime);
    },
    async addScheduleVersion(s, createdBy) {
      await prisma.workSchedule.create({
        data: {
          effectiveFrom: day(s.effectiveFrom),
          timezone: s.timezone,
          workdays: s.workdays,
          startMin: s.startMin,
          endMin: s.endMin,
          breakStartMin: s.breakStartMin,
          breakEndMin: s.breakEndMin,
          graceMin: s.graceMin,
          createdById: createdBy,
        },
      });
    },
    async addHoliday(date, name) {
      await prisma.holiday.create({ data: { date: day(date), name } });
    },
  };
}
