import {
  DueDate,
  TaskDescription,
  TaskPriority,
  TaskTitle,
  type TaskDto,
} from '@taskflow/contracts/task';
import * as z from 'zod';

// Sửa task trong drawer + rebase 3 chiều khi 409 (frontend.md §4.6). Hàm thuần.

export const EDITABLE_FIELDS = ['title', 'description', 'priority', 'dueDate'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type TaskChanges = Partial<Pick<TaskDto, EditableField>>;

/** Schema form dẫn xuất từ primitive của contracts (không viết lại luật R1–R4). */
export const EditTaskSchema = z.object({
  title: TaskTitle,
  description: TaskDescription,
  priority: TaskPriority,
  /** `<input type="date">` rỗng ⇒ `''` ⇒ `null` (xóa hạn chót). */
  dueDate: z.union([z.literal('').transform(() => null), DueDate]),
});
export type EditTaskInput = z.input<typeof EditTaskSchema>;
export type EditTaskOutput = z.output<typeof EditTaskSchema>;

export function toFormValues(task: TaskDto): EditTaskInput {
  return {
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    dueDate: task.dueDate ?? '',
  };
}

/** Chỉ các field khác `base` — chính là "mine" của rebase và body PATCH (≥ 1 trường). */
export function diffChanges(base: TaskDto, values: EditTaskOutput): TaskChanges {
  const changes: TaskChanges = {};
  if (values.title !== base.title) changes.title = values.title;
  if (values.description !== base.description) changes.description = values.description;
  if (values.priority !== base.priority) changes.priority = values.priority;
  if (values.dueDate !== base.dueDate) changes.dueDate = values.dueDate;
  return changes;
}

/**
 * Field xung đột: mình đã sửa (`mine`), người khác cũng đã đổi so với `base` (`theirs[f] !== base[f]`)
 * và sang giá trị khác của mình. Rỗng ⇒ tự gửi lại với `theirs.version` (người dùng không thấy gì).
 * VD người khác chỉ kéo task (đổi status/rank/version) ⇒ không xung đột.
 */
export function conflictingFields(
  base: TaskDto,
  mine: TaskChanges,
  theirs: TaskDto,
): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => f in mine && theirs[f] !== base[f] && theirs[f] !== mine[f]);
}

/** Lỗi khi rebase không tự giải được — UI hiện khối hòa giải (wireframe §1.5). */
export class EditConflictError extends Error {
  override readonly name = 'EditConflictError';
  constructor(
    readonly theirs: TaskDto,
    readonly fields: readonly EditableField[],
  ) {
    super('Task vừa được người khác sửa cùng trường');
  }
}
