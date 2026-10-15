// FIXTURE HỢP LỆ — domain chỉ import domain cùng module.
import type { TaskStatus } from './task-status';

export class TaskEntity {
  constructor(readonly status: TaskStatus) {}
}
