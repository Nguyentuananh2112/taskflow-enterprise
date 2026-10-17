import type { AttendanceEvent as Row } from '../../../../../generated/prisma/client';
import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceEventRecord,
  type AttendanceSource,
  type IAttendanceEventStore,
} from '../../../application/ports/attendance-event-store.port';
import { fromDateOnly, toDateOnly, uniqueConstraintOf, type DbProvider } from './db';

/** 2 unique index một phần của migration 3 (T-037) — tên constraint ⇒ lỗi miền tương ứng. */
const WEB_IN_ONCE = 'attendance_events_web_in_once_key';
const IDEMPOTENCY = 'attendance_events_idempotency_key';

const toRecord = (r: Row): AttendanceEventRecord => ({
  id: r.id,
  userId: r.userId,
  kind: r.kind,
  source: r.source,
  occurredAt: r.occurredAt,
  workDate: toDateOnly(r.workDate),
  ip: r.ip,
  userAgent: r.userAgent,
  idempotencyKey: r.idempotencyKey,
  note: r.note,
  createdBy: r.createdById,
  voidedAt: r.voidedAt,
  voidedBy: r.voidedById,
  voidReason: r.voidReason,
});

/**
 * Lượt chấm trên Prisma 7 (ADR-121: chỉ thêm + hủy có điều kiện). Mọi truy vấn có phạm vi workspace (+
 * user). Unique một phần chặn race 2 check-in song song và request lặp cùng Idempotency-Key — Postgres hủy
 * transaction, use case xử lý lỗi miền.
 */
export class PrismaAttendanceEventStore implements IAttendanceEventStore {
  constructor(private readonly db: DbProvider) {}

  async listForUser(q: { userId: string; from: string; to: string }) {
    const rows = await this.db().attendanceEvent.findMany({
      where: {
        userId: q.userId,
        workDate: { gte: fromDateOnly(q.from), lte: fromDateOnly(q.to) },
      },
    });
    return rows.map(toRecord);
  }

  async listForUsers(q: { userIds: readonly string[]; from: string; to: string }) {
    if (q.userIds.length === 0) return [];
    const rows = await this.db().attendanceEvent.findMany({
      where: {
        userId: { in: [...q.userIds] },
        workDate: { gte: fromDateOnly(q.from), lte: fromDateOnly(q.to) },
      },
    });
    return rows.map(toRecord);
  }

  async userIdsWithEvents(q: { from: string; to: string }) {
    const rows = await this.db().attendanceEvent.findMany({
      where: {
        workDate: { gte: fromDateOnly(q.from), lte: fromDateOnly(q.to) },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async findByIdempotencyKey(q: { userId: string; source: AttendanceSource; key: string }) {
    const row = await this.db().attendanceEvent.findFirst({
      where: {
        userId: q.userId,
        source: q.source,
        idempotencyKey: q.key,
      },
    });
    return row ? toRecord(row) : null;
  }

  /** `pg_advisory_xact_lock` trả `void` — Prisma không đọc được cột void ⇒ `$executeRaw`. */
  async lockUserPunch(userId: string): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:attendance:punch:${userId}`}, 0))`;
  }

  async add(e: AttendanceEventRecord): Promise<void> {
    try {
      await this.db().attendanceEvent.create({
        data: {
          id: e.id,
          userId: e.userId,
          kind: e.kind,
          source: e.source,
          occurredAt: e.occurredAt,
          workDate: fromDateOnly(e.workDate),
          ip: e.ip,
          userAgent: e.userAgent,
          idempotencyKey: e.idempotencyKey,
          note: e.note,
          createdById: e.createdBy,
          voidedAt: e.voidedAt,
          voidedById: e.voidedBy,
          voidReason: e.voidReason,
        },
      });
    } catch (err) {
      const constraint = uniqueConstraintOf(err);
      if (constraint === WEB_IN_ONCE) throw new AlreadyCheckedInError();
      if (constraint === IDEMPOTENCY) throw new IdempotencyKeyTakenError();
      throw err;
    }
  }

  async findById(id: string) {
    const row = await this.db().attendanceEvent.findFirst({ where: { id } });
    return row ? toRecord(row) : null;
  }

  /** Một câu UPDATE có điều kiện `voided_at IS NULL` ⇒ 2 HR hủy song song: đúng 1 thắng. */
  async void(q: {
    id: string;
    voidedAt: Date;
    voidedBy: string;
    voidReason: string;
  }): Promise<boolean> {
    const { count } = await this.db().attendanceEvent.updateMany({
      where: { id: q.id, voidedAt: null },
      data: { voidedAt: q.voidedAt, voidedById: q.voidedBy, voidReason: q.voidReason },
    });
    return count === 1;
  }

  async hasAnyForUser(userId: string): Promise<boolean> {
    const row = await this.db().attendanceEvent.findFirst({
      where: { userId },
      select: { id: true },
    });
    return row !== null;
  }
}
