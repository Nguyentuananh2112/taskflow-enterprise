import type {
  CorrectionInsertResult,
  CorrectionRecord,
  ICorrectionStore,
} from '../../../application/ports/correction-store.port';

/**
 * Bản in-memory cùng hợp đồng với Prisma (LSP): mô phỏng partial unique "một PENDING / (user, ngày, loại)", unique
 * (user, idempotencyKey) và các CHECK của migration 8 (quyết định ⇔ APPROVED/REJECTED; lượt ⇔ APPROVED).
 */
export class InMemoryCorrectionStore implements ICorrectionStore {
  readonly rows: CorrectionRecord[] = [];

  snapshot(): unknown {
    return structuredClone(this.rows);
  }

  restore(snapshot: unknown): void {
    this.rows.splice(0, this.rows.length, ...(snapshot as CorrectionRecord[]));
  }

  insert(record: CorrectionRecord): Promise<CorrectionInsertResult> {
    if (
      this.rows.some(
        (r) => r.userId === record.userId && r.idempotencyKey === record.idempotencyKey,
      )
    ) {
      return Promise.resolve('key_exists');
    }
    const pending = (r: CorrectionRecord) =>
      r.status === 'PENDING' &&
      r.userId === record.userId &&
      r.workDate === record.workDate &&
      r.kind === record.kind;
    if (this.rows.some(pending)) return Promise.resolve('pending_exists');
    this.rows.push({ ...record });
    return Promise.resolve('ok');
  }

  findById(id: string): Promise<CorrectionRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return Promise.resolve(row ? { ...row } : null);
  }

  findByKey(userId: string, idempotencyKey: string): Promise<CorrectionRecord | null> {
    const row = this.rows.find((r) => r.userId === userId && r.idempotencyKey === idempotencyKey);
    return Promise.resolve(row ? { ...row } : null);
  }

  decide(input: Parameters<ICorrectionStore['decide']>[0]): Promise<CorrectionRecord | null> {
    const row = this.rows.find(
      (r) => r.id === input.id && r.status === 'PENDING' && r.version === input.expectedVersion,
    );
    if (!row) return Promise.resolve(null);
    const decided = input.status !== 'CANCELLED';
    if (decided !== (input.decidedById !== null && input.decidedAt !== null)) {
      throw new Error('CHECK: decided_by/decided_at ⇔ APPROVED/REJECTED');
    }
    if ((input.status === 'APPROVED') !== (input.createdEventId !== null)) {
      throw new Error('CHECK: created_event_id ⇔ APPROVED');
    }
    Object.assign(row, {
      status: input.status,
      decidedById: input.decidedById,
      decidedAt: input.decidedAt,
      decisionNote: input.decisionNote,
      createdEventId: input.createdEventId,
      version: row.version + 1,
      updatedAt: input.at,
    });
    return Promise.resolve({ ...row });
  }

  list(q: Parameters<ICorrectionStore['list']>[0]) {
    const sorted = this.rows
      .filter(
        (r) =>
          (q.userId === undefined || r.userId === q.userId) && (!q.status || r.status === q.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    const start = q.cursor ? sorted.findIndex((r) => r.id === q.cursor) + 1 : 0;
    const page = sorted.slice(start, start + q.limit);
    const nextCursor = start + q.limit < sorted.length ? (page.at(-1)?.id ?? null) : null;
    return Promise.resolve({ rows: page.map((r) => ({ ...r })), nextCursor });
  }

  cancelPendingOf(userId: string, at: Date): Promise<string[]> {
    const ids: string[] = [];
    for (const r of this.rows) {
      if (r.userId === userId && r.status === 'PENDING') {
        Object.assign(r, { status: 'CANCELLED', version: r.version + 1, updatedAt: at });
        ids.push(r.id);
      }
    }
    return Promise.resolve(ids);
  }
}
