import type { TaskDto } from '@taskflow/contracts';

import type { TaskEvent } from '../domain/task-events';

export interface TaskRealtimeMessage {
  type: 'task:created' | 'task:updated' | 'task:moved' | 'task:deleted';
  data: unknown;
}

/**
 * Domain event của MỘT use case ⇒ đúng MỘT realtime event (data-and-api §4.3, RT-09).
 * `task` là DTO đọc sau khi ghi (version đúng). Không có event ⇒ `null` (no-op, RT-08).
 */
export function realtimeMessageOf(
  events: readonly TaskEvent[],
  task: TaskDto,
): TaskRealtimeMessage | null {
  const main = events[0];
  if (!main) return null;
  switch (main.type) {
    case 'TaskCreated':
      return { type: 'task:created', data: { task } };
    case 'TaskStatusChanged':
      return {
        type: 'task:moved',
        data: {
          task,
          from: { status: main.from, rank: main.fromRank },
          to: { status: main.to, rank: main.toRank },
        },
      };
    case 'TaskMoved':
      return {
        type: 'task:moved',
        data: {
          task,
          from: { status: main.status, rank: main.fromRank },
          to: { status: main.status, rank: main.toRank },
        },
      };
    case 'TaskUpdated':
      return { type: 'task:updated', data: { task, changedFields: [...main.changedFields] } };
    case 'TaskAssigneeChanged':
      return { type: 'task:updated', data: { task, changedFields: ['assignee'] } };
    case 'TaskDeleted':
      return {
        type: 'task:deleted',
        data: {
          taskId: main.aggregateId,
          projectId: main.projectId,
          key: task.key,
          version: main.version,
        },
      };
  }
}
