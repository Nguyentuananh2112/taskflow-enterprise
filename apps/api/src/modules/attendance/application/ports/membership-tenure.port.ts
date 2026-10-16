/** Nhiệm kỳ nhân viên của một user trong workspace (T-037b của B; người đã rời lấy từ `workspace_member_departures`). */
export interface MembershipTenure {
  userId: string;
  /** joinedAt. */
  from: Date;
  /** leftAt; `null` = đang là thành viên. */
  until: Date | null;
}

/**
 * Nhiệm kỳ thành viên (TL chốt: ngày ngoài mọi nhiệm kỳ và không có lượt ⇒ NOT_EMPLOYED). Attendance sở hữu,
 * adapter ở module workspace, nối ở composition root. Chữ ký chốt với B:
 * - mọi nhiệm kỳ GIAO `[from, to)` (instant) — `tenure.from < to` và (`until` null hoặc `until ≥ from`); không
 *   cắt `from`/`until`; attendance tự quy ngày ↔ instant theo múi giờ lịch;
 * - bỏ `userIds` ⇒ mọi user có nhiệm kỳ trong khoảng (kể cả đã rời); `[]` ⇒ `[]`;
 * - chỉ nhân viên: adapter tự lọc VIEWER (hiện là VIEWER / rời khi đang là VIEWER ⇒ không có dòng);
 * - sắp theo `userId`, rồi `from` tăng dần.
 */
export interface IMembershipTenurePort {
  tenuresOf(q: {
    workspaceId: string;
    userIds?: readonly string[];
    from: Date;
    to: Date;
  }): Promise<MembershipTenure[]>;
}
