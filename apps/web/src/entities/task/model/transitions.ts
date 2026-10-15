import { TASK_STATUS_TRANSITIONS, type TaskStatus } from '@taskflow/contracts/task';

// Bọc bảng chuyển trạng thái của contracts (ADR-043/080) — FE không giữ bản sao riêng.
// Đổi rank trong cùng cột luôn hợp lệ.

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_STATUS_TRANSITIONS[from].includes(to);
}

/** Cột được phép thả khi kéo thẻ đang ở `from` = các đích hợp lệ ∪ {from} (frontend.md §4.2). */
export function allowedTargets(from: TaskStatus): readonly TaskStatus[] {
  return [from, ...TASK_STATUS_TRANSITIONS[from]];
}
