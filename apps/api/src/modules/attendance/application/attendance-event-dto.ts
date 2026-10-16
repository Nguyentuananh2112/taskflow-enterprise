import type { AttendanceEventDto } from '@taskflow/contracts';

import type { AttendanceEventRecord } from './ports/attendance-event-store.port';
import type { IUserRefReader } from './ports/collaborators.port';

/** Tên thay thế khi không đọc được user (đã xóa cứng — FK `Restrict` nên thực tế không xảy ra). */
const UNKNOWN_USER = 'Người dùng đã xóa';

/** Lượt chấm ⇒ `AttendanceEventDto` (đọc tên người tạo / người hủy MỘT lần cho cả danh sách). */
export async function toEventDtos(
  users: IUserRefReader,
  events: readonly AttendanceEventRecord[],
): Promise<AttendanceEventDto[]> {
  const ids = new Set(events.flatMap((e) => [e.createdBy, ...(e.voidedBy ? [e.voidedBy] : [])]));
  const refs = await users.findRefs([...ids]);
  const ref = (userId: string) => refs.get(userId) ?? { id: userId, fullName: UNKNOWN_USER };
  return events.map((e) => ({
    id: e.id,
    userId: e.userId,
    kind: e.kind,
    source: e.source,
    occurredAt: e.occurredAt.toISOString(),
    workDate: e.workDate,
    note: e.note,
    createdBy: ref(e.createdBy),
    voidedAt: e.voidedAt ? e.voidedAt.toISOString() : null,
    voidedBy: e.voidedBy ? ref(e.voidedBy) : null,
    voidReason: e.voidReason,
    ip: e.ip,
    userAgent: e.userAgent,
  }));
}
