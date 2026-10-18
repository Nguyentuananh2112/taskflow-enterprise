import type { AttendanceCorrectionRequest as Row } from '../../../../../generated/prisma/client';
import type {
  CorrectionInsertResult,
  CorrectionRecord,
  ICorrectionStore,
} from '../../../application/ports/correction-store.port';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';

const toRecord = (r: Row): CorrectionRecord => ({
  id: r.id,
  userId: r.userId,
  workDate: toDateOnly(r.workDate),
  kind: r.kind,
  minuteOfDay: r.minuteOfDay,
  nextDay: r.nextDay,
  reason: r.reason,
  status: r.status,
  idempotencyKey: r.idempotencyKey,
  decidedById: r.decidedById,
  decidedAt: r.decidedAt,
  decisionNote: r.decisionNote,
  createdEventId: r.createdEventId,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Đơn bổ sung giờ trên Prisma (migration 8, T-055). Thêm bằng `INSERT … ON CONFLICT DO NOTHING` (`skipDuplicates`) ⇒ đụng
 * partial unique "một PENDING / (user, ngày, loại)" hay unique (user, idempotency_key) KHÔNG làm hỏng transaction đang
 * mở; đọc lại để biết đụng cái nào. Chuyển trạng thái là UPDATE có điều kiện (đếm 1). Không cột workspace (ADR-133).
 */
export class PrismaCorrectionStore implements ICorrectionStore {
  constructor(private readonly db: DbProvider) {}

  async insert(record: CorrectionRecord): Promise<CorrectionInsertResult> {
    const { count } = await this.db().attendanceCorrectionRequest.createMany({
      data: [
        {
          id: record.id,
          userId: record.userId,
          workDate: fromDateOnly(record.workDate),
          kind: record.kind,
          minuteOfDay: record.minuteOfDay,
          nextDay: record.nextDay,
          reason: record.reason,
          status: record.status,
          idempotencyKey: record.idempotencyKey,
          version: record.version,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 1) return 'ok';
    return (await this.findByKey(record.userId, record.idempotencyKey))
      ? 'key_exists'
      : 'pending_exists';
  }

  async findById(id: string): Promise<CorrectionRecord | null> {
    const row = await this.db().attendanceCorrectionRequest.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByKey(userId: string, idempotencyKey: string): Promise<CorrectionRecord | null> {
    const row = await this.db().attendanceCorrectionRequest.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    return row ? toRecord(row) : null;
  }

  async decide(input: Parameters<ICorrectionStore['decide']>[0]): Promise<CorrectionRecord | null> {
    const { count } = await this.db().attendanceCorrectionRequest.updateMany({
      where: { id: input.id, status: 'PENDING', version: input.expectedVersion },
      data: {
        status: input.status,
        decidedById: input.decidedById,
        decidedAt: input.decidedAt,
        decisionNote: input.decisionNote,
        createdEventId: input.createdEventId,
        version: { increment: 1 },
        updatedAt: input.at,
      },
    });
    return count === 1 ? this.findById(input.id) : null;
  }

  async list(q: Parameters<ICorrectionStore['list']>[0]) {
    const after = q.cursor
      ? await this.db().attendanceCorrectionRequest.findUnique({
          where: { id: q.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    const rows = await this.db().attendanceCorrectionRequest.findMany({
      where: {
        ...(q.userId === undefined ? {} : { userId: q.userId }),
        ...(q.status ? { status: q.status } : {}),
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      rows: page.map(toRecord),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async cancelPendingOf(userId: string, at: Date): Promise<string[]> {
    const pending = await this.db().attendanceCorrectionRequest.findMany({
      where: { userId, status: 'PENDING' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (pending.length === 0) return [];
    const ids = pending.map((r) => r.id);
    await this.db().attendanceCorrectionRequest.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'CANCELLED', version: { increment: 1 }, updatedAt: at },
    });
    return ids;
  }
}
