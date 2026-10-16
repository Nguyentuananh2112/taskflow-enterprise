import {
  AlreadyCheckedInError,
  IdempotencyKeyTakenError,
  type AttendanceEventRecord,
  type IAttendanceEventStore,
} from '../../../application/ports/attendance-event-store.port';

/**
 * Bản in-memory cùng hợp đồng với Prisma (LSP): mô phỏng 2 unique index một phần của thiết kế §3 —
 * (ws, user, workDate) cho IN WEB chưa hủy, và (ws, user, source, idempotencyKey).
 */
export class InMemoryAttendanceEventStore implements IAttendanceEventStore {
  readonly rows: AttendanceEventRecord[] = [];

  /** `Snapshottable` của InMemoryUnitOfWork (rollback ở chế độ bộ nhớ). */
  snapshot(): unknown {
    return structuredClone(this.rows);
  }

  restore(snapshot: unknown): void {
    this.rows.splice(0, this.rows.length, ...(snapshot as AttendanceEventRecord[]));
  }

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

  listForUsers(q: { workspaceId: string; userIds: readonly string[]; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (e) =>
            e.workspaceId === q.workspaceId &&
            q.userIds.includes(e.userId) &&
            e.workDate >= q.from &&
            e.workDate <= q.to,
        )
        .map((e) => ({ ...e })),
    );
  }

  userIdsWithEvents(q: { workspaceId: string; from: string; to: string }) {
    return Promise.resolve([
      ...new Set(
        this.rows
          .filter(
            (e) => e.workspaceId === q.workspaceId && e.workDate >= q.from && e.workDate <= q.to,
          )
          .map((e) => e.userId),
      ),
    ]);
  }

  hasAnyForUser(workspaceId: string, userId: string) {
    return Promise.resolve(
      this.rows.some((e) => e.workspaceId === workspaceId && e.userId === userId),
    );
  }
}
