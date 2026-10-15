import { InvalidStatusTransitionError } from '../../../core/errors';

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * State machine (data-and-api §6.1) — **nguồn sự thật** (ADR-043). `packages/contracts` có bản sao
 * `TASK_STATUS_TRANSITIONS` cho FE, giữ khớp bằng test parity (ADR-080). Cặp cùng trạng thái
 * (chỉ đổi rank) luôn hợp lệ nên không liệt kê.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['TODO', 'REVIEW'],
  REVIEW: ['IN_PROGRESS', 'DONE'],
  DONE: ['REVIEW'],
};

/** Ném `InvalidStatusTransitionError` (422, `details.allowed`) nếu không được chuyển `from → to`. */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStatusTransitionError({ from, to, allowed: [...allowed] });
  }
}
