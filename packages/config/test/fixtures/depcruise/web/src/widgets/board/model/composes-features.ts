// FIXTURE HỢP LỆ — widget ghép 2 feature qua public API.
import { editTask } from '@/features/task-edit';
import { moveTask } from '@/features/task-move';
import { cn } from '@/shared/lib/cn';
export const x = [editTask, moveTask, cn];
