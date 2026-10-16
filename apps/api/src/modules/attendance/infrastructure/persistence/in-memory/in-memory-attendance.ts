import type { LeavePart } from '../../../domain/summarize-day';
import type { WorkSchedule } from '../../../domain/work-schedule';
import type { ApprovedLeavePort } from '../../../application/ports/approved-leave.port';
import type {
  IMembershipTenurePort,
  MembershipTenure,
} from '../../../application/ports/membership-tenure.port';
import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceEventRecord,
  type IAttendanceEventStore,
} from '../../../application/ports/attendance-event-store.port';
import type {
  HolidayRecord,
  IWorkCalendarStore,
} from '../../../application/ports/work-calendar-store.port';

/**
 * Bản in-memory cùng hợp đồng với Prisma (LSP): mô phỏng 2 unique index một phần của thiết kế §3 —
 * (ws, user, workDate) cho IN WEB chưa hủy, và (ws, user, source, idempotencyKey).
 */
export class InMemoryAttendanceEventStore implements IAttendanceEventStore {
  readonly rows: AttendanceEventRecord[] = [];

  listForUser(q: { workspaceId: string; userId: string; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (e) =>
            e.workspaceId === q.workspaceId &&
            e.userId === q.userId &&
            e.workDate >= q.from &&
            e.workDate <= q.to,
        )
        .map((e) => ({ ...e })),
    );
  }

  findByIdempotencyKey(q: {
    workspaceId: string;
    userId: string;
    source: AttendanceEventRecord['source'];
    key: string;
  }) {
    const row = this.rows.find(
      (e) =>
        e.workspaceId === q.workspaceId &&
        e.userId === q.userId &&
        e.source === q.source &&
        e.idempotencyKey === q.key,
    );
    return Promise.resolve(row ? { ...row } : null);
  }

  add(event: AttendanceEventRecord): Promise<void> {
    const same = (e: AttendanceEventRecord) =>
      e.workspaceId === event.workspaceId && e.userId === event.userId;
    if (
      event.kind === 'IN' &&
      event.source === 'WEB' &&
      event.voidedAt === null &&
      this.rows.some(
        (e) =>
          same(e) &&
          e.kind === 'IN' &&
          e.source === 'WEB' &&
          e.voidedAt === null &&
          e.workDate === event.workDate,
      )
    ) {
      return Promise.reject(new AlreadyCheckedInError());
    }
    if (
      event.idempotencyKey !== null &&
      this.rows.some(
        (e) => same(e) && e.source === event.source && e.idempotencyKey === event.idempotencyKey,
      )
    ) {
      return Promise.reject(new IdempotencyKeyTakenError());
    }
    this.rows.push({ ...event });
    return Promise.resolve();
  }

  findById(workspaceId: string, id: string) {
    const row = this.rows.find((e) => e.workspaceId === workspaceId && e.id === id);
    return Promise.resolve(row ? { ...row } : null);
  }

  void(q: {
    workspaceId: string;
    id: string;
    voidedAt: Date;
    voidedBy: string;
    voidReason: string;
  }) {
    const row = this.rows.find(
      (e) => e.workspaceId === q.workspaceId && e.id === q.id && e.voidedAt === null,
    );
    if (!row) return Promise.resolve(false);
    Object.assign(row, { voidedAt: q.voidedAt, voidedBy: q.voidedBy, voidReason: q.voidReason });
    return Promise.resolve(true);
  }

  hasAnyForUser(workspaceId: string, userId: string) {
    return Promise.resolve(
      this.rows.some((e) => e.workspaceId === workspaceId && e.userId === userId),
    );
  }
}

export class InMemoryWorkCalendarStore implements IWorkCalendarStore {
  readonly versions: WorkSchedule[] = [];
  readonly holidayRows: (HolidayRecord & { workspaceId: string })[] = [];
  constructor(private readonly workspaceId: string) {}

  scheduleVersions(workspaceId: string) {
    return Promise.resolve(workspaceId === this.workspaceId ? [...this.versions] : []);
  }

  holidays(q: { workspaceId: string; from: string; to: string }) {
    return Promise.resolve(
      this.holidayRows
        .filter((h) => h.workspaceId === q.workspaceId && h.date >= q.from && h.date <= q.to)
        .map(({ date, name }) => ({ date, name })),
    );
  }
}

/** Fake `IMembershipTenurePort` tới khi T-037b (B) có adapter thật — cùng ngữ nghĩa giao `[from, to)`. */
export class FakeMembershipTenures implements IMembershipTenurePort {
  readonly rows: (MembershipTenure & { workspaceId: string })[] = [];

  tenuresOf(q: { workspaceId: string; userIds?: readonly string[]; from: Date; to: Date }) {
    return Promise.resolve(
      this.rows
        .filter(
          (t) =>
            t.workspaceId === q.workspaceId &&
            (!q.userIds || q.userIds.includes(t.userId)) &&
            t.from < q.to &&
            (t.until === null || t.until >= q.from),
        )
        .sort((a, b) =>
          a.userId === b.userId
            ? a.from.getTime() - b.from.getTime()
            : a.userId < b.userId
              ? -1
              : 1,
        )
        .map(({ userId, from, until }) => ({ userId, from, until })),
    );
  }
}

/** Fake `ApprovedLeavePort` tới khi T-039 (leave) có adapter thật. */
export class FakeApprovedLeaves implements ApprovedLeavePort {
  readonly rows: { workspaceId: string; userId: string; date: string; part: LeavePart }[] = [];

  approvedLeaves(q: {
    workspaceId: string;
    userIds?: readonly string[];
    from: string;
    to: string;
  }) {
    return Promise.resolve(
      this.rows
        .filter(
          (l) =>
            l.workspaceId === q.workspaceId &&
            (!q.userIds || q.userIds.includes(l.userId)) &&
            l.date >= q.from &&
            l.date <= q.to,
        )
        .map(({ userId, date, part }) => ({ userId, date, part })),
    );
  }
}
