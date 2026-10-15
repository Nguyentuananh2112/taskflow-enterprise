import type { TaskEvent, UpdatableValues } from '../domain/task-events';
import type { TaskAuditAction, TaskAuditEntry } from './ports/audit-log.port';

type AuditValues = Pick<TaskAuditEntry, 'action' | 'oldValue' | 'newValue'>;

/** `description` trong UPDATED: chỉ `{ changed, length }`, không lưu nội dung (data-and-api §1.5). */
function maskDescription(values: UpdatableValues): Record<string, unknown> {
  if (!('description' in values)) return { ...values };
  const d = values.description ?? null;
  return { ...values, description: { changed: true, length: d === null ? 0 : d.length } };
}

/** Domain event ⇒ hình dạng `oldValue`/`newValue` theo action (data-and-api §1.5). */
export function auditValuesOf(event: TaskEvent): AuditValues {
  const of = (
    action: TaskAuditAction,
    oldValue: AuditValues['oldValue'],
    newValue: AuditValues['newValue'],
  ) => ({
    action,
    oldValue,
    newValue,
  });
  switch (event.type) {
    case 'TaskCreated':
      return of('CREATED', null, { ...event.snapshot });
    case 'TaskUpdated':
      return of('UPDATED', maskDescription(event.old), maskDescription(event.new));
    case 'TaskStatusChanged':
      return of(
        'STATUS_CHANGED',
        { status: event.from, rank: event.fromRank },
        { status: event.to, rank: event.toRank },
      );
    case 'TaskMoved':
      return of('MOVED', { rank: event.fromRank }, { rank: event.toRank });
    case 'TaskAssigneeChanged':
      return of('ASSIGNEE_CHANGED', { assigneeId: event.from }, { assigneeId: event.to });
    case 'TaskDeleted':
      return of('DELETED', { title: event.title, status: event.status }, null);
  }
}
