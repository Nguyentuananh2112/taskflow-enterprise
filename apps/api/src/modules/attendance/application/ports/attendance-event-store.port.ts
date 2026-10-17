import type { LocalDate } from '../../domain/local-time';

export type AttendanceKind = 'IN' | 'OUT';
export type AttendanceSource = 'WEB' | 'DEVICE' | 'ADJUSTMENT';

/** Một lượt chấm (ADR-121: chỉ thêm; sai thì HR hủy + thêm lượt ADJUSTMENT). */
export interface AttendanceEventRecord {
  id: string;
  workspaceId: string;
  userId: string;
  kind: AttendanceKind;
  source: AttendanceSource;
  occurredAt: Date;
  workDate: LocalDate;
  ip: string | null;
  userAgent: string | null;
  idempotencyKey: string | null;
  note: string | null;
  createdBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** Vi phạm unique "1 IN web còn hiệu lực / người / ngày" — chốt chặn race của 2 check-in song song. */
export class AlreadyCheckedInError extends Error {
  constructor() {
    super('Đã có lượt vào hôm nay.');
    this.name = 'AlreadyCheckedInError';
  }
}

/** Vi phạm unique `(workspace, user, source, idempotencyKey)` — request lặp chạy song song. */
export class IdempotencyKeyTakenError extends Error {
  constructor() {
    super('Idempotency-Key đã được dùng.');
    this.name = 'IdempotencyKeyTakenError';
  }
}

/**
 * Lưu trữ lượt chấm. Mọi truy vấn có phạm vi tenant (workspace + user). Bản Prisma dùng 2 unique index
 * một phần (thiết kế §3): IN web chưa hủy theo ngày, và Idempotency-Key theo (ws, user, source).
 */
export interface IAttendanceEventStore {
  /** Lượt của một người có `workDate` trong `[from, to]` (gồm cả lượt đã hủy), thứ tự bất kỳ. */
  listForUser(q: {
    workspaceId: string;
    userId: string;
    from: LocalDate;
    to: LocalDate;
  }): Promise<AttendanceEventRecord[]>;
  /** Như `listForUser` cho nhiều người một lần (bảng HR / CSV). */
  listForUsers(q: {
    workspaceId: string;
    userIds: readonly string[];
    from: LocalDate;
    to: LocalDate;
  }): Promise<AttendanceEventRecord[]>;
  /** Người có lượt chấm (kể cả đã hủy) với `workDate` trong `[from, to]` — gồm người đã rời (R30). */
  userIdsWithEvents(q: { workspaceId: string; from: LocalDate; to: LocalDate }): Promise<string[]>;
  findByIdempotencyKey(q: {
    workspaceId: string;
    userId: string;
    source: AttendanceSource;
    key: string;
  }): Promise<AttendanceEventRecord | null>;
  /**
   * Khóa chấm WEB của một người tới hết transaction (T-053a): `pg_advisory_xact_lock(hashtextextended(
   * 'taskflow:attendance:punch:<user>', 0))` — theo USER, không theo ws, để chấm gộp mọi ws và chấm từng ws chạy tuần
   * tự. Gọi trong `uow.run`, TRƯỚC mọi lần đọc.
   */
  lockUserPunch(userId: string): Promise<void>;
  /** Ném `AlreadyCheckedInError` / `IdempotencyKeyTakenError` khi vi phạm unique tương ứng. */
  add(event: AttendanceEventRecord): Promise<void>;
  /** Lượt theo id TRONG workspace (id của ws khác ⇒ null ⇒ 404, ADR-020). */
  findById(workspaceId: string, id: string): Promise<AttendanceEventRecord | null>;
  /**
   * Hủy có điều kiện trong MỘT câu lệnh: chỉ khi `voidedAt IS NULL` (2 HR hủy song song ⇒ đúng 1 thắng).
   * Trả `false` khi lượt đã bị hủy trước đó. Dòng không bao giờ bị xóa (ADR-121).
   */
  void(q: {
    workspaceId: string;
    id: string;
    voidedAt: Date;
    voidedBy: string;
    voidReason: string;
  }): Promise<boolean>;
  /** Người này đã từng có lượt chấm nào trong workspace (kể cả người đã rời — AT-20)? */
  hasAnyForUser(workspaceId: string, userId: string): Promise<boolean>;
}
