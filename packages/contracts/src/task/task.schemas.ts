import * as z from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import {
  Cursor,
  DateOnly,
  IsoDateTime,
  Uuid,
  Version,
  limitQuery,
  multiLineTextOrNull,
  singleLineText,
} from '../common/primitives';
import { TaskPriority, TaskStatus } from './task.constants';

/** R1: 3–150 ký tự sau trim, một dòng. */
export const TaskTitle = singleLineText(3, 150);
/** R2: ≤ 10 000 ký tự; rỗng ⇒ null. */
export const TaskDescription = multiLineTextOrNull(10_000);
/** R4: `YYYY-MM-DD`, năm 2000–2100; cho phép ngày quá khứ. */
export const DueDate = DateOnly.refine(
  (d) => {
    const year = Number(d.slice(0, 4));
    return year >= 2000 && year <= 2100;
  },
  { error: 'Năm phải trong khoảng 2000–2100' },
);
/** Mã hiển thị `TF-101`, suy ra từ keyPrefix + number (D7). */
export const TaskKey = z.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/);

export const TaskParams = z.object({ wsId: Uuid, projectId: Uuid, taskId: Uuid });
export type TaskParams = z.infer<typeof TaskParams>;

export const ListTasksQuery = z.object({
  status: TaskStatus.optional(),
  assigneeId: z.union([Uuid, z.literal('none')]).optional(),
  cursor: Cursor.optional(),
  limit: limitQuery(500, 200),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

/** Task mới luôn ở TODO, cuối cột (R12) — không nhận status/rank từ client. */
export const CreateTaskBody = z.strictObject({
  title: TaskTitle,
  description: TaskDescription.optional(),
  priority: TaskPriority.optional(),
  dueDate: DueDate.nullable().optional(),
  assigneeId: Uuid.optional(),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;

export const UpdateTaskBody = z
  .strictObject({
    expectedVersion: Version,
    title: TaskTitle.optional(),
    description: TaskDescription.optional(),
    priority: TaskPriority.optional(),
    dueDate: DueDate.nullable().optional(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.description !== undefined ||
      b.priority !== undefined ||
      b.dueDate !== undefined,
    { error: 'Phải có ít nhất một trường cần sửa' },
  );
export type UpdateTaskBody = z.infer<typeof UpdateTaskBody>;

/** `afterId` = task ngay trên, `beforeId` = task ngay dưới vị trí mới (data-and-api §2.7). */
export const MoveTaskBody = z.strictObject({
  expectedVersion: Version,
  status: TaskStatus.optional(),
  afterId: Uuid.nullable().optional(),
  beforeId: Uuid.nullable().optional(),
});
export type MoveTaskBody = z.infer<typeof MoveTaskBody>;

export const AssignTaskBody = z.strictObject({
  expectedVersion: Version,
  assigneeId: Uuid.nullable(),
});
export type AssignTaskBody = z.infer<typeof AssignTaskBody>;

export const DeleteTaskQuery = z.object({
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
export type DeleteTaskQuery = z.infer<typeof DeleteTaskQuery>;

export const TaskDto = z.object({
  id: Uuid,
  workspaceId: Uuid,
  projectId: Uuid,
  number: z.int().min(1),
  key: TaskKey,
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatus,
  priority: TaskPriority,
  rank: z.string().min(1),
  version: Version,
  dueDate: DateOnly.nullable(),
  assignee: UserRefDto.nullable(),
  createdBy: UserRefDto.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskDto = z.infer<typeof TaskDto>;

export const DeleteTaskResponse = z.object({ id: Uuid, version: Version });
export type DeleteTaskResponse = z.infer<typeof DeleteTaskResponse>;

/** `error.details` của `VERSION_CONFLICT` — đủ để FE hòa giải không cần refetch. */
export const VersionConflictDetails = z.object({ currentVersion: Version, current: TaskDto });
export type VersionConflictDetails = z.infer<typeof VersionConflictDetails>;

export const InvalidStatusTransitionDetails = z.object({
  from: TaskStatus,
  to: TaskStatus,
  allowed: z.array(TaskStatus),
});
export type InvalidStatusTransitionDetails = z.infer<typeof InvalidStatusTransitionDetails>;

export const ProjectArchivedDetails = z.object({ projectId: Uuid });
export type ProjectArchivedDetails = z.infer<typeof ProjectArchivedDetails>;
