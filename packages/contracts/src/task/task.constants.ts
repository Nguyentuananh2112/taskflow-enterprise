import * as z from 'zod';

export const TaskStatus = z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** Thứ tự cột trên board và thứ tự sắp khi list không lọc status. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = Object.freeze(TaskStatus.options);

/**
 * Bản sao dạng dữ liệu của state machine (ADR-043, ADR-080) để FE chặn sớm thả sai cột.
 * Nguồn sự thật là `TaskEntity` ở domain; `apps/api` có test parity bắt buộc.
 * Không chứa cặp cùng trạng thái (đổi rank trong cột luôn hợp lệ).
 */
export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> =
  Object.freeze({
    TODO: Object.freeze(['IN_PROGRESS'] as const),
    IN_PROGRESS: Object.freeze(['TODO', 'REVIEW'] as const),
    REVIEW: Object.freeze(['IN_PROGRESS', 'DONE'] as const),
    DONE: Object.freeze(['REVIEW'] as const),
  });
