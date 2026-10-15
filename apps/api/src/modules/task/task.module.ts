import type { ITaskAuditLogRepository } from './application/ports/audit-log.port';
import type {
  IAssigneeDirectory,
  ITaskProjectStore,
  IUserRefReader,
} from './application/ports/collaborators.port';
import type { ITaskReadModel } from './application/ports/task-read-model.port';
import type { ITaskRepository } from './application/ports/task-repository.port';

// T-023: chỉ khai hình dạng repository của module (composition root lắp bản Prisma). Phần lắp
// use case/route (module factory, InMemory) do A thêm ở T-024 — cùng tên, cùng hình dạng.
export interface TaskRepositories {
  tasks: ITaskRepository;
  readModel: ITaskReadModel;
  projects: ITaskProjectStore;
  assignees: IAssigneeDirectory;
  users: IUserRefReader;
  audit: ITaskAuditLogRepository;
}
