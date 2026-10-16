import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';

import { USER_B, makeTask } from '@test/task-fixture';

// Dữ liệu + số liệu cho perf/board-scale.perf.tsx (tách để file đo ≤ 150 dòng).

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const OTHER_TAB = crypto.randomUUID(); // X-Client-Id của tab khác (envelope đòi Uuid)
export const ms = (n: number) => Math.round(n * 10) / 10;
export const rank = (prefix: string, i: number) => `${prefix}${String(i).padStart(4, '0')}`;

export function seed(columns: number, perColumn: number): TaskDto[] {
  return Array.from({ length: columns * perColumn }, (_, i) =>
    makeTask({
      status: STATUSES[i % columns] ?? 'TODO',
      rank: rank('a', Math.floor(i / columns)),
      title: `Task số ${i}`,
    }),
  );
}

/** Event thô như trên dây (để parse Zod như hook thật), do tab KHÁC gây ra. */
export function movedEvent(task: TaskDto, to: { status: TaskStatus; rank: string }): unknown {
  const moved = { ...task, status: to.status, rank: to.rank, version: task.version + 1 };
  return {
    eventId: crypto.randomUUID(),
    type: 'task:moved',
    occurredAt: '2026-10-16T08:00:00.000Z',
    actorId: USER_B.id,
    originClientId: OTHER_TAB,
    data: { task: moved, from: { status: task.status, rank: task.rank }, to },
  };
}

export const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((s, x) => s + x, 0);
  return {
    sum,
    avg: sum / Math.max(1, xs.length),
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? NaN,
    max: sorted.at(-1) ?? NaN,
  };
};
