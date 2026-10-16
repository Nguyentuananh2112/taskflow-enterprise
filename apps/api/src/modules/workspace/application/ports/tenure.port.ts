import type { WorkspaceRole } from '../../domain/roles';

export type MemberDepartureReason = 'REMOVED' | 'LEFT';

/** Một nhiệm kỳ ĐÃ KẾT THÚC (T-037b): ghi CÙNG transaction với lệnh xóa dòng workspace_members. */
export interface MemberDeparture {
  id: string;
  workspaceId: string;
  userId: string;
  /** Role lúc rời — VIEWER không phải nhân viên, `tenuresOf` bỏ qua. */
  role: WorkspaceRole;
  joinedAt: Date;
  leftAt: Date;
  reason: MemberDepartureReason;
}

export interface IMemberDepartureLog {
  record(departure: MemberDeparture): Promise<void>;
}

export interface TenureQuery {
  workspaceId: string;
  /** Bỏ ⇒ mọi người có nhiệm kỳ giao khoảng (gồm cả người đã rời); `[]` ⇒ `[]`. */
  userIds?: readonly string[] | undefined;
  /** Instant, bao gồm. */
  from: Date;
  /** Instant, KHÔNG bao gồm. */
  to: Date;
}

/** `until = null` ⇒ đang là thành viên. Giá trị thật, không cắt theo khoảng hỏi. */
export interface MembershipTenure {
  userId: string;
  from: Date;
  until: Date | null;
}

/**
 * Port `IMembershipTenurePort` của attendance (chốt với A, T-037b): nhiệm kỳ NHÂN VIÊN (OWNER / PM /
 * MEMBER) giao `[from, to)` — tức `tenure.from < to` VÀ (`until` null HOẶC `until ≥ from`). Người HIỆN
 * là VIEWER không có nhiệm kỳ hiện tại; nhiệm kỳ cũ rời khi là VIEWER bị bỏ; đổi role không cắt nhiệm
 * kỳ (v1). Sắp theo `userId`, rồi `from` tăng dần. Chỉ đọc.
 */
export interface IMembershipTenureReader {
  tenuresOf(query: TenureQuery): Promise<MembershipTenure[]>;
}

/** Điều kiện giao + thứ tự dùng chung cho bản InMemory và kiểm chứng bản Prisma. */
export function overlaps(t: MembershipTenure, q: Pick<TenureQuery, 'from' | 'to'>): boolean {
  return t.from < q.to && (t.until === null || t.until >= q.from);
}

export function byUserThenFrom(a: MembershipTenure, b: MembershipTenure): number {
  // So byte như ORDER BY của Postgres (uuid chữ thường), không theo locale.
  if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
  return a.from.getTime() - b.from.getTime();
}
