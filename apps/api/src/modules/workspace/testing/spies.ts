import type { ITaskAssignmentCleaner } from '../application/ports/collaborators.port';

/** Module Task giả (ADR-093): ghi lời gọi + có trong transaction không; trả số task cấu hình được. */
export class SpyTaskAssignmentCleaner implements ITaskAssignmentCleaner {
  readonly calls: {
    input: { workspaceId: string; userId: string; actorId: string };
    inTransaction: boolean;
  }[] = [];
  readonly assigned = new Map<string, number>();

  constructor(private readonly uow: { readonly inTransaction: boolean }) {}

  unassignAllForUser(input: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<{ unassignedTaskCount: number }> {
    this.calls.push({ input, inTransaction: this.uow.inTransaction });
    const count = this.assigned.get(input.userId) ?? 0;
    this.assigned.set(input.userId, 0);
    return Promise.resolve({ unassignedTaskCount: count });
  }
}
