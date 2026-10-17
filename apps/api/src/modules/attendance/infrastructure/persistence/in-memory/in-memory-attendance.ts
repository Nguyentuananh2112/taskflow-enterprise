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

  /**
   * Thứ tự kiểm hai unique khi một lượt vi phạm CẢ HAI — Postgres không cam kết thứ tự nào, nên test chạy cả hai
   * (CC-HR-02: hai check-in song song cùng key).
   */
  uniqueCheckOrder: 'in-once-first' | 'key-first' = 'in-once-first';

  /** Thứ tự khóa đã lấy (test kiểm "khóa TRƯỚC khi đọc"); tuần tự thật chỉ có ở Postgres (test integration). */
  readonly locks: string[] = [];

  lockUserPunch(userId: string): Promise<void> {
    this.locks.push(`taskflow:attendance:punch:${userId}`);
    return Promise.resolve();
  }

  add(event: AttendanceEventRecord): Promise<void> {
    const same = (e: AttendanceEventRecord) =>
      e.workspaceId === event.workspaceId && e.userId === event.userId;
    const inOnce =
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
      );
    const keyTaken =
      event.idempotencyKey !== null &&
      this.rows.some(
        (e) => same(e) && e.source === event.source && e.idempotencyKey === event.idempotencyKey,
      );
    const violations = [
      ...(inOnce ? [new AlreadyCheckedInError()] : []),
      ...(keyTaken ? [new IdempotencyKeyTakenError()] : []),
    ];
    if (this.uniqueCheckOrder === 'key-first') violations.reverse();
    if (violations[0]) return Promise.reject(violations[0]);
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
