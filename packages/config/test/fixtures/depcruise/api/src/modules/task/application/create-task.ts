// FIXTURE HỢP LỆ — application → domain.
import { TaskEntity } from '../domain/task.entity';
export const createTask = () => new TaskEntity();
