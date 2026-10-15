import {
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskUpdatedEvent,
} from '@taskflow/contracts/realtime';

import type { TaskEvent } from './apply-realtime-event';

const SCHEMAS = {
  'task:created': TaskCreatedEvent,
  'task:updated': TaskUpdatedEvent,
  'task:moved': TaskMovedEvent,
  'task:deleted': TaskDeletedEvent,
} as const;

/**
 * Event socket parse bằng schema contracts trước khi chạm cache — payload sai hình dạng (server khác
 * phiên bản) bị bỏ thay vì làm hỏng board. Một event nhỏ ⇒ chi phí không đáng kể (§4.7: < 4ms).
 */
export function parseTaskEvent(raw: unknown): TaskEvent | null {
  const type = typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined;
  if (typeof type !== 'string' || !(type in SCHEMAS)) return null;
  const parsed = SCHEMAS[type as keyof typeof SCHEMAS].safeParse(raw);
  return parsed.success ? parsed.data : null;
}
