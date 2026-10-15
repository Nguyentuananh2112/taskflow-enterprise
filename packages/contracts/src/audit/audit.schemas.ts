import * as z from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import { Cursor, IsoDateTime, Uuid, limitQuery } from '../common/primitives';

export const TaskAuditAction = z.enum([
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'MOVED',
  'ASSIGNEE_CHANGED',
  'DELETED',
]);
export type TaskAuditAction = z.infer<typeof TaskAuditAction>;

/** Mới nhất trước; task đã xóa mềm vẫn đọc được lịch sử (R16). */
export const ListAuditLogsQuery = z.object({
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuery>;

/** Hình dạng old/new theo action: data-and-api §1.5. */
const AuditValue = z.record(z.string(), z.unknown()).nullable();

export const AuditLogDto = z.object({
  id: Uuid,
  taskId: Uuid,
  action: TaskAuditAction,
  actor: UserRefDto,
  oldValue: AuditValue,
  newValue: AuditValue,
  createdAt: IsoDateTime,
});
export type AuditLogDto = z.infer<typeof AuditLogDto>;
