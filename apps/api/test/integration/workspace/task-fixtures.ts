// Fixture task tối thiểu cho test của Workspace (module Task — T-018 — chưa merge).
import type { ITaskAssignmentCleaner } from '../../../src/modules/workspace';
import type { DbProvider } from '../../../src/modules/workspace/infrastructure/persistence/prisma/db';
import { testPrisma } from '../support/prisma-test-kit';

let rank = 0;

export async function seedTask(input: {
  workspaceId: string;
  projectId: string;
  number: number;
  assigneeId?: string | null;
}): Promise<string> {
  rank += 1;
  const task = await testPrisma().task.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      number: input.number,
      title: `Việc ${input.number}`,
      rank: `a${rank.toString(36).padStart(4, '0')}`,
      assigneeId: input.assigneeId ?? null,
    },
    select: { id: true },
  });
  return task.id;
}

/**
 * Bản SQL tối thiểu của `ITaskAssignmentCleaner` CHỈ để test race ROL-07 (bản thật + audit thuộc
 * T-018 của C). Khóa các dòng task trước khi ghi, cùng transaction với use case Workspace.
 */
export class SqlTaskAssignmentCleaner implements ITaskAssignmentCleaner {
  constructor(private readonly db: DbProvider) {}

  async unassignAllForUser(input: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<{ unassignedTaskCount: number }> {
    const unassignedTaskCount = await this.db().$executeRaw`
      UPDATE tasks SET assignee_id = NULL, version = version + 1
       WHERE id IN (
         SELECT id FROM tasks
          WHERE workspace_id = ${input.workspaceId}::uuid AND assignee_id = ${input.userId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE)`;
    return { unassignedTaskCount };
  }
}
